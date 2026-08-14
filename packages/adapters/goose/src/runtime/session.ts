/* eslint-disable max-lines -- ACP transport, prompt queue, and process cleanup share one terminal state machine. */
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { Readable, Writable } from 'node:stream'
import { pathToFileURL } from 'node:url'

import { PROTOCOL_VERSION, client, methods, ndJsonStream } from '@agentclientprotocol/sdk'
import type { ClientConnection, ContentBlock, InitializeResponse, PromptResponse } from '@agentclientprotocol/sdk'

import type {
  AdapterCtx,
  AdapterEvent,
  AdapterMessageContent,
  AdapterOutputEvent,
  AdapterQueryOptions,
  AdapterSession
} from '@oneworks/types'
import { uuid } from '@oneworks/utils/uuid'

import { GoosePermissionBridge } from './interaction'
import { prepareGooseSession, sanitizeGooseChildProcessEnv } from './prepare'
import { GooseEventProjector } from './projector'
import { createGooseRedactor, createGooseStartupError } from './redaction'

type GoosePrepareDependencies = import('./prepare').GoosePrepareDependencies
type PreparedGooseSession = import('./prepare').PreparedGooseSession

export interface GooseSessionDependencies {
  closeTimeoutMs?: number
  killTimeoutMs?: number
  requestTimeoutMs?: number
  prepare?: GoosePrepareDependencies
  spawnProcess?: typeof spawn
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_CLOSE_TIMEOUT_MS = 3_000
const DEFAULT_KILL_TIMEOUT_MS = 2_000

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const withDeadline = <T>(label: string, promise: Promise<T>, timeoutMs: number): Promise<T> => (
  new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`Goose ACP ${label} timed out after ${timeoutMs}ms.`)), timeoutMs)
    void promise.then(
      value => {
        clearTimeout(timer)
        resolvePromise(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
)

const withStartupDeadline = async <T>(params: {
  label: string
  promise: Promise<T>
  redactString: (value: string) => string
  timeoutMs: number
}): Promise<T> => {
  try {
    return await withDeadline(params.label, params.promise, params.timeoutMs)
  } catch (error) {
    throw createGooseStartupError({
      context: params.label,
      error,
      redactString: params.redactString
    })
  }
}

const dataUrlImage = (url: string) => {
  const match = url.match(/^data:([^;,]+);base64,(.+)$/u)
  return match == null ? undefined : { data: match[2], mimeType: match[1] }
}

const mapPromptContent = async (content: AdapterMessageContent[]): Promise<ContentBlock[]> => {
  const blocks: ContentBlock[] = []
  for (const item of content) {
    if (item.type === 'text') {
      if (item.text.trim() !== '') blocks.push({ type: 'text', text: item.text })
      continue
    }
    if (item.type === 'image') {
      const inline = dataUrlImage(item.url)
      if (inline != null) {
        blocks.push({ type: 'image', ...inline, uri: item.url })
      } else if (item.path != null) {
        blocks.push({
          type: 'image',
          data: (await readFile(item.path)).toString('base64'),
          mimeType: item.mimeType ?? 'application/octet-stream',
          uri: pathToFileURL(item.path).toString()
        })
      } else {
        blocks.push({
          type: 'resource_link',
          uri: item.url,
          name: item.name ?? 'image',
          mimeType: item.mimeType
        })
      }
      continue
    }
    if (item.type === 'file') {
      blocks.push({
        type: 'resource_link',
        uri: pathToFileURL(item.path).toString(),
        name: item.name ?? item.path,
        mimeType: item.name?.endsWith('.md') ? 'text/markdown' : undefined,
        size: item.size
      })
      continue
    }
    if (item.type === 'tool_result') {
      const value = typeof item.content === 'string' ? item.content : JSON.stringify(item.content)
      blocks.push({ type: 'text', text: `[Tool result ${item.tool_use_id}]\n${value}` })
    }
  }
  return blocks
}

const resolveSystemPromptMode = (options: AdapterQueryOptions) => (
  options.appendSystemPrompt === false ? 'set' as const : 'append' as const
)

const applySystemPrompt = async (params: {
  connection: ClientConnection
  options: AdapterQueryOptions
  requestTimeoutMs: number
  sessionId: string
}) => {
  const text = params.options.systemPrompt?.trim()
  if (text == null || text === '') return undefined
  try {
    await withDeadline(
      'system prompt request',
      params.connection.agent.request('_goose/unstable/session/system-prompt/set', {
        sessionId: params.sessionId,
        text,
        mode: resolveSystemPromptMode(params.options),
        key: 'oneworks'
      }),
      params.requestTimeoutMs
    )
    return undefined
  } catch {
    return text
  }
}

const configureMode = async (params: {
  connection: ClientConnection
  logger: AdapterCtx['logger']
  mode: PreparedGooseSession['nativeMode']
  redactString: (value: string) => string
  requestTimeoutMs: number
  sessionId: string
}) => {
  try {
    await withDeadline(
      'session/set_mode request',
      params.connection.agent.request(methods.agent.session.setMode, {
        sessionId: params.sessionId,
        modeId: params.mode
      }),
      params.requestTimeoutMs
    )
  } catch (error) {
    params.logger.warn('[goose session] native mode was unavailable; continuing with Goose default', {
      error: params.redactString(getErrorMessage(error)),
      mode: params.mode
    })
  }
}

const emitPromptUsage = (
  response: PromptResponse,
  model: string,
  onEvent: (event: AdapterOutputEvent) => void
) => {
  if (response.usage == null) return
  onEvent({
    type: 'usage',
    data: {
      id: uuid(),
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      reasoningOutputTokens: response.usage.thoughtTokens ?? undefined,
      cacheReadInputTokens: response.usage.cachedReadTokens ?? undefined,
      cacheCreationInputTokens: response.usage.cachedWriteTokens ?? undefined,
      aggregationMode: 'cumulative',
      model,
      observedAt: Date.now(),
      quality: 'provider_reported'
    }
  })
}

const createNativeSession = async (params: {
  connection: ClientConnection
  ctx: AdapterCtx
  init: InitializeResponse
  options: AdapterQueryOptions
  prepared: PreparedGooseSession
  redactString: (value: string) => string
  requestTimeoutMs: number
  setAcceptUpdates: (value: boolean) => void
}) => {
  const validateSessionId = (value: unknown) => {
    if (
      typeof value !== 'string' || !/^[A-Za-z0-9][\w.:-]{0,255}$/u.test(value) ||
      params.redactString(value) !== value
    ) {
      throw new Error('Goose ACP returned an unsafe native session id.')
    }
    return value
  }
  const cached = params.options.type === 'resume'
    ? await params.ctx.cache.get('adapter.goose.session')
    : undefined
  if (params.options.type === 'resume') {
    if (!cached?.gooseSessionId) throw new Error('Goose resume requested without a cached native session id.')
    const cachedSessionId = validateSessionId(cached.gooseSessionId)
    if (params.init.agentCapabilities?.loadSession !== true) {
      throw new Error('Installed Goose ACP server does not support session/load.')
    }
    params.setAcceptUpdates(false)
    await withStartupDeadline({
      label: 'session/load request',
      promise: params.connection.agent.request(methods.agent.session.load, {
        cwd: params.ctx.cwd,
        mcpServers: params.prepared.mcpServers,
        sessionId: cachedSessionId
      }),
      redactString: params.redactString,
      timeoutMs: params.requestTimeoutMs
    })
    params.setAcceptUpdates(true)
    return cachedSessionId
  }

  const result = await withStartupDeadline({
    label: 'session/new request',
    promise: params.connection.agent.request(methods.agent.session.new, {
      cwd: params.ctx.cwd,
      mcpServers: params.prepared.mcpServers
    }),
    redactString: params.redactString,
    timeoutMs: params.requestTimeoutMs
  })
  const sessionId = validateSessionId(result.sessionId)
  await params.ctx.cache.set('adapter.goose.session', { gooseSessionId: sessionId })
  return sessionId
}

export const createGooseSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions,
  dependencies: GooseSessionDependencies = {}
): Promise<AdapterSession> => {
  const initialRedactor = createGooseRedactor(ctx.env as NodeJS.ProcessEnv)
  let prepared: PreparedGooseSession
  try {
    prepared = await prepareGooseSession(ctx, options, dependencies.prepare)
  } catch (error) {
    throw new Error(initialRedactor.redactString(getErrorMessage(error)))
  }
  const spawnEnv = sanitizeGooseChildProcessEnv(prepared.spawnEnv)
  const redactor = createGooseRedactor(spawnEnv, [prepared.mcpServers])
  const emitEvent = (event: AdapterOutputEvent) => options.onEvent(redactor.redactValue(event))
  const requestTimeoutMs = dependencies.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const closeTimeoutMs = dependencies.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS
  const killTimeoutMs = dependencies.killTimeoutMs ?? DEFAULT_KILL_TIMEOUT_MS
  const proc = (dependencies.spawnProcess ?? spawn)(prepared.binaryPath, ['acp'], {
    cwd: ctx.cwd,
    env: spawnEnv,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  if (proc.stdin == null || proc.stdout == null) throw new Error('Goose ACP process did not expose stdio.')

  let stderr = ''
  let exited = false
  let stopping = false
  let activeTurn = false
  let cancelRequested = false
  let nativeSessionId: string | undefined
  let acceptUpdates = true
  let pendingSystemPrompt: string | undefined
  let sendQueue = Promise.resolve()
  const projector = new GooseEventProjector(prepared.model, emitEvent)
  const permissions = new GoosePermissionBridge(options, emitEvent)

  const emitExit = (exitCode?: number) => {
    if (exited) return
    exited = true
    emitEvent({
      type: 'exit',
      data: { exitCode, ...(stderr.trim() ? { stderr: stderr.trim() } : {}) }
    })
  }
  const emitError = (error: unknown, fatal: boolean) => {
    emitEvent({ type: 'error', data: { message: getErrorMessage(error), fatal } })
  }

  proc.stderr?.on('data', (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-64 * 1024)
  })
  proc.on('error', (error) => {
    if (!stopping) emitError(error, true)
  })
  proc.on('exit', (code) => {
    permissions.cancelAll()
    if (!stopping && activeTurn) emitError('Goose exited before the active ACP turn completed.', true)
    else if (!stopping) {
      emitError(stderr.trim() || `Goose ACP process exited unexpectedly with code ${code ?? 'unknown'}.`, true)
    }
    emitExit(code ?? undefined)
  })

  const transport = ndJsonStream(
    Writable.toWeb(proc.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>
  )
  const app = client({ name: 'oneworks' })
    .onRequest(methods.client.session.requestPermission, ({ params }) => permissions.handle(params))
    .onNotification(methods.client.session.update, ({ params }) => {
      if (acceptUpdates && (nativeSessionId == null || params.sessionId === nativeSessionId)) {
        projector.handle(params.update)
      }
    })
  const connection = app.connect(transport)

  let init: InitializeResponse
  try {
    init = await withStartupDeadline({
      label: 'initialize request',
      promise: connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false
        },
        clientInfo: { name: 'oneworks', title: 'One Works', version: '1.0.0' }
      }),
      redactString: redactor.redactString,
      timeoutMs: requestTimeoutMs
    })
    if (init.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(`Goose negotiated unsupported ACP protocol version ${init.protocolVersion}.`)
    }
    nativeSessionId = await createNativeSession({
      connection,
      ctx,
      init,
      options,
      prepared,
      redactString: redactor.redactString,
      requestTimeoutMs,
      setAcceptUpdates: value => {
        acceptUpdates = value
      }
    })
    await configureMode({
      connection,
      logger: ctx.logger,
      mode: prepared.nativeMode,
      redactString: redactor.redactString,
      requestTimeoutMs,
      sessionId: nativeSessionId
    })
    pendingSystemPrompt = await applySystemPrompt({
      connection,
      options,
      requestTimeoutMs,
      sessionId: nativeSessionId
    })
    if (pendingSystemPrompt != null) {
      ctx.logger.warn('[goose session] native system prompt extension was unavailable; using first-prompt fallback')
    }
  } catch (error) {
    const startupError = createGooseStartupError({
      context: 'startup',
      error,
      redactString: redactor.redactString
    })
    stopping = true
    permissions.cancelAll()
    connection.close(startupError)
    proc.kill('SIGKILL')
    throw startupError
  }

  emitEvent({
    type: 'init',
    data: {
      uuid: options.sessionId,
      adapter: 'goose',
      model: prepared.model,
      effort: options.effort,
      version: init.agentInfo?.version ?? 'unknown',
      tools: ['read', 'edit', 'delete', 'move', 'search', 'execute', 'fetch', 'mcp'],
      slashCommands: [],
      cwd: ctx.cwd,
      agents: ['goose'],
      assetDiagnostics: options.assetPlan?.diagnostics
    }
  })

  const sendPrompt = async (blocks: ContentBlock[]) => {
    if (stopping || nativeSessionId == null || blocks.length === 0) return
    if (pendingSystemPrompt != null) {
      blocks.unshift({
        type: 'text',
        text: `<oneworks-system-instructions>\n${pendingSystemPrompt}\n</oneworks-system-instructions>`
      })
      pendingSystemPrompt = undefined
    }
    activeTurn = true
    cancelRequested = false
    emitEvent({
      type: 'operation',
      data: {
        type: 'operation_started',
        operationId: 'goose-turn',
        message: 'Goose started the turn.',
        adapter: 'goose'
      }
    })
    try {
      const response = await connection.agent.request(methods.agent.session.prompt, {
        sessionId: nativeSessionId,
        prompt: blocks
      })
      activeTurn = false
      cancelRequested = false
      emitPromptUsage(response, prepared.model, emitEvent)
      const failed = response.stopReason === 'refusal' || response.stopReason === 'max_turn_requests'
      emitEvent({
        type: 'operation',
        data: {
          type: failed ? 'operation_failed' : 'operation_completed',
          operationId: 'goose-turn',
          message: `Goose stopped the turn (${response.stopReason}).`,
          adapter: 'goose'
        }
      })
      if (failed) emitError(`Goose stopped the turn: ${response.stopReason}.`, false)
      emitEvent({ type: 'stop' })
    } catch (error) {
      activeTurn = false
      cancelRequested = false
      if (stopping) return
      emitEvent({
        type: 'operation',
        data: {
          type: 'operation_failed',
          operationId: 'goose-turn',
          message: getErrorMessage(error),
          adapter: 'goose'
        }
      })
      emitError(error, false)
      emitEvent({ type: 'stop' })
    }
  }

  const enqueue = (task: () => Promise<void>) => {
    sendQueue = sendQueue.then(task).catch(error => {
      if (!stopping) emitError(error, false)
    })
  }
  if (options.description?.trim()) {
    enqueue(() => sendPrompt([{ type: 'text', text: options.description!.trim() }]))
  }

  const stop = () => {
    if (stopping) return
    stopping = true
    permissions.cancelAll()
    if (nativeSessionId != null && activeTurn && !cancelRequested) {
      cancelRequested = true
      void connection.agent.notify(methods.agent.session.cancel, { sessionId: nativeSessionId }).catch(() => undefined)
    }
    const finish = nativeSessionId == null
      ? Promise.resolve()
      : withDeadline(
        'session/close request',
        connection.agent.request(methods.agent.session.close, { sessionId: nativeSessionId }),
        closeTimeoutMs
      ).catch(() => undefined)
    void finish.finally(() => {
      connection.close()
      if (!exited) proc.kill('SIGTERM')
      const killTimer = setTimeout(() => {
        if (exited) return
        proc.kill('SIGKILL')
        emitExit()
      }, killTimeoutMs)
      proc.once('exit', () => clearTimeout(killTimer))
    })
  }

  return {
    kill: () => {
      if (stopping) return
      stopping = true
      permissions.cancelAll()
      connection.close(new Error('Goose session killed.'))
      proc.kill('SIGKILL')
    },
    stop,
    emit: (event: AdapterEvent) => {
      if (event.type === 'message') {
        enqueue(async () => sendPrompt(await mapPromptContent(event.content)))
      } else if (event.type === 'interrupt') {
        if (nativeSessionId != null && activeTurn && !cancelRequested) {
          cancelRequested = true
          permissions.cancelAll()
          void connection.agent.notify(methods.agent.session.cancel, { sessionId: nativeSessionId })
            .catch(error => emitError(error, false))
        }
      } else if (event.type === 'stop') {
        stop()
      }
    },
    respondInteraction: (interactionId, data) => permissions.respond(interactionId, data),
    pid: proc.pid
  }
}
