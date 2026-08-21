import { callHook } from '@oneworks/hooks'
import type {
  AdapterCtx,
  AdapterEvent,
  AdapterInteractionRequest,
  AdapterOperationData,
  AdapterOutputEvent,
  AdapterQueryOptions
} from '@oneworks/types'
import {
  CANONICAL_ONEWORKS_MCP_SERVER_NAME,
  TRUSTED_ONEWORKS_CLI_PERMISSION_BASH_LOOKUP_KEYS,
  createStartupProfiler,
  resolveMcpPermissionServerKey,
  resolveMcpPermissionServerKeys,
  resolveTrustedOneworksCliPermissionSubjectFromCommand,
  sanitizeMcpPermissionKeySegment
} from '@oneworks/utils'
import packageJson from '../../package.json'
import type { CodexSessionBase } from './session-common'

import { formatCodexCommandForDisplay } from '#~/command-display.js'
import { executeCodexHookInput } from '#~/hook-bridge.js'
import {
  AgentMessageAccumulator,
  CommandOutputAccumulator,
  formatTurnErrorMessage,
  handleIncomingNotification
} from '#~/protocol/incoming.js'
import type {
  CodexInputItem,
  CodexThread,
  CodexTurn,
  CommandExecApprovalParams,
  CommandExecDecision,
  CommandExecutionRequestApprovalResponse,
  FileChangeApprovalParams,
  FileChangeDecision,
  FileChangeRequestApprovalResponse,
  McpServerElicitationRequestParams,
  McpServerElicitationResponse
} from '#~/types.js'

import { acquireCodexAppServer } from './app-server-pool'
import type { CodexAppServerLease } from './app-server-pool'
import { resolveCodexAdapterConfig } from './config'
import { resolveManagedPermissionDecisionForCtx } from './permissions'
import {
  buildFeatureArgs,
  getErrorMessage,
  isInvalidEncryptedContentError,
  isStaleCachedThreadError,
  mapContentToCodexInput,
  toAdapterErrorData,
  toCodexOutboundApprovalPolicy
} from './session-common'
import {
  registerCodexThreadSession,
  registerPendingCodexThreadSession,
  unregisterCodexThreadSession,
  unregisterPendingCodexThreadSession
} from './thread-session-map'
import { createCodexTranscriptHookWatcher } from './transcript-hooks'

const buildPermissionInteractionOptions = () => [
  { label: '同意本次', value: 'allow_once', description: '仅继续这次被拦截的操作。' },
  { label: '同意并在当前会话忽略类似调用', value: 'allow_session', description: '本会话内同类工具不再重复询问。' },
  {
    label: '同意并在当前项目忽略类似调用',
    value: 'allow_project',
    description: '写入 .oo.config.json，后续新会话仍生效。'
  },
  { label: '拒绝本次', value: 'deny_once', description: '拒绝当前这次操作。' },
  { label: '拒绝并在当前会话阻止类似调用', value: 'deny_session', description: '本会话内同类工具直接拒绝。' },
  {
    label: '拒绝并在当前项目阻止类似调用',
    value: 'deny_project',
    description: '写入 .oo.config.json，后续新会话仍生效。'
  }
]

const buildCodexPermissionInteraction = (params: {
  sessionId: string
  interactionId: string
  question: string
  subjectKey: string
  subjectLookupKeys?: string[]
  subjectLabel?: string
  reasons?: string[]
}): AdapterInteractionRequest => ({
  id: params.interactionId,
  payload: {
    sessionId: params.sessionId,
    kind: 'permission',
    question: params.question,
    options: buildPermissionInteractionOptions(),
    permissionContext: {
      adapter: 'codex',
      deniedTools: [params.subjectKey],
      reasons: params.reasons,
      subjectKey: params.subjectKey,
      subjectLookupKeys: params.subjectLookupKeys,
      subjectLabel: params.subjectLabel ?? params.subjectKey,
      scope: 'tool',
      projectConfigPath: '.oo.config.json'
    }
  }
})

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

export const applyCodexAppServerHookEnv = (
  threadConfig: Record<string, unknown>,
  hookEnv: Record<string, string> | undefined
) => {
  if (hookEnv == null) return
  const currentPolicy = isRecord(threadConfig.shell_environment_policy)
    ? threadConfig.shell_environment_policy
    : {}
  threadConfig.shell_environment_policy = {
    ...currentPolicy,
    set: {
      ...(isRecord(currentPolicy.set) ? currentPolicy.set : {}),
      ...hookEnv
    }
  }
}

const readTokenCount = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
)

const CODEX_INITIALIZE_OPERATION_ID = 'codex-app-server-initialize'
const CODEX_RESPONSE_WAIT_OPERATION_ID = 'codex-response-wait'
const CODEX_THREAD_OPERATION_ID = 'codex-thread'
const CODEX_TURN_START_OPERATION_ID = 'codex-turn-start'

export const resolveCodexAppServerClientInfo = (
  clientInfo: { name?: string; title?: string; version?: string } = {}
) => ({
  name: clientInfo.name ?? CANONICAL_ONEWORKS_MCP_SERVER_NAME,
  title: clientInfo.title ?? 'One Works',
  version: clientInfo.version ?? packageJson.version
})

const isAssistantTextMessageEvent = (event: AdapterOutputEvent) => {
  if (event.type !== 'message' || event.data.role !== 'assistant') return false
  const content = event.data.content
  if (typeof content === 'string') {
    return content.trim() !== ''
  }
  return Array.isArray(content) && content.some(item =>
    isRecord(item) &&
    item.type === 'text' &&
    typeof item.text === 'string' &&
    item.text.trim() !== ''
  )
}

