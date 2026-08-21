/* eslint-disable max-lines -- request ownership, RPC lifecycle, and failover stay auditable in one executor. */
import './adapter-config'

import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { AdapterCtx, AdapterSharedModelExecuteOptions, AdapterSharedModelExecuteResult } from '@oneworks/types'
import { mergeProcessEnvWithProjectEnv, sanitizeInheritedNodeRuntimeEnv } from '@oneworks/utils'

import { resolveCodexBinaryPath } from '#~/paths.js'
import {
  classifyCodexAccountPoolFailure,
  markCodexAccountPoolFailure,
  prepareCodexSessionHome,
  resolveCodexAccountPoolCandidates
} from '#~/runtime/accounts.js'
import type { CodexAccountPoolCandidate } from '#~/runtime/accounts.js'
import { acquireCodexAppServer } from '#~/runtime/app-server-pool.js'
import { resolveCodexAdapterConfig } from '#~/runtime/config.js'
import { applyCodexNetworkEnv, materializeCodexCaCertificate, resolveCodexNetworkConfig } from '#~/runtime/network.js'
import { buildFeatureArgs } from '#~/runtime/session-common.js'
import { resolveCodexAppServerClientInfo } from '#~/runtime/stream.js'

const RESPONSE_TIMEOUT_MS = 10 * 60_000
const MAX_OUTPUT_ITEMS = 1_024
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024

type JsonObject = Record<string, unknown>

const isRecord = (value: unknown): value is JsonObject => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const asArray = (value: unknown) => Array.isArray(value) ? value : []

const readString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const readCount = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
)

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const assertResponseSize = (value: unknown) => {
  const bytes = Buffer.byteLength(JSON.stringify(value))
  if (bytes > MAX_RESPONSE_BYTES) throw new Error('Codex shared-model response exceeds the 16 MiB limit.')
}

const resolveInput = (request: JsonObject, dynamicToolNames: ReadonlyMap<string, string>) => {
  if (!Array.isArray(request.input)) throw new Error('Codex shared-model requests require a Responses input array.')
  return request.input.map((rawItem) => {
    if (!isRecord(rawItem) || rawItem.type !== 'function_call') return rawItem
    const originalName = readString(rawItem.name)
    if (originalName == null) return rawItem
    const dynamicName = dynamicToolNames.get(originalName)
    return dynamicName == null ? rawItem : { ...rawItem, name: dynamicName }
  })
}

const createDynamicToolName = (originalName: string) => {
  const digest = createHash('sha256').update(originalName).digest('hex').slice(0, 16)
  const suffix = originalName.replace(/\W+/gu, '_').slice(-43) || 'tool'
  return `owt_${digest}_${suffix}`
}

const resolveDynamicTools = (request: JsonObject) => {
  const dynamicByOriginal = new Map<string, string>()
  const originalByDynamic = new Map<string, string>()
  const tools = asArray(request.tools).map((rawTool) => {
    if (!isRecord(rawTool) || rawTool.type !== 'function') {
      throw new Error('Codex shared-model currently supports function tools only.')
    }
    const name = readString(rawTool.name)
    if (name == null) throw new Error('Codex shared-model function tools require a name.')
    if (dynamicByOriginal.has(name)) throw new Error(`Duplicate Codex shared-model function tool: ${name}`)
    const dynamicName = createDynamicToolName(name)
    dynamicByOriginal.set(name, dynamicName)
    originalByDynamic.set(dynamicName, name)
    return {
      type: 'function',
      name: dynamicName,
      description: readString(rawTool.description) ?? '',
      inputSchema: isRecord(rawTool.parameters) ? rawTool.parameters : { type: 'object', properties: {} }
    }
  })
  return { tools, dynamicByOriginal, originalByDynamic }
}

const resolveToolChoice = (request: JsonObject) => {
  const choice = request.tool_choice
  if (choice == null || choice === 'auto') return
  throw new Error('Codex shared-model currently supports automatic tool choice only.')
}

const resolveMaxOutputTokens = (request: JsonObject) => {
  if (request.max_output_tokens == null) return undefined
  const value = request.max_output_tokens
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Codex shared-model max_output_tokens must be a positive integer.')
  }
  return value
}

const resolveReasoningSummary = (value: unknown) => (
  value === 'auto' || value === 'concise' || value === 'detailed' || value === 'none' ? value : undefined
)

