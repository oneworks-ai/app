/* eslint-disable max-lines -- Kiro ACP startup, turn, and terminal state must share one owner. */
import { spawn } from 'node:child_process'

import type {
  AdapterCtx,
  AdapterEvent,
  AdapterOutputEvent,
  AdapterQueryOptions,
  AdapterSession,
  EffortLevel
} from '@oneworks/types'

import { resolveKiroBinaryPath } from '#~/paths.js'
import { AcpProtocolError, KiroAcpClient } from '../protocol/client'
import type { AcpInitializeResult, AcpMessage, AcpSessionResult, KiroAcpProcess } from '../protocol/types'
import { KiroInteractionBridge } from './interaction'
import { KiroEventProjector } from './projector'
import {
  DEFAULT_KIRO_TOOLS,
  MANAGED_KIRO_AGENT,
  mapKiroMcpServers,
  normalizeKiroPrompt,
  prepareKiroSessionRuntime,
  resolveKiroAdapterConfig
} from './shared'

export interface KiroCapabilityMatrix {
  additionalDirectories: boolean
  closeSession: boolean
  loadSession: boolean
  resumeSession: boolean
}

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const readUpdatePayload = (params: unknown) => {
  if (!isRecord(params)) return {}
  return isRecord(params.update) ? params.update : isRecord(params.notification) ? params.notification : params
}

const readUpdateKind = (params: unknown) => {
  if (!isRecord(params)) return ''
  const update = readUpdatePayload(params)
  const value = update.sessionUpdate ?? update.type ?? update.updateType ?? params.updateType
  return typeof value === 'string' ? value.replaceAll(/[_\s-]/gu, '').toLowerCase() : ''
}

const isCapabilityAdvertised = (value: unknown) => value === true || isRecord(value)

export const buildKiroCapabilityMatrix = (result: AcpInitializeResult): KiroCapabilityMatrix => ({
  loadSession: result.agentCapabilities?.loadSession === true,
  resumeSession: isCapabilityAdvertised(result.agentCapabilities?.sessionCapabilities?.resume),
  closeSession: isCapabilityAdvertised(result.agentCapabilities?.sessionCapabilities?.close),
  additionalDirectories: isCapabilityAdvertised(
    result.agentCapabilities?.sessionCapabilities?.additionalDirectories
  )
})

const resolveSessionModel = (result: AcpSessionResult, appliedModel?: string) => (
  appliedModel ?? result.models?.currentModelId ?? 'default'
)

const normalizeSessionResult = (value: unknown, fallbackSessionId?: string): AcpSessionResult => {
  if (!isRecord(value)) return fallbackSessionId == null ? {} : { sessionId: fallbackSessionId }
  return {
    ...value,
    sessionId: typeof value.sessionId === 'string' && value.sessionId !== ''
      ? value.sessionId
      : fallbackSessionId
  } as AcpSessionResult
}

const mergeSessionResult = (current: AcpSessionResult, value: unknown): AcpSessionResult => {
  if (!isRecord(value)) return current
  const next = normalizeSessionResult(value, current.sessionId)
  return {
    ...current,
    ...next,
    models: next.models ?? current.models,
    modes: next.modes ?? current.modes,
    configOptions: next.configOptions ?? current.configOptions
  }
}

const hasAdvertisedModel = (result: AcpSessionResult, model: string) => (
  result.models?.availableModels?.some(item => item.modelId === model) === true
)

