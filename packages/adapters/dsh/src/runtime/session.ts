/* eslint-disable max-lines -- ACP process, turn, interaction, and terminal settlement share one state owner. */
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { Readable, Writable } from 'node:stream'

import { ClientSideConnection, PROTOCOL_VERSION, ndJsonStream } from '@agentclientprotocol/sdk'
import type {
  Agent as AcpAgent,
  Client as AcpClient,
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  SessionUpdate,
  ToolCallContent
} from '@agentclientprotocol/sdk'
import type { AdapterCtx, AdapterEvent, AdapterOutputEvent, AdapterQueryOptions, AdapterSession } from '@oneworks/types'
import { uuid } from '@oneworks/utils/uuid'

import { DSH_VERSION } from './install'
import { prepareDshRuntime } from './prepare'

interface PendingPermission {
  choices: Map<string, PermissionOption>
  options: PermissionOption[]
  resolve: (response: RequestPermissionResponse) => void
}

const MAX_STDERR_BYTES = 64 * 1024
const MAX_ASSISTANT_BYTES_PER_TURN = 8 * 1024 * 1024
const MAX_ASSISTANT_MESSAGE_IDS_PER_TURN = 256
const CANCEL_GRACE_MS = 3_500
const TERMINATE_GRACE_MS = 1_000

const stringifyUnknown = (value: unknown) => {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const contentToText = (content: ToolCallContent[] | null | undefined) => (
  (content ?? []).map(item => {
    if (item.type === 'content' && item.content.type === 'text') return item.content.text
    if (item.type === 'diff') return `${item.path}\n${item.newText}`
    if (item.type === 'terminal') return item.terminalId
    return ''
  }).filter(Boolean).join('\n')
)

const promptToText = (event: Extract<AdapterEvent, { type: 'message' }>) => (
  event.content.map(part => {
    if (part.type === 'text') return part.text
    if (part.type === 'file') return `Attached file: ${part.path}`
    if (part.type === 'tool_result') return stringifyUnknown(part.content)
    if (part.type === 'tool_use') return `Tool context ${part.name}: ${stringifyUnknown(part.input)}`
    return ''
  }).filter(value => value.trim() !== '').join('\n\n')
)

const redactUnknown = (value: unknown, redact: (value: string) => string): unknown => {
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map(item => redactUnknown(item, redact))
  if (value != null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        redact(key),
        redactUnknown(entry, redact)
      ])
    )
  }
  return value
}

const permissionDecisionKind = (value: string) => {
  if (value === 'allow_once' || value === 'allow_session' || value === 'allow_project') return 'allow_once'
  if (value === 'deny_once' || value === 'deny_session' || value === 'deny_project') return 'reject_once'
  return undefined
}

const selectOption = (options: PermissionOption[], value: string) => {
  const kind = permissionDecisionKind(value)
  if (kind != null) return options.find(option => option.kind === kind)
  return options.find(option => option.optionId === value)
}

const shouldAutoAllow = (
  mode: AdapterQueryOptions['permissionMode'],
  _request: RequestPermissionRequest
) => mode === 'bypassPermissions'

const emitToolUpdate = (
  update: Extract<SessionUpdate, { sessionUpdate: 'tool_call' | 'tool_call_update' }>,
  model: string,
  emittedTools: Set<string>,
  emittedToolResults: Set<string>,
  toolEventIds: Map<string, string>,
  redact: (value: string) => string,
  onEvent: AdapterQueryOptions['onEvent']
) => {
  const isInitial = update.sessionUpdate === 'tool_call'
  const eventToolId = toolEventIds.get(update.toolCallId) ?? `dsh-tool:${uuid()}`
  toolEventIds.set(update.toolCallId, eventToolId)
  if (isInitial && !emittedTools.has(update.toolCallId)) {
    emittedTools.add(update.toolCallId)
    onEvent({
      type: 'message',
      data: {
        id: `dsh-tool-use-${eventToolId}`,
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: eventToolId,
          name: redact(`adapter:dsh:${update.kind ?? 'tool'}`),
          input: redactUnknown(update.rawInput ?? { title: update.title }, redact)
        }],
        model,
        createdAt: Date.now()
      }
    })
  }
  if (
    (update.status === 'completed' || update.status === 'failed') &&
    !emittedToolResults.has(update.toolCallId)
  ) {
    emittedToolResults.add(update.toolCallId)
    onEvent({
      type: 'message',
      data: {
        id: `dsh-tool-result-${eventToolId}`,
        role: 'assistant',
        content: [{
          type: 'tool_result',
          tool_use_id: eventToolId,
          content: redact(stringifyUnknown(update.rawOutput) || contentToText(update.content)),
          ...(update.status === 'failed' ? { is_error: true } : {})
        }],
        model,
        createdAt: Date.now()
      }
    })
  }
}