const extractMcpToolNameFromMessage = (message: string | undefined) => {
  const trimmed = message?.trim()
  if (trimmed == null || trimmed === '') return undefined

  const quotedMatch = trimmed.match(/tool\s+["'`](.+?)["'`]/i)
  if (quotedMatch?.[1] != null && quotedMatch[1].trim() !== '') {
    return quotedMatch[1].trim()
  }

  const bareMatch = trimmed.match(/tool\s+([\w.:-]+)/i)
  if (bareMatch?.[1] != null && bareMatch[1].trim() !== '') {
    return bareMatch[1].trim()
  }

  return undefined
}

const buildMcpPermissionSubject = (payload: McpServerElicitationRequestParams) => {
  const serverName = payload.serverName?.trim() || 'mcp'
  const serverKeys = resolveMcpPermissionServerKeys(serverName)
  const serverKey = resolveMcpPermissionServerKey(serverName) ?? 'mcp'
  const toolName = payload._meta?.tool_title?.trim() || extractMcpToolNameFromMessage(payload.message)
  const toolKey = sanitizeMcpPermissionKeySegment(toolName) ?? 'tool'
  const subjectLookupKeys = [
    ...serverKeys.map(key => `mcp-${key}-${toolKey}`),
    ...(serverName === CANONICAL_ONEWORKS_MCP_SERVER_NAME ? [CANONICAL_ONEWORKS_MCP_SERVER_NAME] : [])
  ]

  return {
    subjectKey: `mcp-${serverKey}-${toolKey}`,
    subjectLookupKeys,
    subjectLabel: toolName != null && toolName !== ''
      ? `${serverName}:${toolName}`
      : serverName
  }
}

const supportsEmptyMcpAcceptPayload = (requestedSchema: unknown) => {
  const schema = isRecord(requestedSchema) ? requestedSchema : {}
  const schemaProperties = isRecord(schema.properties) ? schema.properties : {}
  const schemaType = typeof schema.type === 'string' ? schema.type : undefined
  const requiredFields = Array.isArray(schema.required)
    ? schema.required.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    : []

  return schemaType === 'object' && Object.keys(schemaProperties).length === 0 && requiredFields.length === 0
}

const normalizePositiveTokenCount = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined
)

const readOptionalString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined
)

const toCodexThreadSandbox = (policy: CodexSessionBase['sandboxPolicy']) => {
  if (policy.type === 'dangerFullAccess') return 'danger-full-access'
  if (policy.type === 'workspaceWrite') return 'workspace-write'
  if (policy.type === 'readOnly') return 'read-only'
  return undefined
}

export const callCodexObservationalPreCompactHook = async (params: {
  cwd: string
  env: AdapterCtx['env']
  logger: AdapterCtx['logger']
  runtime: AdapterQueryOptions['runtime']
  sessionId: string
  tokenCount?: number
  transcriptPath?: string | null
  trigger?: string
  turnId?: string
}) => {
  try {
    const output = await callHook('PreCompact', {
      adapter: 'codex',
      canBlock: false,
      cwd: params.cwd,
      hookSource: 'bridge',
      runtime: params.runtime,
      sessionId: params.sessionId,
      tokenCount: params.tokenCount,
      transcriptPath: params.transcriptPath,
      trigger: params.trigger,
      turnId: params.turnId
    }, params.env)

    if (output?.continue === false) {
      params.logger.warn(
        '[codex stream hooks] ignoring blocking output from observational PreCompact hook',
        output.stopReason
      )
    }

    if (output?.hookSpecificOutput?.hookEventName === 'PreCompact') {
      params.logger.warn(
        '[codex stream hooks] ignoring hookSpecificOutput from observational PreCompact hook',
        {
          additionalContext: output.hookSpecificOutput.additionalContext != null,
          replacementPrompt: output.hookSpecificOutput.replacementPrompt != null
        }
      )
    }
  } catch (error) {
    params.logger.error('[codex stream hooks] PreCompact failed', error)
  }
}

export const resolveCodexApprovalDecision = (params: {
  answer: string | string[]
  availableDecisions?: string[]
  kind: 'command' | 'file-change'
}): CommandExecDecision | FileChangeDecision => {
  const raw = Array.isArray(params.answer) ? params.answer[0] : params.answer
  const normalized = typeof raw === 'string' ? raw.trim() : ''
  const available = new Set(params.availableDecisions ?? [])
  const supportsSession = available.size === 0 || available.has('acceptForSession')
  const supportsCancel = available.size === 0 || available.has('cancel')

  if (normalized === 'allow_session' || normalized === 'allow_project') {
    return supportsSession ? 'acceptForSession' : 'accept'
  }
  if (normalized === 'allow_once') {
    return 'accept'
  }
  if (normalized === 'cancel') {
    if (params.kind === 'file-change') {
      return 'decline'
    }
    return supportsCancel ? 'cancel' : 'decline'
  }
  return 'decline'
}

export const buildCodexApprovalResponse = (params: {
  answer: string | string[]
  availableDecisions?: string[]
  kind: 'command' | 'file-change'
}): CommandExecutionRequestApprovalResponse | FileChangeRequestApprovalResponse => ({
  decision: resolveCodexApprovalDecision(params)
})

export const buildCodexMcpElicitationResponse = (
  answer: string | string[]
): McpServerElicitationResponse => {
  const raw = Array.isArray(answer) ? answer[0] : answer
  const normalized = typeof raw === 'string' ? raw.trim() : ''
  if (normalized === 'allow_once' || normalized === 'allow_session' || normalized === 'allow_project') {
    return {
      action: 'accept',
      content: {}
    }
  }
  if (normalized === 'deny_once' || normalized === 'deny_session' || normalized === 'deny_project') {
    return { action: 'decline' }
  }
  return { action: 'cancel' }
}