const EFFORT_LEVELS = new Set<EffortLevel>(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'])

const isEffortConfig = (value: unknown): value is Record<string, unknown> => {
  if (!isRecord(value)) return false
  const id = String(value.id ?? value.configId ?? '').toLowerCase()
  return id.includes('effort') || id.includes('thought')
}

const readEffortLevel = (value: unknown): EffortLevel | undefined => (
  typeof value === 'string' && EFFORT_LEVELS.has(value as EffortLevel) ? value as EffortLevel : undefined
)

const resolveSessionEffort = (result: AcpSessionResult) => {
  const config = result.configOptions?.find(isEffortConfig)
  return isRecord(config) ? readEffortLevel(config.currentValue ?? config.value) : undefined
}

const findAdvertisedEffortConfig = (result: AcpSessionResult, effort: string) => (
  result.configOptions?.find((value) => {
    if (!isEffortConfig(value) || !Array.isArray(value.options)) return false
    return value.options.some((option) => (
      isRecord(option) && String(option.value ?? option.id ?? '') === effort
    ))
  })
)

const isTurnEndKind = (kind: string) => kind === 'turnend'

const isFailureKind = (kind: string) => (
  kind === 'error' || kind === 'failure' || kind === 'turnfailure' || kind === 'turnfailed' ||
  kind === 'terminalerror' || /error|fail|fatal/u.test(kind)
)

const TERMINAL_RPC_DRAIN_MS = 100

const buildMirroredNotificationFingerprint = (params: unknown) => {
  const envelope = isRecord(params) ? params : {}
  const update = readUpdatePayload(params)
  return JSON.stringify({
    sessionId: envelope.sessionId ?? envelope.session_id,
    kind: readUpdateKind(params),
    messageId: update.messageId ?? update.message_id,
    toolCallId: update.toolCallId ?? update.tool_call_id ?? update.id,
    content: update.content ?? update.prompt ?? update.message,
    input: update.rawInput ?? update.raw_input ?? update.input,
    output: update.rawOutput ?? update.raw_output ?? update.output ?? update.result,
    status: update.status,
    title: update.title,
    name: update.name,
    error: update.error,
    inputTokens: update.inputTokens ?? update.input_tokens,
    outputTokens: update.outputTokens ?? update.output_tokens
  })
}

const createDirectKiroSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions
): Promise<AdapterSession> => {
  if (options.model != null && options.model !== 'default') {
    throw new Error('Kiro direct mode cannot verify or apply a non-default native model; use Default or stream mode.')
  }
  const adapterConfig = resolveKiroAdapterConfig(ctx)
  const binaryPath = resolveKiroBinaryPath(ctx.env, adapterConfig.cliPath ?? adapterConfig.cli?.path)
  const runtime = await prepareKiroSessionRuntime(ctx, options, adapterConfig)
  const args = ['chat', '--agent', MANAGED_KIRO_AGENT]

  options.onEvent({
    type: 'init',
    data: {
      uuid: options.sessionId,
      adapter: 'kiro',
      model: 'default',
      version: 'unknown',
      tools: DEFAULT_KIRO_TOOLS,
      slashCommands: [],
      cwd: ctx.cwd,
      agents: [MANAGED_KIRO_AGENT],
      assetDiagnostics: options.assetPlan?.diagnostics
    }
  })
  const proc = spawn(binaryPath, args, { cwd: ctx.cwd, env: runtime.env, stdio: 'inherit' })
  let exited = false
  const emitExit = (exitCode: number, stderr?: string) => {
    if (exited) return
    exited = true
    options.onEvent({ type: 'exit', data: { exitCode, ...(stderr ? { stderr } : {}) } })
  }
  proc.on('error', (error) => {
    options.onEvent({ type: 'error', data: { message: getErrorMessage(error), fatal: true } })
    emitExit(1, getErrorMessage(error))
  })
  proc.on('exit', code => emitExit(code ?? 0))
  return {
    kill: () => proc.kill('SIGKILL'),
    stop: () => proc.kill('SIGTERM'),
    emit: () => ctx.logger.warn('emit() is not supported in direct mode for kiro'),
    pid: proc.pid
  }
}