const responseItemIsModelOutput = (item: JsonObject) => (
  (item.type === 'message' && item.role === 'assistant') || item.type === 'reasoning'
)

const normalizeModelOutputItem = (item: JsonObject) => {
  if (item.type === 'message') return { ...item, status: 'completed' }
  return item
}

const createUsage = (usage: {
  input: number
  cached: number
  output: number
  reasoning: number
}) => ({
  input_tokens: usage.input,
  input_tokens_details: { cached_tokens: usage.cached },
  output_tokens: usage.output,
  output_tokens_details: { reasoning_tokens: usage.reasoning },
  total_tokens: usage.input + usage.output
})

const executeAttempt = async (
  ctx: AdapterCtx,
  options: AdapterSharedModelExecuteOptions,
  candidate: CodexAccountPoolCandidate | undefined
): Promise<AdapterSharedModelExecuteResult> => {
  const request = options.request
  const model = readString(request.model)
  if (model == null) throw new Error('Codex shared-model requests require a model.')
  resolveToolChoice(request)
  if (request.parallel_tool_calls === false) {
    throw new Error('Codex shared-model cannot guarantee serial tool calls.')
  }
  const maxOutputTokens = resolveMaxOutputTokens(request)
  const {
    tools: dynamicTools,
    dynamicByOriginal,
    originalByDynamic
  } = resolveDynamicTools(request)
  const input = resolveInput(request, dynamicByOriginal)
  const { native } = resolveCodexAdapterConfig(ctx)
  if (native.shareBuiltinModels !== true) throw new Error('Codex built-in model sharing is disabled.')

  const runtimeHome = await prepareCodexSessionHome({
    ctx,
    sessionId: options.sessionId,
    account: options.account ?? candidate?.key,
    model,
    appServerProfileKey: 'shared-model-service-v1',
    nativeHooksAvailable: false,
    sharedAppServerHome: false,
    useAccountPool: false
  })
  let network = resolveCodexNetworkConfig({ config: native.network, env: ctx.env })
  network = await materializeCodexCaCertificate(network, runtimeHome.homeDir)
  const spawnEnv = sanitizeInheritedNodeRuntimeEnv(
    mergeProcessEnvWithProjectEnv(ctx.env, { workspaceFolder: ctx.cwd })
  )
  spawnEnv.__ONEWORKS_DISABLE_MOCK_HOME_BRIDGE = '1'
  spawnEnv.HOME = runtimeHome.homeDir
  spawnEnv.USERPROFILE = runtimeHome.homeDir
  spawnEnv.PWD = runtimeHome.homeDir
  spawnEnv.CODEX_HOME = resolve(runtimeHome.homeDir, '.codex')
  applyCodexNetworkEnv(spawnEnv, network)
  await mkdir(spawnEnv.CODEX_HOME, { recursive: true })

  const profileKey = createHash('sha256')
    .update(JSON.stringify({ home: runtimeHome.homeDir, model, version: 1 }))
    .digest('hex')
  const disabledFeatures = {
    apps: false,
    browser_use: false,
    computer_use: false,
    image_generation: false,
    multi_agent: false,
    plugins: false,
    shell_tool: false,
    unified_exec: false
  }
  const lease = await acquireCodexAppServer({
    args: buildFeatureArgs(disabledFeatures),
    binaryPath: resolveCodexBinaryPath(ctx.env, ctx.cwd),
    clientInfo: resolveCodexAppServerClientInfo(native.clientInfo),
    cwd: runtimeHome.homeDir,
    env: spawnEnv,
    experimentalApi: true,
    idleTimeoutMs: native.appServer?.idleTimeoutMs ?? 300_000,
    logger: ctx.logger,
    profileKey,
    signal: options.signal
  }).catch(async (error) => {
    await runtimeHome.reconcileCredentialOwner?.().catch((reconcileError) => {
      ctx.logger.warn('[codex shared model] credential owner reconciliation failed after app-server acquisition', {
        error: reconcileError instanceof Error ? reconcileError.message : String(reconcileError)
      })
    })
    throw error
  })

  let threadId: string | undefined
  let turnId: string | undefined
  let settled = false
  let toolRequestId: number | undefined
  let toolRequestSettled = false
  let toolCall: JsonObject | undefined
  let responseTimer: ReturnType<typeof setTimeout> | undefined
  const output: JsonObject[] = []
  const seenOutputIds = new Set<string>()
  const usage = { input: 0, cached: 0, output: 0, reasoning: 0 }
  let resolveTurn!: () => void
  let rejectTurn!: (error: Error) => void
  const completed = new Promise<void>((resolvePromise, rejectPromise) => {
    resolveTurn = resolvePromise
    rejectTurn = rejectPromise
  })

  const settleError = (error: unknown) => {
    if (settled) return
    settled = true
    rejectTurn(error instanceof Error ? error : new Error(String(error)))
  }
  const settleSuccess = () => {
    if (settled) return
    settled = true
    resolveTurn()
  }
  const abort = () =>
    settleError(
      options.signal?.reason instanceof Error
        ? options.signal.reason
        : new DOMException('Request aborted.', 'AbortError')
    )
  options.signal?.addEventListener('abort', abort, { once: true })
  lease.onExit(code =>
    settleError(new Error(`Codex app-server exited before completing the request (${code ?? 'unknown'}).`))
  )

  try {
    const start = await lease.runThreadSetup(async () =>
      await lease.rpc.request<{ thread: { id: string } }>(
        'thread/start',
        {
          cwd: runtimeHome.homeDir,
          approvalPolicy: 'never',
          sandbox: 'read-only',
          model,
          ephemeral: true,
          dynamicTools,
          experimentalRawEvents: true,
          serviceName: 'One Works shared model service',
          baseInstructions:
            'Act as an API model. Use only the caller-provided dynamic function tools. Never invoke native shell, filesystem, browser, app, MCP, or sub-agent tools.',
          config: {
            mcp_servers: {},
            features: disabledFeatures,
            skills: { config: [] }
          }
        }
      )
    )
    threadId = start.thread.id
    await lease.registerThread(threadId, runtimeHome.homeDir, {
      onNotification: (method, params) => {
        if (method === 'turn/started') {
          turnId = readString(isRecord(params.turn) ? params.turn.id : undefined)
          return
        }
        if (method === 'rawResponseItem/completed' && isRecord(params.item)) {
          const item = params.item
          if (toolCall != null) return
          if (!responseItemIsModelOutput(item)) return
          const itemId = readString(item.id)
          if (itemId != null && seenOutputIds.has(itemId)) return
          if (itemId != null) seenOutputIds.add(itemId)
          if (output.length >= MAX_OUTPUT_ITEMS) {
            settleError(new Error('Codex shared-model output item limit exceeded.'))
            return
          }
          output.push(normalizeModelOutputItem(item))
          assertResponseSize(output)
          return
        }
        if (method === 'rawResponse/completed' && isRecord(params.usage)) {
          usage.input += readCount(params.usage.inputTokens)
          usage.cached += readCount(params.usage.cachedInputTokens)
          usage.output += readCount(params.usage.outputTokens)
          usage.reasoning += readCount(params.usage.reasoningOutputTokens)
          return
        }
        if (method !== 'turn/completed') return
        const turn = isRecord(params.turn) ? params.turn : {}
        if (toolCall != null) {
          if (turn.status === 'interrupted') settleSuccess()
          else settleError(new Error(`Codex tool turn ended without interruption (${String(turn.status)}).`))
        } else if (turn.status === 'completed') settleSuccess()
        else {settleError(
            new Error(`Codex turn ${String(turn.status ?? 'failed')}: ${JSON.stringify(turn.error ?? {})}`)
          )}
      },
      onRequest: (id, method, params) => {
        if (method !== 'item/tool/call') {
          lease.rpc.respond(id, {})
          settleError(new Error(`Unsupported Codex app-server request: ${method}`))
          return
        }
        if (toolCall != null) {
          toolRequestSettled = true
          lease.rpc.respond(id, {
            success: false,
            contentItems: [{
              type: 'inputText',
              text: 'Parallel dynamic tool calls are not supported by this gateway.'
            }]
          })
          settleError(new Error('Parallel dynamic tool calls are not supported by the Codex shared-model gateway.'))
          return
        }
        const callId = readString(params.callId)
        const dynamicName = readString(params.tool)
        const name = dynamicName == null ? undefined : originalByDynamic.get(dynamicName)
        if (callId == null || name == null) {
          toolRequestSettled = true
          lease.rpc.respond(id, {
            success: false,
            contentItems: [{ type: 'inputText', text: 'Malformed dynamic tool call.' }]
          })
          settleError(new Error('Codex app-server returned a malformed dynamic tool call.'))
          return
        }
        toolRequestId = id
        toolCall = {
          type: 'function_call',
          id: `fc_${randomUUID().replaceAll('-', '')}`,
          call_id: callId,
          name,
          arguments: JSON.stringify(params.arguments ?? {}),
          status: 'completed'
        }
        toolRequestSettled = true
        lease.rpc.respond(id, {
          success: false,
          contentItems: [{ type: 'inputText', text: 'Tool execution is delegated to the API caller.' }]
        })
        void lease.rpc.request('turn/interrupt', {
          threadId,
          turnId: readString(params.turnId) ?? turnId
        }).catch(settleError)
      }
    })
    if (options.signal?.aborted === true) abort()
    await lease.rpc.request('thread/inject_items', { threadId, items: input })
    const text = isRecord(request.text) ? request.text : undefined
    const format = text != null && isRecord(text.format) ? text.format : undefined
    const reasoning = isRecord(request.reasoning) ? request.reasoning : undefined
    const startTurn = await lease.rpc.request<{ turn: { id: string } }>('turn/start', {
      threadId,
      input: [],
      cwd: runtimeHome.homeDir,
      approvalPolicy: 'never',
      model,
      ...(readString(reasoning?.effort) == null ? {} : { effort: readString(reasoning?.effort) }),
      ...(maxOutputTokens == null ? {} : { maxOutputTokens }),
      ...(resolveReasoningSummary(reasoning?.summary) == null
        ? {}
        : { summary: resolveReasoningSummary(reasoning?.summary) }),
      ...(format?.type === 'json_schema' && isRecord(format.schema) ? { outputSchema: format.schema } : {})
    } as JsonObject)
    turnId = startTurn.turn.id
    await Promise.race([
      completed,
      new Promise<never>((_resolve, reject) => {
        responseTimer = setTimeout(
          () => reject(new Error('Codex shared-model request timed out.')),
          RESPONSE_TIMEOUT_MS
        )
        responseTimer.unref()
      })
    ])
    if (toolCall != null) output.push(toolCall)
    const response = {
      id: `resp_ow_${randomUUID().replaceAll('-', '')}`,
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      status: 'completed',
      model,
      output,
      usage: createUsage(usage)
    }
    assertResponseSize(response)
    return { response, accountKey: runtimeHome.accountKey }
  } catch (error) {
    if (threadId != null && turnId != null) {
      await lease.rpc.request('turn/interrupt', { threadId, turnId }, { timeoutMs: 1_000 }).catch(() => undefined)
    }
    throw error
  } finally {
    if (responseTimer != null) clearTimeout(responseTimer)
    options.signal?.removeEventListener('abort', abort)
    if (threadId != null) {
      if (toolRequestId != null && !toolRequestSettled) {
        lease.rpc.respond(toolRequestId, { success: false, contentItems: [] })
      }
      await lease.rpc.request('thread/unsubscribe', { threadId }, { timeoutMs: 1_000 }).catch(() => undefined)
      await lease.unregisterThread(threadId).catch(() => undefined)
    }
    await lease.drain?.().catch(() => undefined)
    await runtimeHome.reconcileCredentialOwner?.().catch((error) => {
      ctx.logger.warn('[codex shared model] credential owner reconciliation failed during teardown', {
        error: error instanceof Error ? error.message : String(error)
      })
    })
    lease.release()
  }
}

export const executeCodexSharedModel = async (
  ctx: AdapterCtx,
  options: AdapterSharedModelExecuteOptions
): Promise<AdapterSharedModelExecuteResult> => {
  const model = readString(options.request.model)
  const pool = options.account == null
    ? await resolveCodexAccountPoolCandidates(ctx, model)
    : { enabled: false, candidates: [] as CodexAccountPoolCandidate[], cooldownMs: 0 }
  if (pool.enabled && pool.candidates.length === 0) {
    throw new Error('No healthy Codex account is available in the automatic account pool.')
  }
  const candidates: Array<CodexAccountPoolCandidate | undefined> = pool.enabled ? pool.candidates : [undefined]
  let lastError: unknown
  for (const candidate of candidates) {
    try {
      return await executeAttempt(ctx, options, candidate)
    } catch (error) {
      lastError = error
      if (candidate == null) break
      const classified = classifyCodexAccountPoolFailure(error, pool.cooldownMs)
      if (classified == null) break
      await markCodexAccountPoolFailure({ ctx, candidate, model, ...classified })
    }
  }
  throw lastError instanceof Error ? lastError : new Error(errorMessage(lastError))
}