export const releaseCodexAppServerAfterCleanup = async (
  appServer: Pick<CodexAppServerLease, 'release'>,
  cleanup: Promise<unknown>[],
  timeoutMs = 5_000,
  afterCleanup?: () => Promise<void>
) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.allSettled(cleanup),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.max(0, timeoutMs))
        timer.unref?.()
      })
    ])
    await afterCleanup?.()
  } finally {
    if (timer != null) clearTimeout(timer)
    appServer.release()
  }
}

/**
 * Spawn `codex app-server` and drive it over JSON-RPC 2.0 (JSONL),
 * forwarding events to `onEvent`.
 */
export async function createStreamCodexSession(
  base: CodexSessionBase,
  ctx: AdapterCtx,
  options: AdapterQueryOptions & {
    deferInitialFailure?: boolean
    onRecoverableInitialAccountFailure?: (error: Error) => boolean
  }
) {
  const {
    logger,
    cwd,
    binaryPath,
    spawnEnv,
    threadEnv,
    approvalPolicy,
    sandboxPolicy,
    features,
    threadConfig,
    resolvedModel,
    resolvedModelProvider,
    resolvedMaxOutputTokens,
    turnEffort,
    serviceTier,
    threadCacheKey,
    cachedThreadId,
    appServerPoolKey,
    appServerIdleTimeoutMs,
    reconcileCredentialOwner
  } = base
  const { cache } = ctx
  const { native: nativeConfig } = resolveCodexAdapterConfig(ctx)
  const { onEvent, description, sessionId, extraOptions, type: sessionType } = options
  const model = resolvedModel
  const rpcApprovalPolicy = toCodexOutboundApprovalPolicy(approvalPolicy)
  const startupProfiler = createStartupProfiler({
    config: ctx.configState?.mergedConfig,
    cwd: spawnEnv.HOME ?? cwd,
    ctxId: ctx.ctxId,
    env: ctx.env,
    sessionId
  })

  const {
    experimentalApi = false,
    maxOutputTokens: adapterMaxOutputTokens,
    clientInfo: rawClientInfo = {}
  } = nativeConfig
  const maxOutputTokens = typeof resolvedMaxOutputTokens === 'number'
    ? resolvedMaxOutputTokens
    : resolvedMaxOutputTokens === null
    ? undefined
    : adapterMaxOutputTokens
  const clientInfo = resolveCodexAppServerClientInfo(rawClientInfo)

  const nativeSpawnStartedAt = startupProfiler.now()
  if (appServerPoolKey == null) {
    throw new Error('Codex stream mode requires an app-server pool profile.')
  }
  const appServer = await acquireCodexAppServer({
    args: [
      ...buildFeatureArgs(features),
      ...(extraOptions ?? [])
    ],
    binaryPath,
    clientInfo,
    cwd: spawnEnv.HOME ?? cwd,
    env: spawnEnv,
    experimentalApi,
    idleTimeoutMs: appServerIdleTimeoutMs,
    logger,
    profileKey: appServerPoolKey
  }).catch(async (error) => {
    await reconcileCredentialOwner?.().catch((reconcileError) => {
      logger.warn('[codex session] credential owner reconciliation failed after app-server acquisition', {
        error: getErrorMessage(reconcileError),
        sessionId
      })
    })
    throw error
  })
  applyCodexAppServerHookEnv(threadConfig, appServer.hookEnv)
  startupProfiler.mark('codex.native.spawn', nativeSpawnStartedAt, {
    binaryPath: String(binaryPath),
    pid: appServer.pid
  })
  const rpc = appServer.rpc
  appServer.setHookHandler?.(input =>
    executeCodexHookInput(input, {
      env: threadEnv,
      runtime: options.runtime,
      sessionId
    }, ctx.env)
  )
  const msgAcc = new AgentMessageAccumulator()
  const cmdAcc = new CommandOutputAccumulator()
  let threadId: string | undefined
  let activeTurnId: string | undefined
  let usedCachedThread = false
  let didEmitExit = false
  let didEmitFatalError = false
  let initialTurnCommitted = options.description == null
  let transcriptHookWatcher: ReturnType<typeof createCodexTranscriptHookWatcher> | undefined
  const threadSessionMapPath = spawnEnv.__ONEWORKS_CODEX_THREAD_SESSION_MAP__
  const activeOperationIds = new Set<string>()
  const activeOperationTimers = new Map<string, Array<ReturnType<typeof setTimeout>>>()
  const pendingApprovals = new Map<string, {
    rpcId: number
    availableDecisions?: string[]
    kind: 'command' | 'file-change' | 'mcp-elicitation'
  }>()
  const emitEvent = (event: AdapterOutputEvent) => {
    if (event.type === 'error' && event.data.fatal !== false) {
      didEmitFatalError = true
    }
    if (isAssistantTextMessageEvent(event)) {
      finishOperation(
        'operation_completed',
        CODEX_RESPONSE_WAIT_OPERATION_ID,
        'Codex returned an assistant response.'
      )
    }
    if (event.type === 'message' || event.type === 'interaction_request' || event.type === 'stop') {
      initialTurnCommitted = true
    }
    onEvent(event)
  }
  const clearOperationTimers = (operationId: string) => {
    const timers = activeOperationTimers.get(operationId)
    if (timers == null) return
    for (const timer of timers) {
      clearTimeout(timer)
    }
    activeOperationTimers.delete(operationId)
  }
  const emitOperation = (data: Omit<AdapterOperationData, 'adapter'>) => {
    emitEvent({
      type: 'operation',
      data: {
        adapter: 'codex',
        ...data
      }
    })
  }
  const startOperation = (params: {
    delayedMessages?: Array<{ afterMs: number; message: string }>
    message: string
    operationId: string
    title: string
  }) => {
    clearOperationTimers(params.operationId)
    emitOperation({
      type: 'operation_started',
      operationId: params.operationId,
      title: params.title,
      message: params.message
    })
    activeOperationIds.add(params.operationId)
    if (params.delayedMessages == null || params.delayedMessages.length === 0) {
      return
    }
    activeOperationTimers.set(
      params.operationId,
      params.delayedMessages.map(delayedMessage =>
        setTimeout(() => {
          emitOperation({
            type: 'operation_started',
            operationId: params.operationId,
            title: params.title,
            message: delayedMessage.message
          })
        }, delayedMessage.afterMs)
      )
    )
  }
  const finishOperation = (
    type: 'operation_completed' | 'operation_failed',
    operationId: string,
    message: string,
    error?: string
  ) => {
    const wasActive = activeOperationIds.has(operationId) || activeOperationTimers.has(operationId)
    clearOperationTimers(operationId)
    activeOperationIds.delete(operationId)
    if (!wasActive) return
    emitOperation({
      type,
      operationId,
      message,
      ...(error != null ? { error } : {})
    })
  }
  const finishAllActiveOperations = (
    type: 'operation_completed' | 'operation_failed',
    message: string,
    error?: string
  ) => {
    for (const operationId of [...activeOperationIds]) {
      finishOperation(type, operationId, message, error)
    }
  }

  let releaseActiveResourcesPromise: Promise<void> | undefined
  const releaseActiveResources = () => {
    if (releaseActiveResourcesPromise != null) return releaseActiveResourcesPromise
    releaseActiveResourcesPromise = (async () => {
      const cleanup: Promise<unknown>[] = []
      const approvalResponses: Array<{ id: number; result: unknown }> = []
      for (const pending of pendingApprovals.values()) {
        approvalResponses.push({
          id: pending.rpcId,
          result: pending.kind === 'mcp-elicitation' ? { action: 'cancel' } : { decision: 'decline' }
        })
      }
      pendingApprovals.clear()
      const closingThreadId = threadId
      if (appServer.closeSession != null && closingThreadId != null) {
        cleanup.push(
          appServer.closeSession({
            responses: approvalResponses,
            threadId: closingThreadId,
            ...(activeTurnId == null ? {} : { turnId: activeTurnId })
          }).catch((error) => {
            logger.debug('[codex session] manager-side close during release failed', {
              error: getErrorMessage(error),
              sessionId,
              threadId: closingThreadId
            })
          })
        )
      } else {
        for (const response of approvalResponses) rpc.respond(response.id, response.result)
      }
      if (appServer.closeSession == null && threadId != null && activeTurnId != null) {
        const interruptThreadId = threadId
        cleanup.push(
          rpc.request('turn/interrupt', {
            threadId: interruptThreadId,
            turnId: activeTurnId
          }).catch((error) => {
            logger.debug('[codex session] turn/interrupt during release failed', {
              error: getErrorMessage(error),
              sessionId,
              threadId: interruptThreadId
            })
          })
        )
      }
      cleanup.push(
        detachThread({ remote: appServer.closeSession == null }).catch((error) => {
          logger.debug('[codex session] thread detach during release failed', {
            error: getErrorMessage(error),
            sessionId
          })
        })
      )
      if (appServer.drain != null) cleanup.push(appServer.drain())

      await releaseCodexAppServerAfterCleanup(
        appServer,
        cleanup,
        5_000,
        reconcileCredentialOwner
      )
    })().catch((error) => {
      logger.debug('[codex session] release cleanup failed', {
        error: getErrorMessage(error),
        sessionId
      })
    })
    return releaseActiveResourcesPromise
  }

  const emitExitAfterRelease = (data: Extract<AdapterOutputEvent, { type: 'exit' }>['data']) => {
    void releaseActiveResources().then(() => {
      emitEvent({ type: 'exit', data })
    })
  }

  const emitFailureAndExit = (err: unknown) => {
    if (didEmitExit) return
    didEmitExit = true
    const stderr = getErrorMessage(err)
    finishAllActiveOperations('operation_failed', 'Codex session failed.', stderr)
    logger.error('[codex session] stream session failed', { err, sessionId, threadId })
    if (!didEmitFatalError) {
      emitEvent({ type: 'error', data: toAdapterErrorData(err) })
    }
    emitExitAfterRelease({ exitCode: 1, stderr })
  }

  const readThreadCache = async () => (await cache.get('adapter.codex.threads')) ?? {}

  const writeThreadCache = async (nextThreadId: string) => {
    const cachedThreads = await readThreadCache()
    if (cachedThreads[threadCacheKey] === nextThreadId) return
    await cache.set('adapter.codex.threads', { ...cachedThreads, [threadCacheKey]: nextThreadId })
  }

  const deleteCachedThread = async () => {
    const cachedThreads = await readThreadCache()
    if (!(threadCacheKey in cachedThreads)) return
    const { [threadCacheKey]: _removed, ...rest } = cachedThreads
    await cache.set('adapter.codex.threads', rest)
  }

  const handleNotification = (method: string, params: Record<string, unknown>) => {
    if (method === 'turn/started') {
      activeTurnId = (params as { turn?: { id?: string } }).turn?.id
    } else if (method === 'turn/completed') {
      const turn = (params as { turn?: CodexTurn }).turn
      if (turn?.status === 'failed') {
        logger.error('[codex session] turn failed', {
          sessionId,
          threadId,
          turnId: turn.id,
          error: turn.error
        })
        const turnError = new Error(formatTurnErrorMessage(turn.error))
        if (
          !initialTurnCommitted &&
          options.onRecoverableInitialAccountFailure?.(turnError) === true
        ) {
          didEmitExit = true
          finishAllActiveOperations('operation_failed', 'Codex account attempt failed.', turnError.message)
          activeTurnId = undefined
          void releaseActiveResources()
          return
        }
        handleIncomingNotification(method, params, rpc, emitEvent, msgAcc, cmdAcc, approvalPolicy)
        emitFailureAndExit(turnError)
        activeTurnId = undefined
        return
      }
      finishOperation(
        'operation_completed',
        CODEX_RESPONSE_WAIT_OPERATION_ID,
        'Codex completed the turn.'
      )
      activeTurnId = undefined
    } else if (method === 'item/started') {
      const item = (params as { item?: { type?: string; tokenCount?: unknown; trigger?: unknown } }).item
      if (
        item?.type === 'commandExecution' ||
        item?.type === 'fileChange' ||
        item?.type === 'dynamicToolCall' ||
        item?.type === 'mcpToolCall' ||
        item?.type === 'webSearch'
      ) {
        initialTurnCommitted = true
      }
      if (item?.type === 'contextCompaction') {
        void callCodexObservationalPreCompactHook({
          cwd,
          env: ctx.env,
          logger,
          runtime: options.runtime,
          sessionId,
          tokenCount: normalizePositiveTokenCount(item.tokenCount),
          trigger: readOptionalString(item.trigger),
          turnId: activeTurnId
        })
      }
    } else if (method === 'thread/tokenUsage/updated') {
      const payload = isRecord(params) ? params : {}
      const tokenUsage = isRecord(payload.tokenUsage) ? payload.tokenUsage : {}
      const total = isRecord(tokenUsage.total) ? tokenUsage.total : {}
      const last = isRecord(tokenUsage.last) ? tokenUsage.last : {}
      const counts = activeTurnId == null ? total : last
      const totalTokenCount = readTokenCount(total.totalTokens)
      emitEvent({
        type: 'usage',
        data: {
          id: `codex:${String(payload.threadId ?? threadId ?? 'thread')}:${
            activeTurnId == null ? `restored:${totalTokenCount}` : `${activeTurnId}:${totalTokenCount}`
          }`,
          inputTokens: readTokenCount(counts.inputTokens),
          outputTokens: readTokenCount(counts.outputTokens),
          cacheReadInputTokens: readTokenCount(counts.cachedInputTokens),
          reasoningOutputTokens: readTokenCount(counts.reasoningOutputTokens),
          aggregationMode: activeTurnId == null ? 'cumulative' : 'delta',
          model,
          observedAt: Date.now(),
          quality: 'provider_reported'
        }
      })
    }
    handleIncomingNotification(method, params, rpc, emitEvent, msgAcc, cmdAcc, approvalPolicy)
  }

  const handleRequest = (id: number, method: string, params: Record<string, unknown>) => {
    if (method === 'item/commandExecution/requestApproval') {
      if (approvalPolicy === 'never') {
        initialTurnCommitted = true
        rpc.respond(id, { decision: 'accept' })
        return
      }

      const payload = params as unknown as CommandExecApprovalParams
      const interactionId = `codex-approval:${id}`
      const trustedOneworksCliSubject = resolveTrustedOneworksCliPermissionSubjectFromCommand(payload.command)
      const subjectKey = trustedOneworksCliSubject?.key ?? 'Bash'
      const subjectLookupKeys = trustedOneworksCliSubject == null
        ? undefined
        : TRUSTED_ONEWORKS_CLI_PERMISSION_BASH_LOOKUP_KEYS
      const subjectLabel = trustedOneworksCliSubject?.label
      const managedDecision = resolveManagedPermissionDecisionForCtx({
        ctx,
        subjectKeys: [
          subjectKey,
          ...(subjectLookupKeys ?? [])
        ]
      })
      if (managedDecision === 'allow') {
        initialTurnCommitted = true
        rpc.respond(id, { decision: 'accept' })
        return
      }
      if (managedDecision === 'deny') {
        rpc.respond(id, { decision: 'decline' })
        return
      }

      pendingApprovals.set(interactionId, {
        rpcId: id,
        availableDecisions: payload.availableDecisions,
        kind: 'command'
      })
      const commandStr = formatCodexCommandForDisplay(payload.command)
      emitEvent({
        type: 'interaction_request',
        data: buildCodexPermissionInteraction({
          sessionId,
          interactionId,
          question: payload.reason?.trim() != null && payload.reason.trim() !== ''
            ? `允许执行命令 \`${commandStr}\`？\n原因：${payload.reason.trim()}`
            : `允许执行命令 \`${commandStr}\`？`,
          subjectKey,
          subjectLookupKeys,
          subjectLabel,
          reasons: payload.reason?.trim() ? [payload.reason.trim()] : undefined
        })
      })
      return
    }

    if (method === 'item/fileChange/requestApproval') {
      if (approvalPolicy === 'never') {
        initialTurnCommitted = true
        rpc.respond(id, { decision: 'accept' })
        return
      }

      const payload = params as unknown as FileChangeApprovalParams
      const interactionId = `codex-approval:${id}`
      pendingApprovals.set(interactionId, {
        rpcId: id,
        kind: 'file-change'
      })
      emitEvent({
        type: 'interaction_request',
        data: buildCodexPermissionInteraction({
          sessionId,
          interactionId,
          question: payload.reason?.trim() != null && payload.reason.trim() !== ''
            ? `允许执行文件修改？\n原因：${payload.reason.trim()}`
            : '允许执行文件修改？',
          subjectKey: 'Edit',
          reasons: payload.reason?.trim() ? [payload.reason.trim()] : undefined
        })
      })
      return
    }

    if (method === 'mcpServer/elicitation/request') {
      const payload = params as unknown as McpServerElicitationRequestParams
      const interactionId = `codex-approval:${id}`
      const isPermissionPrompt = payload._meta?.codex_approval_kind === 'mcp_tool_call'
      const supportsEmptyAcceptPayload = supportsEmptyMcpAcceptPayload(payload.requestedSchema)
      const { subjectKey, subjectLookupKeys, subjectLabel } = buildMcpPermissionSubject(payload)
      const toolDescription = payload._meta?.tool_description?.trim()
      const question = payload.message?.trim() || '允许执行 MCP 工具调用？'

      if (approvalPolicy === 'never') {
        if (isPermissionPrompt && supportsEmptyAcceptPayload) initialTurnCommitted = true
        rpc.respond(
          id,
          isPermissionPrompt && supportsEmptyAcceptPayload
            ? {
              action: 'accept',
              content: {}
            } satisfies McpServerElicitationResponse
            : { action: 'cancel' } satisfies McpServerElicitationResponse
        )
        return
      }

      if (isPermissionPrompt && supportsEmptyAcceptPayload) {
        const managedDecision = resolveManagedPermissionDecisionForCtx({
          ctx,
          subjectKeys: subjectLookupKeys
        })
        if (managedDecision === 'allow') {
          initialTurnCommitted = true
          rpc.respond(
            id,
            {
              action: 'accept',
              content: {}
            } satisfies McpServerElicitationResponse
          )
          return
        }
        if (managedDecision === 'deny') {
          rpc.respond(id, { action: 'decline' } satisfies McpServerElicitationResponse)
          return
        }

        pendingApprovals.set(interactionId, {
          rpcId: id,
          kind: 'mcp-elicitation'
        })
        emitEvent({
          type: 'interaction_request',
          data: buildCodexPermissionInteraction({
            sessionId,
            interactionId,
            question,
            subjectKey,
            subjectLookupKeys,
            subjectLabel,
            reasons: [toolDescription, question]
              .filter((value): value is string => typeof value === 'string' && value !== '')
          })
        })
        return
      }

      logger.warn('[codex session] unsupported mcp elicitation request; cancelling', {
        id,
        sessionId,
        threadId,
        activeTurnId,
        method,
        params
      })
      rpc.respond(id, { action: 'cancel' } satisfies McpServerElicitationResponse)
      return
    }

    logger.warn('[codex session] unhandled rpc request', {
      id,
      method,
      sessionId,
      threadId,
      activeTurnId,
      params
    })
  }

  appServer.onExit((code) => {
    if (didEmitExit) return
    didEmitExit = true
    finishAllActiveOperations(
      (code ?? 0) === 0 ? 'operation_completed' : 'operation_failed',
      (code ?? 0) === 0 ? 'Codex session stopped.' : `Codex process exited with code ${code ?? 1}.`
    )
    if ((code ?? 0) !== 0 && !didEmitFatalError) {
      emitEvent({
        type: 'error',
        data: {
          message: `Process exited with code ${code ?? 1}`,
          details: { exitCode: code ?? 1 },
          fatal: true
        }
      })
    }
    emitExitAfterRelease({ exitCode: code ?? undefined })
  })

  const detachThread = async (options: { remote?: boolean } = {}) => {
    const detachedThreadId = threadId
    if (detachedThreadId == null) return
    threadId = undefined
    transcriptHookWatcher?.stop()
    transcriptHookWatcher = undefined
    if (options.remote !== false) {
      await appServer.unregisterThread(detachedThreadId)
      await rpc.request('thread/unsubscribe', { threadId: detachedThreadId }).catch((error) => {
        logger.debug('[codex session] thread/unsubscribe failed', {
          error: getErrorMessage(error),
          sessionId,
          threadId: detachedThreadId
        })
      })
    }
    if (threadSessionMapPath != null) {
      await unregisterCodexThreadSession(threadSessionMapPath, detachedThreadId, sessionId)
    }
  }

  const ensureTranscriptHookWatcher = () => {
    if (spawnEnv.__ONEWORKS_CODEX_HOOKS_ACTIVE__ !== '1' || transcriptHookWatcher != null) return
    transcriptHookWatcher = createCodexTranscriptHookWatcher({
      codexThreadId: '__oneworks_pending_thread__',
      cwd,
      env: ctx.env,
      homeDir: spawnEnv.HOME,
      logger,
      runtime: options.runtime,
      sessionId
    })
    transcriptHookWatcher.start()
  }

  const attachThread = async (nextThreadId: string) => {
    await appServer.registerThread(nextThreadId, cwd, {
      onNotification: handleNotification,
      onRequest: handleRequest
    })
    if (threadSessionMapPath != null) {
      await registerCodexThreadSession(threadSessionMapPath, nextThreadId, {
        env: threadEnv,
        runtime: options.runtime,
        sessionId
      })
    }
    ensureTranscriptHookWatcher()
    transcriptHookWatcher?.setCodexThreadId(nextThreadId)
  }

  const withPendingThreadBinding = <T>(task: () => Promise<T>, pendingThreadId?: string) =>
    appServer.runThreadSetup(async () => {
      ensureTranscriptHookWatcher()
      if (threadSessionMapPath != null) {
        await registerPendingCodexThreadSession(threadSessionMapPath, cwd, {
          env: threadEnv,
          runtime: options.runtime,
          sessionId
        })
      }
      try {
        return await task()
      } finally {
        if (threadSessionMapPath != null) {
          await unregisterPendingCodexThreadSession(threadSessionMapPath, cwd, sessionId)
        }
      }
    }, {
      cwd,
      ...(pendingThreadId == null ? {} : { threadId: pendingThreadId })
    })

  const startNewThread = async () => {
    logger.info('[codex session] starting new thread', { cwd, sessionId })
    startOperation({
      operationId: CODEX_THREAD_OPERATION_ID,
      title: 'Starting Codex thread',
      message: '正在创建 Codex 会话线程…'
    })
    const threadStartStartedAt = startupProfiler.now()
    const startResult = await withPendingThreadBinding(async () => {
      const result = await rpc.request<{ thread: CodexThread }>('thread/start', {
        cwd,
        approvalPolicy: rpcApprovalPolicy,
        ...(toCodexThreadSandbox(sandboxPolicy) != null
          ? { sandbox: toCodexThreadSandbox(sandboxPolicy) }
          : {}),
        config: threadConfig,
        serviceName: CANONICAL_ONEWORKS_MCP_SERVER_NAME,
        ...(model ? { model } : {}),
        ...(resolvedModelProvider ? { modelProvider: resolvedModelProvider } : {}),
        ...(serviceTier !== undefined ? { serviceTier } : {})
      })
      threadId = result.thread.id
      await attachThread(threadId)
      return result
    })
    startupProfiler.mark('codex.native.threadStart', threadStartStartedAt)
    threadId = startResult.thread.id
    usedCachedThread = false
    await writeThreadCache(threadId)
    finishOperation(
      'operation_completed',
      CODEX_THREAD_OPERATION_ID,
      'Codex thread is ready.'
    )
    logger.info('[codex session] thread started', { threadId, sessionId })
  }

  const isRecoverableCachedThreadError = (err: unknown) => (
    isInvalidEncryptedContentError(err) || isStaleCachedThreadError(err)
  )

  const recoverFromCachedThreadError = async (source: string, err: unknown) => {
    logger.warn('[codex session] cached thread is no longer usable; starting a fresh thread', {
      sessionId,
      threadId,
      source,
      error: getErrorMessage(err)
    })
    await deleteCachedThread()
    await detachThread()
    await startNewThread()
  }

  const resumeCachedThread = async (nextThreadId: string) => {
    logger.info('[codex session] resuming thread', { threadId: nextThreadId, sessionId })
    startOperation({
      operationId: CODEX_THREAD_OPERATION_ID,
      title: 'Resuming Codex thread',
      message: '正在恢复 Codex 会话线程…'
    })
    const threadResumeStartedAt = startupProfiler.now()
    const resumeResult = await withPendingThreadBinding(async () => {
      const result = await rpc.request<{ thread: CodexThread }>('thread/resume', {
        threadId: nextThreadId,
        cwd,
        approvalPolicy: rpcApprovalPolicy,
        ...(toCodexThreadSandbox(sandboxPolicy) != null
          ? { sandbox: toCodexThreadSandbox(sandboxPolicy) }
          : {}),
        config: threadConfig,
        ...(model ? { model } : {}),
        ...(resolvedModelProvider ? { modelProvider: resolvedModelProvider } : {}),
        ...(serviceTier !== undefined ? { serviceTier } : {})
      })
      threadId = result.thread.id
      await attachThread(threadId)
      return result
    }, nextThreadId)
    startupProfiler.mark('codex.native.threadResume', threadResumeStartedAt)
    threadId = resumeResult.thread.id
    usedCachedThread = true
    await writeThreadCache(threadId)
    finishOperation(
      'operation_completed',
      CODEX_THREAD_OPERATION_ID,
      'Codex thread is ready.'
    )
  }

  const startTurn = async (input: CodexInputItem[], source: string) => {
    const turnParams: Record<string, unknown> = {
      threadId: threadId!,
      input,
      cwd,
      approvalPolicy: rpcApprovalPolicy,
      sandboxPolicy,
      ...(model ? { model } : {}),
      ...(turnEffort ? { effort: turnEffort } : {}),
      ...(serviceTier !== undefined ? { serviceTier } : {}),
      ...(typeof maxOutputTokens === 'number' ? { maxOutputTokens } : {})
    }

    try {
      logger.info('[codex session] starting turn', { threadId, input, source })
      startOperation({
        operationId: CODEX_TURN_START_OPERATION_ID,
        title: 'Starting Codex turn',
        message: source === 'initial'
          ? '正在启动 Codex 首轮处理…'
          : '正在把消息发送给 Codex…',
        delayedMessages: [
          {
            afterMs: 5_000,
            message: 'Codex 仍在启动本轮处理，通常是在加载工具、MCP 或连接 ChatGPT…'
          },
          {
            afterMs: 20_000,
            message: 'Codex 本轮启动耗时较长，可能正在初始化远程插件或等待 ChatGPT 连接…'
          },
          {
            afterMs: 45_000,
            message: 'Codex 仍未确认本轮开始，可能正在重试 ChatGPT 连接。'
          }
        ]
      })
      const turnStartStartedAt = startupProfiler.now()
      const turnResult = await rpc.request<{ turn: CodexTurn }>('turn/start', turnParams)
      startupProfiler.mark('codex.native.turnStart', turnStartStartedAt, {
        source
      })
      finishOperation(
        'operation_completed',
        CODEX_TURN_START_OPERATION_ID,
        'Codex accepted the turn.'
      )
      startOperation({
        operationId: CODEX_RESPONSE_WAIT_OPERATION_ID,
        title: 'Waiting for Codex response',
        message: 'Codex 已接收消息，正在等待 ChatGPT 返回…',
        delayedMessages: [
          {
            afterMs: 15_000,
            message: 'Codex 已开始处理，仍在等待 ChatGPT 生成或网络返回…'
          },
          {
            afterMs: 45_000,
            message: 'Codex 回复耗时较长，仍在等待模型队列、生成或网络返回…'
          }
        ]
      })
      logger.info('[codex session] turn started', { turnId: turnResult.turn.id, source })
      return turnResult
    } catch (err) {
      finishOperation(
        'operation_failed',
        CODEX_TURN_START_OPERATION_ID,
        'Codex failed to start the turn.',
        getErrorMessage(err)
      )
      if (usedCachedThread && isRecoverableCachedThreadError(err)) {
        await recoverFromCachedThreadError(source, err)
        const retryParams = {
          ...turnParams,
          threadId: threadId!
        }
        logger.info('[codex session] retrying turn on fresh thread', { threadId, source })
        const retryTurnStartStartedAt = startupProfiler.now()
        startOperation({
          operationId: CODEX_TURN_START_OPERATION_ID,
          title: 'Retrying Codex turn',
          message: 'Codex 缓存线程不可用，正在用新线程重试…'
        })
        const retryResult = await rpc.request<{ turn: CodexTurn }>('turn/start', retryParams)
        startupProfiler.mark('codex.native.turnStartRetry', retryTurnStartStartedAt, {
          source
        })
        finishOperation(
          'operation_completed',
          CODEX_TURN_START_OPERATION_ID,
          'Codex accepted the retried turn.'
        )
        startOperation({
          operationId: CODEX_RESPONSE_WAIT_OPERATION_ID,
          title: 'Waiting for Codex response',
          message: 'Codex 已接收重试消息，正在等待 ChatGPT 返回…'
        })
        logger.info('[codex session] turn started after retry', { turnId: retryResult.turn.id, source })
        return retryResult
      }
      throw err
    }
  }

  try {
    startOperation({
      operationId: CODEX_INITIALIZE_OPERATION_ID,
      title: 'Initializing Codex app-server',
      message: '正在初始化 Codex app-server…'
    })
    finishOperation(
      'operation_completed',
      CODEX_INITIALIZE_OPERATION_ID,
      'Codex app-server is initialized.'
    )
    logger.info('[codex session] shared app-server is ready', {
      pid: appServer.pid,
      userAgent: appServer.userAgent
    })

    if (sessionType === 'resume' && cachedThreadId != null) {
      try {
        await resumeCachedThread(cachedThreadId)
      } catch (err) {
        if (!isRecoverableCachedThreadError(err)) throw err
        await recoverFromCachedThreadError('thread/resume', err)
      }
    } else {
      await startNewThread()
    }

    if (description) {
      const input: CodexInputItem[] = [{ type: 'text', text: description }]
      await startTurn(input, 'initial')
    }
  } catch (err) {
    if (options.deferInitialFailure === true && !initialTurnCommitted) {
      didEmitExit = true
      finishAllActiveOperations('operation_failed', 'Codex account attempt failed.', getErrorMessage(err))
      await releaseActiveResources()
      throw err
    }
    emitFailureAndExit(err)
    await releaseActiveResources()
    throw err
  }

  const emit = (event: AdapterEvent) => {
    switch (event.type) {
      case 'message': {
        const textItems: CodexInputItem[] = mapContentToCodexInput(
          event.content as Array<{ type: string; text?: string; url?: string }>
        )
        if (activeTurnId != null) {
          rpc.request('turn/steer', {
            threadId: threadId!,
            input: textItems,
            expectedTurnId: activeTurnId
          }).catch((err) => {
            logger.error('[codex session] turn/steer failed', { err })
            emitFailureAndExit(err)
          })
        } else {
          startTurn(textItems, 'emit').catch((err) => {
            logger.error('[codex session] turn/start from emit failed', { err })
            emitFailureAndExit(err)
          })
        }
        break
      }

      case 'interrupt': {
        if (activeTurnId != null) {
          rpc.request('turn/interrupt', {
            threadId: threadId!,
            turnId: activeTurnId
          }).catch((err) => {
            logger.error('[codex session] turn/interrupt failed', { err })
          })
        }
        break
      }

      case 'stop': {
        finishAllActiveOperations('operation_completed', 'Codex session stopped.')
        if (!didEmitExit) {
          didEmitExit = true
          emitExitAfterRelease({ exitCode: 0 })
        }
        break
      }

      default:
        logger.warn('[codex session] unknown emit event', { event })
        break
    }
  }

  return {
    kill: () => {
      finishAllActiveOperations('operation_completed', 'Codex session stopped.')
      if (!didEmitExit) {
        didEmitExit = true
        emitExitAfterRelease({ exitCode: 0 })
      }
    },
    emit,
    respondInteraction: (interactionId: string, data: string | string[]) => {
      const pending = pendingApprovals.get(interactionId)
      if (pending == null) return

      pendingApprovals.delete(interactionId)
      rpc.respond(
        pending.rpcId,
        pending.kind === 'mcp-elicitation'
          ? buildCodexMcpElicitationResponse(data)
          : buildCodexApprovalResponse({
            answer: data,
            availableDecisions: pending.availableDecisions,
            kind: pending.kind
          })
      )
    },
    pid: appServer.pid
  }
}