export const createStreamKiroSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions,
  dependencies: {
    createClient?: (process: KiroAcpProcess) => KiroAcpClient
    spawnProcess?: typeof spawn
  } = {}
): Promise<AdapterSession> => {
  const adapterConfig = resolveKiroAdapterConfig(ctx)
  const binaryPath = resolveKiroBinaryPath(ctx.env, adapterConfig.cliPath ?? adapterConfig.cli?.path)
  const runtime = await prepareKiroSessionRuntime(ctx, options, adapterConfig)
  const spawnProcess = dependencies.spawnProcess ?? spawn
  const proc = spawnProcess(binaryPath, ['acp', '--agent', MANAGED_KIRO_AGENT], {
    cwd: ctx.cwd,
    env: runtime.env,
    stdio: ['pipe', 'pipe', 'pipe']
  }) as KiroAcpProcess
  const client = dependencies.createClient?.(proc) ?? new KiroAcpClient(proc)
  let activeTurn = false
  let destroyed = false
  let didEmitExit = false
  let didEmitFatal = false
  let nativeSessionId: string | undefined
  let replaying = false
  let sendQueue = Promise.resolve()
  let turnTerminated = true
  const mirroredNotifications = new Map<string, { method: string; seenAt: number }>()
  const settledLateRequestIds = new Set<string>()

  const emitEvent = (event: AdapterOutputEvent) => {
    if (event.type === 'error' && event.data.fatal !== false) didEmitFatal = true
    options.onEvent(event)
  }
  const emitExit = (exitCode?: number, stderr?: string) => {
    if (didEmitExit) return
    didEmitExit = true
    emitEvent({ type: 'exit', data: { exitCode, ...(stderr?.trim() ? { stderr: stderr.trim() } : {}) } })
  }
  const projector = new KiroEventProjector(options.model ?? 'default', emitEvent)
  let interactions: KiroInteractionBridge
  const terminateTurn = () => {
    if (turnTerminated) return
    turnTerminated = true
    activeTurn = false
    const message = projector.finishTurn()
    emitEvent({ type: 'stop', ...(message != null ? { data: message } : {}) })
  }
  const failSession = (error: unknown) => {
    if (destroyed || didEmitExit) return
    destroyed = true
    const message = getErrorMessage(error)
    if (!didEmitFatal) emitEvent({ type: 'error', data: { message, fatal: true } })
    emitExit(1, message)
    void interactions.cancelAll()
      // Keep stdin writable briefly so already-in-flight child RPCs receive a terminal response.
      .then(() => new Promise<void>(resolveClose => setTimeout(resolveClose, TERMINAL_RPC_DRAIN_MS)))
      .then(() => client.close())
      .catch(() => proc.kill('SIGTERM'))
  }
  interactions = new KiroInteractionBridge(client, options, emitEvent, error => failSession(error))
  const isMirroredDuplicate = (method: string, params: unknown) => {
    let fingerprint: string
    try {
      fingerprint = buildMirroredNotificationFingerprint(params)
    } catch {
      return false
    }
    const now = Date.now()
    const previous = mirroredNotifications.get(fingerprint)
    mirroredNotifications.set(fingerprint, { method, seenAt: now })
    for (const [key, value] of mirroredNotifications) {
      if (now - value.seenAt > 1_000) mirroredNotifications.delete(key)
    }
    return previous != null && previous.method !== method && now - previous.seenAt <= 1_000
  }

  const settleLateRequest = (message: AcpMessage) => {
    if (message.id == null) return
    const requestId = String(message.id)
    if (settledLateRequestIds.has(requestId)) return
    settledLateRequestIds.add(requestId)
    const response = message.method === 'session/request_permission'
      ? client.respond(message.id, { outcome: { outcome: 'cancelled' } })
      : client.respondError(message.id, -32000, 'Kiro session is already terminated.')
    void response.catch(() => undefined)
  }

  client.onNotification((method, params) => {
    if (destroyed || didEmitExit) return
    if (method === 'session/notification' || method === 'session/update') {
      if (isMirroredDuplicate(method, params)) return
      const kind = readUpdateKind(params)
      if (isFailureKind(kind)) {
        failSession(new Error(`Kiro reported a terminal failure (${kind || 'unknown'}).`))
        return
      }
      if (!replaying) projector.handle(params)
      if (!replaying && isTurnEndKind(kind)) terminateTurn()
      return
    }
    if (method === '_kiro.dev/commands/available' || method.startsWith('_kiro.dev/mcp/')) return
    if (method === '_kiro.dev/compaction/status' || method === '_kiro.dev/clear/status') return
    if (method === '_session/terminate' || /error|fail|fatal|terminate/iu.test(method)) {
      failSession(new Error(`Kiro emitted terminal notification "${method}".`))
    }
  })
  client.onRequest((message: AcpMessage) => {
    if (destroyed || didEmitExit) {
      settleLateRequest(message)
      return
    }
    if (interactions.handle(message)) return
    if (message.id != null) {
      void client.respondError(
        message.id,
        -32601,
        `Unsupported Kiro ACP client request: ${message.method ?? 'unknown'}`
      )
    }
  })
  client.onError(error => failSession(error))
  client.onExit((code) => {
    if (!destroyed && activeTurn) {
      failSession(new Error('Kiro ACP exited before the active turn ended.'))
      return
    }
    if (!destroyed && code !== 0 && !didEmitFatal) {
      failSession(new Error(`Kiro ACP exited with code ${code ?? 'unknown'}.`))
      return
    }
    emitExit(code ?? (destroyed ? 0 : undefined))
  })

  let initializeResult: AcpInitializeResult
  let sessionResult: AcpSessionResult
  let capabilities: KiroCapabilityMatrix
  let appliedModel: string | undefined
  let assetDiagnostics = options.assetPlan?.diagnostics ?? []
  try {
    initializeResult = await client.request<AcpInitializeResult>('initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: 'oneworks', version: '1.0.0' }
    })
    capabilities = buildKiroCapabilityMatrix(initializeResult)
    const mappedMcp = mapKiroMcpServers(options.assetPlan?.mcpServers ?? {})
    const mcpServers = mappedMcp.servers
    if (mappedMcp.skippedServerNames.length > 0) {
      const diagnosedAssetIds = new Set(assetDiagnostics.map(diagnostic => diagnostic.assetId))
      const fallbackDiagnostics = mappedMcp.skippedServerNames
        .filter(name => !diagnosedAssetIds.has(`runtime-mcp:${name}`))
        .map(name => ({
          assetId: `runtime-mcp:${name}`,
          adapter: 'kiro' as const,
          status: 'skipped' as const,
          reason: `MCP server "${name}" was skipped because verified Kiro ACP supports only stdio transport.`,
          source: 'project' as const,
          origin: 'workspace' as const
        }))
      assetDiagnostics = [...assetDiagnostics, ...fallbackDiagnostics]
    }
    const cached = await ctx.cache.get('adapter.kiro.session')
    const cachedSessionId = options.type === 'resume' ? cached?.kiroSessionId : undefined
    const lifecycleParams: Record<string, unknown> = { cwd: ctx.cwd, mcpServers }
    if (capabilities.additionalDirectories && adapterConfig.additionalDirs?.length) {
      lifecycleParams.additionalDirectories = adapterConfig.additionalDirs
    }
    if (cachedSessionId != null && capabilities.loadSession) {
      replaying = true
      const loaded = await client.request<unknown>('session/load', {
        ...lifecycleParams,
        sessionId: cachedSessionId
      })
      replaying = false
      sessionResult = normalizeSessionResult(loaded, cachedSessionId)
      nativeSessionId = sessionResult.sessionId
    } else {
      if (cachedSessionId != null && !capabilities.loadSession) {
        emitEvent({
          type: 'error',
          data: {
            code: 'kiro_resume_unsupported',
            message: 'Kiro ACP did not advertise loadSession; starting a new native session.',
            fatal: false
          }
        })
      }
      sessionResult = normalizeSessionResult(
        await client.request<AcpSessionResult>('session/new', lifecycleParams)
      )
      nativeSessionId = sessionResult.sessionId
    }
    if (nativeSessionId == null || nativeSessionId === '') {
      throw new Error('Kiro ACP did not return a native session id.')
    }
    const requestedModel = options.model
    if (requestedModel != null && requestedModel !== 'default') {
      if (!hasAdvertisedModel(sessionResult, requestedModel)) {
        throw new Error(
          `Kiro ACP did not advertise model "${requestedModel}"; only Default or an exact advertised native model is valid.`
        )
      }
      const modelResult = await client.request<unknown>('session/set_model', {
        sessionId: nativeSessionId,
        modelId: requestedModel
      })
      sessionResult = mergeSessionResult(sessionResult, modelResult)
      appliedModel = normalizeSessionResult(modelResult).models?.currentModelId ?? requestedModel
    }
    if (options.effort != null) {
      const config = findAdvertisedEffortConfig(sessionResult, options.effort)
      if (isRecord(config)) {
        const configResult = await client.request<unknown>('session/set_config_option', {
          sessionId: nativeSessionId,
          configId: String(config.id ?? config.configId),
          value: options.effort
        })
        sessionResult = mergeSessionResult(sessionResult, configResult)
        if (resolveSessionEffort(normalizeSessionResult(configResult)) == null) {
          emitEvent({
            type: 'error',
            data: {
              code: 'kiro_effort_unconfirmed',
              message:
                'Kiro accepted the effort setter but did not return active effort state; reporting only its last verified session state.',
              fatal: false
            }
          })
        }
      } else {
        emitEvent({
          type: 'error',
          data: {
            code: 'kiro_effort_unavailable',
            message: 'Kiro ACP did not advertise a reasoning-effort config option; keeping its current effort.',
            fatal: false
          }
        })
      }
    }
    await ctx.cache.set('adapter.kiro.session', {
      kiroSessionId: nativeSessionId,
      title: `OneWorks:${options.sessionId}`
    })
  } catch (error) {
    replaying = false
    await client.close().catch(() => proc.kill('SIGKILL'))
    throw error
  }

  const model = resolveSessionModel(sessionResult, appliedModel)
  projector.setModel(model)
  emitEvent({
    type: 'init',
    data: {
      uuid: options.sessionId,
      adapter: 'kiro',
      model,
      effort: resolveSessionEffort(sessionResult),
      version: initializeResult.agentInfo?.version ?? 'unknown',
      tools: DEFAULT_KIRO_TOOLS,
      slashCommands: [],
      cwd: ctx.cwd,
      agents: [MANAGED_KIRO_AGENT],
      assetDiagnostics
    }
  })

  const sendPrompt = async (content: string) => {
    if (destroyed || nativeSessionId == null || content.trim() === '') return
    activeTurn = true
    turnTerminated = false
    try {
      await client.request(
        'session/prompt',
        {
          sessionId: nativeSessionId,
          content: [{ type: 'text', text: content }]
        },
        { timeoutMs: null }
      )
      terminateTurn()
    } catch (error) {
      if (destroyed) return
      if (error instanceof AcpProtocolError) {
        const message = `Kiro rejected its documented session/prompt wire (code ${error.code}).`
        failSession(new Error(message))
      } else {
        failSession(error)
      }
    }
  }
  const enqueue = (content: string) => {
    sendQueue = sendQueue.then(() => sendPrompt(content)).catch(error => failSession(error))
  }
  const stop = () => {
    if (destroyed) return
    destroyed = true
    const wasActive = activeTurn
    if (wasActive && nativeSessionId != null) {
      projector.interruptCurrentTurn()
      terminateTurn()
    }
    void interactions.cancelAll()
      .then(async () => {
        if (wasActive && nativeSessionId != null) {
          await client.notify('session/cancel', { sessionId: nativeSessionId }).catch(() => undefined)
        }
        if (capabilities.closeSession && nativeSessionId != null) {
          await client.request('session/close', { sessionId: nativeSessionId }).catch(() => undefined)
        }
      })
      .finally(() => client.close().catch(() => proc.kill('SIGTERM')))
  }

  const session: AdapterSession = {
    kill: () => {
      destroyed = true
      void interactions.cancelAll()
      proc.kill('SIGKILL')
    },
    stop,
    emit: (event: AdapterEvent) => {
      if (destroyed) return
      if (event.type === 'message') enqueue(normalizeKiroPrompt(event.content))
      if (event.type === 'interrupt' && nativeSessionId != null && activeTurn) {
        projector.interruptCurrentTurn()
        void interactions.cancelAll()
          .then(() => client.notify('session/cancel', { sessionId: nativeSessionId }))
          .catch(error => {
            emitEvent({ type: 'error', data: { message: getErrorMessage(error), fatal: false } })
          })
        terminateTurn()
      }
      if (event.type === 'stop') stop()
    },
    respondInteraction: (interactionId, data) => interactions.respond(interactionId, data),
    pid: proc.pid
  }

  const initialDescription = options.description?.trim()
  if (initialDescription) {
    // The next event-loop turn lets task/server/CLI bind respondInteraction before Kiro can request input.
    sendQueue = new Promise<void>(resolveStart => setImmediate(resolveStart))
      .then(() => sendPrompt(initialDescription))
      .catch(error => failSession(error))
  }

  return session
}

export const createKiroSession = (ctx: AdapterCtx, options: AdapterQueryOptions) => (
  options.mode === 'direct' ? createDirectKiroSession(ctx, options) : createStreamKiroSession(ctx, options)
)