export const createDshSession = async (
  ctx: AdapterCtx,
  options: AdapterQueryOptions
): Promise<AdapterSession> => {
  if (options.mode === 'direct') {
    throw new Error('DSH adapter supports ACP stream mode only; the upstream headless profile is one-shot.')
  }
  if (options.type === 'resume') {
    throw new Error('DSH ACP 0.1 supports fresh automation sessions only; resume is not available.')
  }
  if (options.assetPlan?.mcpServers != null && Object.keys(options.assetPlan.mcpServers).length > 0) {
    throw new Error('DSH ACP 0.1 does not accept MCP servers; remove MCP selections for this adapter.')
  }

  const runtime = await prepareDshRuntime(ctx, options)
  const proc = spawn(runtime.binaryPath, ['--config', runtime.configPath], {
    cwd: runtime.sessionRoot,
    detached: process.platform !== 'win32',
    env: runtime.env,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let stderr = ''
  proc.stderr.setEncoding('utf8')
  proc.stderr.on('data', (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-MAX_STDERR_BYTES)
  })

  const pendingPermissions = new Map<string, PendingPermission>()
  const emittedTools = new Set<string>()
  const emittedToolResults = new Set<string>()
  const toolEventIds = new Map<string, string>()
  const messageChunks = new Map<string, string>()
  const messageEventIds = new Map<string, string>()
  let messageChunkBytes = 0
  let messageChunkOverflow: Error | undefined
  let destroyed = false
  let didEmitExit = false
  let activeTurn = false
  let nativeSessionId = ''
  let promptQueue = Promise.resolve()
  let runtimeReady = false
  let fallbackMessageId = `dsh-message:${uuid()}`
  let runtimeVersion = runtime.usesOfficialManagedComposition ? DSH_VERSION : 'unknown'
  let runtimeAgentName = runtime.usesOfficialManagedComposition ? 'deepseek-harness-acp' : 'custom-acp'
  let stoppingPromise: Promise<void> | undefined
  let forceTerminationRequested = false
  let resolveProcessExit!: () => void
  const processExited = new Promise<void>(resolveExit => {
    resolveProcessExit = resolveExit
  })
  let rejectStartup!: (error: Error) => void
  const startupFailure = new Promise<never>((_resolve, reject) => {
    rejectStartup = reject
  })
  const startupTimer = setTimeout(() => {
    rejectStartup(new Error(`DSH ACP startup timed out after ${runtime.startupTimeoutMs}ms.`))
  }, runtime.startupTimeoutMs)
  startupTimer.unref?.()

  const emitEvent = (event: AdapterOutputEvent) => options.onEvent(event)
  const emitExit = (exitCode?: number, rawStderr?: string) => {
    if (didEmitExit) return
    didEmitExit = true
    const redactedStderr = rawStderr == null ? undefined : runtime.redact(rawStderr).trim()
    emitEvent({
      type: 'exit',
      data: { exitCode, ...(redactedStderr ? { stderr: redactedStderr } : {}) }
    })
  }
  const cancelPermissions = () => {
    for (const pending of pendingPermissions.values()) {
      pending.resolve({ outcome: { outcome: 'cancelled' } })
    }
    pendingPermissions.clear()
  }
  const signalProcessTree = (signal: NodeJS.Signals) => {
    if (proc.pid != null && process.platform !== 'win32') {
      try {
        process.kill(-proc.pid, signal)
        return
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
          ctx.logger.debug('[dsh] process-group signal failed; falling back to the direct child')
        }
      }
    }
    proc.kill(signal)
  }
  const waitForProcessExit = (timeoutMs: number) =>
    Promise.race([
      processExited.then(() => true),
      new Promise<false>(resolveWait => {
        const timer = setTimeout(() => resolveWait(false), timeoutMs)
        timer.unref?.()
      })
    ])
  proc.on('error', error => {
    resolveProcessExit()
    const message = runtime.redact(error.message)
    if (!runtimeReady) {
      rejectStartup(new Error(message))
      return
    }
    if (destroyed) return
    destroyed = true
    cancelPermissions()
    emitEvent({ type: 'error', data: { message, fatal: true } })
    emitExit(1, message)
  })
  proc.on('exit', (code, signal) => {
    resolveProcessExit()
    if (!runtimeReady) {
      rejectStartup(new Error(runtime.redact(stderr || `DSH ACP exited with ${signal ?? `code ${code ?? 1}`}.`)))
      return
    }
    cancelPermissions()
    const exitedDuringTurn = !destroyed && activeTurn
    const exitCode = code == null || exitedDuringTurn ? (destroyed ? 0 : 1) : code
    if (!destroyed && (exitCode !== 0 || exitedDuringTurn)) {
      emitEvent({
        type: 'error',
        data: { message: runtime.redact(stderr || `DSH ACP exited with ${signal ?? `code ${exitCode}`}.`), fatal: true }
      })
    }
    destroyed = true
    emitExit(exitCode, stderr)
  })

  const stream = ndJsonStream(
    Writable.toWeb(proc.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(proc.stdout) as ReadableStream<Uint8Array>
  )
  const handleUpdate = (params: SessionNotification) => {
    if (destroyed) return
    const update = params.update
    if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
      const rawMessageId = update.messageId
      const messageId = rawMessageId == null
        ? fallbackMessageId
        : (messageEventIds.get(rawMessageId) ?? `dsh-message:${uuid()}`)
      if (rawMessageId != null) messageEventIds.set(rawMessageId, messageId)
      const nextChunkBytes = Buffer.byteLength(update.content.text)
      if (
        messageChunkBytes + nextChunkBytes > MAX_ASSISTANT_BYTES_PER_TURN ||
        (!messageChunks.has(messageId) && messageChunks.size >= MAX_ASSISTANT_MESSAGE_IDS_PER_TURN)
      ) {
        messageChunks.clear()
        messageChunkBytes = 0
        messageChunkOverflow ??= new Error('DSH ACP assistant output exceeded the per-turn safety limit.')
        void client.cancel({ sessionId: nativeSessionId }).catch(() => undefined)
        return
      }
      messageChunks.set(messageId, `${messageChunks.get(messageId) ?? ''}${update.content.text}`)
      messageChunkBytes += nextChunkBytes
      return
    }
    if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      emitToolUpdate(
        update,
        runtime.model,
        emittedTools,
        emittedToolResults,
        toolEventIds,
        runtime.redact,
        emitEvent
      )
      return
    }
    if (update.sessionUpdate === 'session_info_update' && update.title != null) {
      emitEvent({ type: 'session_update', data: { title: runtime.redact(update.title) } })
    }
  }
  const requestPermission = async (request: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
    if (destroyed) return { outcome: { outcome: 'cancelled' } }
    if (options.permissionMode === 'dontAsk') return { outcome: { outcome: 'cancelled' } }
    if (shouldAutoAllow(options.permissionMode, request)) {
      const selected = request.options.find(option => option.kind === 'allow_once')
      if (selected != null) return { outcome: { outcome: 'selected', optionId: selected.optionId } }
      emitEvent({
        type: 'error',
        data: {
          code: 'dsh_request_scoped_permission_unavailable',
          message: 'DSH requested permission without a request-scoped allow option; the request was cancelled.',
          fatal: false
        }
      })
      return { outcome: { outcome: 'cancelled' } }
    }
    const interactionId = `dsh-permission:${uuid()}`
    const redactedKind = request.toolCall.kind == null ? undefined : runtime.redact(request.toolCall.kind)
    const subjectLabel = runtime.redact(
      request.toolCall.title?.trim() || redactedKind || 'DSH tool request'
    )
    const subjectLookupKeys = Array.from(
      new Set(
        [redactedKind, subjectLabel].filter((value): value is string => typeof value === 'string')
      )
    )
    return new Promise<RequestPermissionResponse>((resolvePermission) => {
      const choices = new Map<string, PermissionOption>()
      const projectedOptions = request.options.map(option => {
        const value = option.kind === 'allow_once'
          ? 'allow_once'
          : option.kind === 'reject_once'
          ? 'deny_once'
          : `dsh-native-option:${uuid()}`
        choices.set(value, option)
        return {
          label: runtime.redact(option.name),
          value,
          description: `DSH permission: ${option.kind}`
        }
      })
      pendingPermissions.set(interactionId, { choices, options: request.options, resolve: resolvePermission })
      emitEvent({
        type: 'interaction_request',
        data: {
          id: interactionId,
          payload: {
            sessionId: options.sessionId,
            kind: 'permission',
            question: subjectLabel,
            options: projectedOptions,
            permissionContext: {
              adapter: 'dsh',
              currentMode: options.permissionMode,
              subjectKey: subjectLabel,
              subjectLookupKeys,
              subjectLabel,
              scope: 'tool',
              projectConfigPath: '.oo.config.json'
            }
          }
        }
      })
    })
  }
  const makeClient = (_agent: AcpAgent): AcpClient => ({
    requestPermission,
    sessionUpdate(params) {
      handleUpdate(params)
      return Promise.resolve()
    }
  })
  const client = new ClientSideConnection(makeClient, stream)
  const beginTermination = (force: boolean) => {
    if (force) forceTerminationRequested = true
    if (stoppingPromise != null) {
      return
    }
    destroyed = true
    activeTurn = false
    cancelPermissions()
    stoppingPromise = (async () => {
      await Promise.race([
        client.cancel({ sessionId: nativeSessionId }).catch(() => undefined),
        new Promise<void>(resolveWait => {
          const timer = setTimeout(resolveWait, CANCEL_GRACE_MS)
          timer.unref?.()
        })
      ])
      proc.stdin.end()
      if (await waitForProcessExit(CANCEL_GRACE_MS)) return
      if (await waitForProcessExit(0)) return
      signalProcessTree(forceTerminationRequested ? 'SIGKILL' : 'SIGTERM')
      if (forceTerminationRequested || await waitForProcessExit(TERMINATE_GRACE_MS)) return
      signalProcessTree('SIGKILL')
      await waitForProcessExit(TERMINATE_GRACE_MS)
    })().catch(error => {
      ctx.logger.error('[dsh] failed to terminate ACP process tree', { error: runtime.redact(String(error)) })
    })
  }

  try {
    const initialized = await Promise.race([
      client.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {}
      }),
      startupFailure
    ])
    if (initialized.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error(`DSH ACP negotiated unsupported protocol ${initialized.protocolVersion}.`)
    }
    if (
      runtime.usesOfficialManagedComposition &&
      initialized.agentInfo?.name !== 'deepseek-harness-acp'
    ) {
      throw new Error('DSH managed runtime did not identify as deepseek-harness-acp.')
    }
    if (!runtime.usesOfficialManagedComposition) {
      runtimeVersion = runtime.redact(initialized.agentInfo?.version?.trim() || 'unknown')
      runtimeAgentName = runtime.redact(initialized.agentInfo?.name?.trim() || 'custom-acp')
    }
    if (
      initialized.agentCapabilities?.promptCapabilities?.image === true ||
      initialized.agentCapabilities?.promptCapabilities?.audio === true
    ) {
      ctx.logger.debug('[dsh] upstream advertised additional prompt capabilities')
    }
    const session = await Promise.race([
      client.newSession({ cwd: ctx.cwd, mcpServers: [] }),
      startupFailure
    ])
    nativeSessionId = session.sessionId
    if (nativeSessionId === '') throw new Error('DSH ACP did not return a session id.')
    runtimeReady = true
    clearTimeout(startupTimer)
  } catch (error) {
    clearTimeout(startupTimer)
    destroyed = true
    cancelPermissions()
    signalProcessTree('SIGKILL')
    await waitForProcessExit(TERMINATE_GRACE_MS)
    const message = runtime.redact(error instanceof Error ? error.message : String(error))
    throw new Error(`DSH ACP startup failed: ${message}`)
  }

  emitEvent({
    type: 'init',
    data: {
      uuid: options.sessionId,
      adapter: 'dsh',
      model: runtime.model,
      version: runtimeVersion,
      tools: ['bash', 'read', 'write', 'edit', 'todo_write'],
      slashCommands: [],
      cwd: ctx.cwd,
      agents: [runtimeAgentName],
      assetDiagnostics: options.assetPlan?.diagnostics,
      sessionRecovery: 'live-only'
    }
  })
  const sendPrompt = async (event: Extract<AdapterEvent, { type: 'message' }>) => {
    if (destroyed) return
    if (event.content.some(part => part.type === 'image')) {
      emitEvent({
        type: 'error',
        data: {
          code: 'dsh_media_unsupported',
          message: 'DSH ACP 0.1 accepts text prompts only; remove image attachments and retry.',
          fatal: false
        }
      })
      emitEvent({ type: 'stop' })
      return
    }
    const text = promptToText(event)
    if (text.trim() === '') return
    messageChunks.clear()
    messageEventIds.clear()
    messageChunkBytes = 0
    messageChunkOverflow = undefined
    fallbackMessageId = `dsh-message:${uuid()}`
    activeTurn = true
    try {
      const result = await client.prompt({
        sessionId: nativeSessionId,
        prompt: [{ type: 'text', text }]
      })
      if (destroyed) return
      if (messageChunkOverflow != null) throw messageChunkOverflow
      for (const [messageId, content] of messageChunks) {
        if (content !== '') {
          emitEvent({
            type: 'message',
            data: {
              id: messageId,
              role: 'assistant',
              content: runtime.redact(content),
              model: runtime.model,
              createdAt: Date.now()
            }
          })
        }
      }
      messageChunks.clear()
      messageChunkBytes = 0
      messageChunkOverflow = undefined
      if (result.usage != null) {
        emitEvent({
          type: 'usage',
          data: {
            aggregationMode: 'cumulative',
            cacheCreationInputTokens: result.usage.cachedWriteTokens ?? undefined,
            cacheReadInputTokens: result.usage.cachedReadTokens ?? undefined,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            reasoningOutputTokens: result.usage.thoughtTokens ?? undefined,
            model: runtime.model,
            quality: 'provider_reported'
          }
        })
      }
      activeTurn = false
      emitEvent({ type: 'stop' })
    } catch (error) {
      activeTurn = false
      messageChunks.clear()
      messageChunkBytes = 0
      if (destroyed) return
      const promptError = messageChunkOverflow ?? error
      messageChunkOverflow = undefined
      const message = runtime.redact(promptError instanceof Error ? promptError.message : String(promptError))
      emitEvent({ type: 'error', data: { message, fatal: false } })
      emitEvent({ type: 'stop' })
    }
  }

  const enqueuePrompt = (event: Extract<AdapterEvent, { type: 'message' }>) => {
    if (destroyed) return
    promptQueue = promptQueue.then(() => sendPrompt(event)).catch(error => {
      ctx.logger.error('[dsh] prompt queue failed', { error: runtime.redact(String(error)) })
    })
  }
  if (options.description?.trim()) {
    enqueuePrompt({ type: 'message', content: [{ type: 'text', text: options.description }] })
  }

  return {
    kill: () => beginTermination(true),
    stop: () => beginTermination(false),
    emit: event => {
      if (event.type === 'message') {
        enqueuePrompt(event)
      } else if (event.type === 'interrupt') {
        if (destroyed) return
        cancelPermissions()
        void client.cancel({ sessionId: nativeSessionId }).catch(() => undefined)
      } else {
        beginTermination(false)
      }
    },
    respondInteraction: async (interactionId, data) => {
      const pending = pendingPermissions.get(interactionId)
      if (pending == null) return
      pendingPermissions.delete(interactionId)
      const value = (Array.isArray(data) ? data[0] : data)?.trim() ?? 'cancel'
      const selected = value === 'cancel'
        ? undefined
        : (selectOption(pending.options, value) ?? pending.choices.get(value))
      pending.resolve(
        selected == null
          ? { outcome: { outcome: 'cancelled' } }
          : { outcome: { outcome: 'selected', optionId: selected.optionId } }
      )
    },
    pid: proc.pid
  }
}
