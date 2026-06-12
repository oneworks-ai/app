import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { env as processEnv } from 'node:process'

import { v4 as uuidv4 } from 'uuid'

import { generateAdapterQueryOptions, run } from '@oneworks/app-runtime'
import type {
  ChatMessage,
  ChatMessageContent,
  EffortLevel,
  Session,
  SessionPermissionMode,
  WSEvent
} from '@oneworks/core'
import { DEFAULT_SUPPORTED_PROTOCOL_RANGE, getCurrentProtocolVersion } from '@oneworks/runtime-protocol'
import type { RuntimeCommand, RuntimeEvent } from '@oneworks/runtime-protocol'
import type {
  AdapterErrorData,
  AdapterOutputEvent,
  AdapterQueryOptions,
  AskUserQuestionParams,
  PermissionInteractionDecision,
  SessionInfo,
  SessionPromptType
} from '@oneworks/types'
import { resolveProjectOoBaseDir } from '@oneworks/utils'

import { handleChannelSessionEvent, resolveChannelSessionMcpServers } from '#~/channels/index.js'
import { buildChannelSessionStopEvent } from '#~/channels/session-delivery.js'
import { getDb } from '#~/db/index.js'
import { loadConfigState } from '#~/services/config/index.js'
import { resolveRuntimeProtocolCliCommand } from '#~/services/runtime-cli-command.js'
import { discoverRuntimeSessionStores, migrateRuntimeRoots } from '#~/services/runtime-store/discovery.js'
import {
  createServerRuntimeSession,
  resolveSessionRuntimeStoreRoot,
  summarizeRuntimeSessionContent
} from '#~/services/runtime-store/session-control.js'
import { watchRuntimeStoreRoot } from '#~/services/runtime-store/watcher.js'
import { createWorkspaceRuntimeEnv } from '#~/services/runtime-store/workspace-env.js'
import {
  buildChannelRuntimeSystemPrompt,
  createSessionChannelMemoryEnv,
  writeChannelMessageContext
} from '#~/services/session/channel-context.js'
import { applySessionEvent } from '#~/services/session/events.js'
import {
  canRequestInteraction,
  requestInteraction,
  resolvePendingInteractionAsCancelled,
  waitForInteractionDeliveryPath
} from '#~/services/session/interaction.js'
import { maybeNotifySession } from '#~/services/session/notification.js'
import {
  applyPermissionInteractionDecision,
  buildPermissionInteractionPayload,
  resolvePermissionDecision as resolveStoredPermissionDecision,
  resolvePermissionSubjectFromInput,
  syncPermissionStateMirrorBestEffort
} from '#~/services/session/permission.js'
import {
  armNextQueueInterrupt,
  listSessionQueuedMessages,
  maybeDispatchQueuedTurn,
  shouldInterruptForQueuedNext
} from '#~/services/session/queue.js'
import type { AdapterSessionRuntime } from '#~/services/session/runtime.js'
import {
  bindAdapterSessionRuntime,
  broadcastSessionEvent,
  createSessionConnectionState,
  deleteAdapterSessionRuntime,
  deleteExternalSessionRuntime,
  emitRuntimeEvent,
  getAdapterSessionRuntime,
  getExternalSessionRuntime,
  notifySessionUpdated,
  parkAdapterSessionRuntime,
  setAdapterSessionRuntime,
  takeExternalSessionRuntime
} from '#~/services/session/runtime.js'
import {
  beginSessionWorkspaceChangeTracking,
  clearSessionWorkspaceChangeTracking,
  finalizeSessionWorkspaceChangeTracking
} from '#~/services/session/workspace-changes.js'
import { provisionSessionWorkspace, resolveSessionWorkspace } from '#~/services/session/workspace.js'
import { runConfiguredWorktreeEnvironmentScripts } from '#~/services/worktree-environments.js'
import { getSessionLogger } from '#~/utils/logger.js'

const activeAdapterRunStore = new Map<string, string>()
export const adapterSessionStartStore = new Map<string, Promise<AdapterSessionRuntime>>()
const pendingPermissionRecoveryStore = new Map<string, { runId: string; interactionId?: string }>()
const recentPermissionToolUseStore = new Map<string, Map<string, string>>()
const PERMISSION_REQUIRED_CODE = 'permission_required'
const PERMISSION_DECISION_CANCEL = 'cancel'
const PERMISSION_CONTINUE_PROMPT = '权限规则已更新。请继续刚才被权限拦截的工作，并重试被阻止的操作。'
const PROJECT_OO_BASE_DIR_ENV = '__ONEWORKS_PROJECT_BASE_DIR__'
const PROJECT_OO_BASE_DIR_RESOLVE_CWD_ENV = '__ONEWORKS_PROJECT_BASE_DIR_RESOLVE_CWD__'
const PROJECT_LAUNCH_CWD_ENV = '__ONEWORKS_PROJECT_LAUNCH_CWD__'
const PROJECT_WORKSPACE_FOLDER_ENV = '__ONEWORKS_PROJECT_WORKSPACE_FOLDER__'
const PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD_ENV = '__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__'
const ADAPTER_CLI_PREPARE_OPERATION_ID = 'adapter-cli-prepare'

const SESSION_PERMISSION_MODES = new Set<SessionPermissionMode>([
  'default',
  'acceptEdits',
  'plan',
  'dontAsk',
  'bypassPermissions'
])

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''
const normalizeSessionTitleUpdate = (value: unknown) => isNonEmptyString(value) ? value.trim() : undefined

const buildAdapterCliPrepareRuntimeEvent = (params: {
  adapter?: string
  message?: string
  runId: string
  sessionId: string
  type: 'operation_started' | 'operation_completed' | 'operation_failed'
}): RuntimeEvent => {
  const now = Date.now()
  const status = params.type === 'operation_started'
    ? 'starting'
    : params.type === 'operation_completed'
    ? 'completed'
    : 'failed'

  return {
    protocolVersion: getCurrentProtocolVersion(),
    supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
    id: `operation:${params.runId}:${ADAPTER_CLI_PREPARE_OPERATION_ID}:${params.type}`,
    seq: 0,
    ts: now,
    sessionId: params.sessionId,
    type: params.type,
    operationId: ADAPTER_CLI_PREPARE_OPERATION_ID,
    runId: params.runId,
    visibility: 'audit',
    status,
    title: 'Preparing adapter CLI',
    message: params.message,
    ...(params.adapter != null ? { adapter: params.adapter } : {})
  }
}

const isPathInside = (parentPath: string, targetPath: string) => {
  const relativePath = path.relative(parentPath, targetPath)
  return relativePath === '' || (
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  )
}

const createSessionProjectPathEnv = (params: {
  adapterCwd: string
  assetWorkspaceFolder: string
}) => {
  const adapterCwd = path.resolve(params.adapterCwd)
  const assetWorkspaceFolder = path.resolve(params.assetWorkspaceFolder)
  const env: NodeJS.ProcessEnv = createWorkspaceRuntimeEnv(adapterCwd, processEnv)
  const aiBaseDir = env[PROJECT_OO_BASE_DIR_ENV]?.trim()
  const aiBaseDirSourceCwd = env[PROJECT_OO_BASE_DIR_RESOLVE_CWD_ENV]?.trim()
  const pathEnv: NodeJS.ProcessEnv = {
    ...env,
    [PROJECT_LAUNCH_CWD_ENV]: assetWorkspaceFolder,
    [PROJECT_WORKSPACE_FOLDER_ENV]: assetWorkspaceFolder,
    [PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD_ENV]: assetWorkspaceFolder
  }

  if (
    aiBaseDir != null &&
    aiBaseDir !== '' &&
    path.isAbsolute(aiBaseDir) &&
    !isPathInside(assetWorkspaceFolder, path.resolve(aiBaseDir))
  ) {
    delete pathEnv[PROJECT_OO_BASE_DIR_ENV]
    delete pathEnv[PROJECT_OO_BASE_DIR_RESOLVE_CWD_ENV]
  } else if (
    aiBaseDirSourceCwd == null ||
    aiBaseDirSourceCwd === '' ||
    !isPathInside(assetWorkspaceFolder, path.resolve(aiBaseDirSourceCwd))
  ) {
    pathEnv[PROJECT_OO_BASE_DIR_RESOLVE_CWD_ENV] = assetWorkspaceFolder
  }

  env[PROJECT_OO_BASE_DIR_ENV] = resolveProjectOoBaseDir(assetWorkspaceFolder, pathEnv)
  delete env[PROJECT_OO_BASE_DIR_RESOLVE_CWD_ENV]
  return env
}

export { writeChannelMessageContext } from '#~/services/session/channel-context.js'

interface RuntimeSessionPromptMetadata {
  effort?: EffortLevel
  hostSessionId?: string
  memberKey?: string
  permissionMode?: SessionPermissionMode
  roomId?: string
  runId?: string
}

const isSessionPermissionMode = (value: unknown): value is SessionPermissionMode => (
  typeof value === 'string' && SESSION_PERMISSION_MODES.has(value as SessionPermissionMode)
)

const readRuntimeSessionPromptMetadata = async (
  runtimeStoreRoot: string,
  sessionId: string
): Promise<RuntimeSessionPromptMetadata | undefined> => {
  try {
    const parsed = JSON.parse(
      await readFile(path.resolve(runtimeStoreRoot, 'sessions', sessionId, 'meta.json'), 'utf8')
    ) as unknown
    if (!isRecord(parsed)) {
      return undefined
    }

    return {
      ...(typeof parsed.effort === 'string' ? { effort: parsed.effort as EffortLevel } : {}),
      ...(isNonEmptyString(parsed.hostSessionId) ? { hostSessionId: parsed.hostSessionId } : {}),
      ...(isNonEmptyString(parsed.memberKey) ? { memberKey: parsed.memberKey } : {}),
      ...(isSessionPermissionMode(parsed.permissionMode) ? { permissionMode: parsed.permissionMode } : {}),
      ...(isNonEmptyString(parsed.roomId) ? { roomId: parsed.roomId } : {}),
      ...(isNonEmptyString(parsed.runId) ? { runId: parsed.runId } : {})
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

const formatAgentRoomRunLine = (params: {
  current: boolean
  memberKey: string
  sessionId: string
  status?: string
  title?: string
}) => {
  const fields = [
    `memberKey=${params.memberKey}`,
    `sessionId=${params.sessionId}`,
    ...(params.status != null ? [`status=${params.status}`] : []),
    ...(params.title != null && params.title.trim() !== '' ? [`title=${params.title.trim()}`] : []),
    ...(params.current ? ['current=true'] : [])
  ]
  return `  - ${fields.join(' | ')}`
}

const buildAgentRoomRuntimeContextPrompt = (
  sessionId: string,
  session: Session | undefined,
  metadata: RuntimeSessionPromptMetadata | undefined
) => {
  const db = getDb()
  const room = metadata?.roomId != null
    ? db.getAgentRoom(metadata.roomId)
    : metadata?.hostSessionId != null
    ? db.getAgentRoomByHostSessionId(metadata.hostSessionId)
    : session?.parentSessionId != null
    ? db.getAgentRoomByHostSessionId(session.parentSessionId)
    : db.getAgentRoomByHostSessionId(sessionId)

  if (room == null) {
    return undefined
  }

  const detail = db.getAgentRoomDetail(room.id)
  if (detail == null || detail.runs.length === 0) {
    return undefined
  }

  const runtimeProtocolCommand =
    `${resolveRuntimeProtocolCliCommand()} --input-format stream-json --output-format stream-json`
  const runLines = detail.runs.map(run =>
    formatAgentRoomRunLine({
      current: run.sessionId === sessionId || run.key === metadata?.runId,
      memberKey: run.memberKey,
      sessionId: run.sessionId,
      status: run.status,
      title: run.title
    })
  )

  return [
    '<system-prompt>',
    'Current Agent Room context:',
    `- roomId: ${room.id}`,
    `- roomTitle: ${room.title}`,
    ...(metadata?.memberKey != null ? [`- currentMemberKey: ${metadata.memberKey}`] : []),
    '- existing member sessions:',
    ...runLines,
    '',
    'Agent Room messaging rules:',
    '- If you need to send a message to another existing member in this room, do not start a new session for that member.',
    '- Use a `session.message` runtime protocol envelope targeting the existing `sessionId` listed above.',
    '- Use `session.start` only when the target member does not already have a session in this room.',
    '- Set `source` to your current member key when sending to another member, so the target session can show who sent it.',
    '',
    'Example:',
    '```bash',
    `cat <<'JSONL' | ${runtimeProtocolCommand}`,
    '{"commandId":"message-existing-member","type":"session.message","sessionId":"<target-session-id>","source":"<your-member-key>","message":"<message to that member>"}',
    'JSONL',
    '```',
    '</system-prompt>'
  ].join('\n')
}

const resolveInteractiveSessionWorktreeDefault = async () => {
  const { mergedConfig } = await loadConfigState()
    .catch(() => ({ mergedConfig: {} as { conversation?: { createSessionWorktree?: boolean } } }))
  return mergedConfig.conversation?.createSessionWorktree ?? false
}

const uniqueStrings = (values: string[]) => [...new Set(values)]

const getPermissionToolUseCache = (sessionId: string) => {
  let cache = recentPermissionToolUseStore.get(sessionId)
  if (cache != null) {
    return cache
  }
  cache = new Map<string, string>()
  recentPermissionToolUseStore.set(sessionId, cache)
  return cache
}

const trimPermissionToolUseCache = (cache: Map<string, string>, maxSize = 128) => {
  while (cache.size > maxSize) {
    const firstKey = cache.keys().next().value as string | undefined
    if (firstKey == null) {
      break
    }
    cache.delete(firstKey)
  }
}

const rememberPermissionToolUses = (sessionId: string, message: unknown) => {
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return
  }

  const cache = getPermissionToolUseCache(sessionId)
  for (const item of message.content) {
    if (!isRecord(item) || item.type !== 'tool_use' || !isNonEmptyString(item.id)) {
      continue
    }

    const rawName = isNonEmptyString(item.name) ? item.name.trim() : undefined
    const normalizedToolName = rawName?.startsWith('adapter:')
      ? rawName.split(':').at(-1)?.trim() ?? rawName
      : rawName
    const subject = resolvePermissionSubjectFromInput({
      toolName: normalizedToolName ?? rawName
    })
    if (subject == null) {
      continue
    }

    cache.set(item.id.trim(), subject.key)
  }

  trimPermissionToolUseCache(cache)
}

const resolvePermissionInteractionDecision = (
  answer: string | string[]
): PermissionInteractionDecision | typeof PERMISSION_DECISION_CANCEL | undefined => {
  const normalizedAnswer = Array.isArray(answer) ? answer[0] : answer
  if (typeof normalizedAnswer !== 'string') return undefined

  const raw = normalizedAnswer.trim()
  if (raw === '') return undefined
  if (raw === PERMISSION_DECISION_CANCEL) return PERMISSION_DECISION_CANCEL

  if (
    raw === 'allow_once' ||
    raw === 'allow_session' ||
    raw === 'allow_project' ||
    raw === 'deny_once' ||
    raw === 'deny_session' ||
    raw === 'deny_project'
  ) {
    return raw
  }

  return undefined
}

const emitSessionError = (sessionId: string, data: AdapterErrorData) => {
  const event: WSEvent = {
    type: 'error',
    data,
    message: data.message
  }

  applySessionEvent(sessionId, event, {
    broadcast: (ev) => broadcastSessionEvent(sessionId, ev),
    onSessionUpdated: (session) => {
      notifySessionUpdated(sessionId, session)
    }
  })
  forwardSessionEventToChannel(sessionId, event)
}

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const forwardSessionEventToChannel = (sessionId: string, event: WSEvent) => {
  void handleChannelSessionEvent(sessionId, event).catch((error) => {
    getSessionLogger(sessionId, 'server').warn({
      sessionId,
      eventType: event.type,
      error: getErrorMessage(error)
    }, '[channel] Failed to deliver session event to bound channel')
  })
}

const buildPermissionDeclinedError = (message: string, code = 'permission_request_declined'): AdapterErrorData => ({
  message,
  code,
  fatal: true
})

const extractPermissionErrorContext = (error: AdapterErrorData) => {
  const details = isRecord(error.details) ? error.details : {}
  const rawDeniedTools = new Set<string>()
  const reasons = new Set<string>()

  const permissionDenials = Array.isArray(details.permissionDenials) ? details.permissionDenials : []
  for (const denial of permissionDenials) {
    if (!isRecord(denial)) continue
    if (isNonEmptyString(denial.message)) {
      reasons.add(denial.message.trim())
    }
    if (Array.isArray(denial.deniedTools)) {
      for (const tool of denial.deniedTools) {
        if (isNonEmptyString(tool)) {
          rawDeniedTools.add(tool.trim())
        }
      }
    }
  }

  if (Array.isArray(details.deniedTools)) {
    for (const tool of details.deniedTools) {
      if (isNonEmptyString(tool)) {
        rawDeniedTools.add(tool.trim())
      }
    }
  }

  if (isNonEmptyString(details.toolName)) {
    rawDeniedTools.add(details.toolName.trim())
  }

  if (isNonEmptyString(error.message)) {
    reasons.add(error.message.trim())
  }

  const deniedTools = [...rawDeniedTools]
  const subjectKeys = uniqueStrings(
    deniedTools
      .map(tool => resolvePermissionSubjectFromInput({ toolName: tool })?.key)
      .filter((key): key is string => key != null && key.trim() !== '')
  )

  return {
    subjectKeys,
    deniedTools,
    reasons: [...reasons]
  }
}

const resolvePermissionErrorContext = (sessionId: string, error: AdapterErrorData) => {
  const context = extractPermissionErrorContext(error)
  if (context.subjectKeys.length > 0) {
    return context
  }

  const details = isRecord(error.details) ? error.details : {}
  const toolUseId = isNonEmptyString(details.toolUseId) ? details.toolUseId.trim() : undefined
  if (toolUseId == null || toolUseId === '') {
    return context
  }

  const cachedSubjectKey = recentPermissionToolUseStore.get(sessionId)?.get(toolUseId)
  if (cachedSubjectKey == null || cachedSubjectKey.trim() === '') {
    return context
  }

  return {
    subjectKeys: uniqueStrings([...context.subjectKeys, cachedSubjectKey]),
    deniedTools: uniqueStrings([...context.deniedTools, cachedSubjectKey]),
    reasons: context.reasons
  }
}

const resolvePermissionInteractionPayload = (
  sessionId: string,
  adapter: string | undefined,
  permissionMode: SessionPermissionMode | undefined,
  error: AdapterErrorData
): AskUserQuestionParams => {
  const context = resolvePermissionErrorContext(sessionId, error)
  return buildPermissionInteractionPayload({
    sessionId,
    adapter,
    subjectKeys: context.subjectKeys,
    deniedTools: context.deniedTools,
    reasons: context.reasons,
    currentMode: permissionMode
  })
}

export const resetSessionServiceState = () => {
  activeAdapterRunStore.clear()
  adapterSessionStartStore.clear()
  pendingPermissionRecoveryStore.clear()
  recentPermissionToolUseStore.clear()
  clearSessionWorkspaceChangeTracking()
}

const clearPendingPermissionRecovery = (sessionId: string) => {
  const pending = pendingPermissionRecoveryStore.get(sessionId)
  if (pending == null) {
    return undefined
  }

  pendingPermissionRecoveryStore.delete(sessionId)
  return pending
}

export async function startAdapterSession(
  sessionId: string,
  options: {
    model?: string
    account?: string
    effort?: EffortLevel
    systemPrompt?: string
    appendSystemPrompt?: boolean
    permissionMode?: SessionPermissionMode
    promptType?: SessionPromptType
    promptName?: string
    adapter?: string
    updateConfiguredSkills?: boolean
  } = {}
) {
  const inFlight = adapterSessionStartStore.get(sessionId)
  if (inFlight != null) {
    return inFlight
  }

  const startPromise = (async () => {
    const db = getDb()
    const historyMessages = db.getMessages(sessionId) as WSEvent[]
    const hasHistory = historyMessages.some(event => event.type === 'message')
    const serverLogger = getSessionLogger(sessionId, 'server')
    const existing = db.getSession(sessionId)
    const runtimeState = db.getSessionRuntimeState(sessionId)
    const resolvedModel = options.model ?? existing?.model
    const resolvedAdapter = options.adapter ?? existing?.adapter
    const resolvedAccount = options.account ?? existing?.account
    let resolvedEffort = options.effort ?? existing?.effort
    let resolvedPermissionMode = options.permissionMode ?? existing?.permissionMode
    const resolvedPromptType = existing?.promptType ?? options.promptType
    const resolvedPromptName = existing?.promptName ?? options.promptName
    const seededFromHistory = runtimeState?.historySeedPending === true &&
      runtimeState.historySeed != null &&
      runtimeState.historySeed.trim() !== ''
    const adapterChanged = existing?.adapter != null && resolvedAdapter != null && existing.adapter !== resolvedAdapter
    const type = !seededFromHistory && hasHistory && !adapterChanged ? 'resume' : 'create'

    const cached = getAdapterSessionRuntime(sessionId)
    if (cached != null) {
      const currentModel = cached.config?.model
      const currentAdapter = cached.config?.adapter
      const currentAccount = cached.config?.account
      const currentEffort = cached.config?.effort
      const currentPermissionMode = cached.config?.permissionMode
      const currentPromptType = cached.config?.promptType
      const currentPromptName = cached.config?.promptName
      const configChanged = currentModel !== resolvedModel ||
        currentAdapter !== resolvedAdapter ||
        currentAccount !== resolvedAccount ||
        currentEffort !== resolvedEffort ||
        currentPermissionMode !== resolvedPermissionMode ||
        currentPromptType !== resolvedPromptType ||
        currentPromptName !== resolvedPromptName

      if (!configChanged) {
        serverLogger.info({ sessionId }, '[server] Reusing existing adapter process')
        return cached
      }

      serverLogger.info({
        sessionId,
        currentModel,
        resolvedModel,
        currentAdapter,
        resolvedAdapter,
        currentAccount,
        resolvedAccount,
        currentEffort,
        resolvedEffort,
        currentPermissionMode,
        resolvedPermissionMode,
        currentPromptType,
        resolvedPromptType,
        currentPromptName,
        resolvedPromptName
      }, '[server] Restarting adapter process due to session config change')
      activeAdapterRunStore.delete(sessionId)
      cached.session.kill()
      deleteAdapterSessionRuntime(sessionId)
    }

    serverLogger.info({
      sessionId,
      type,
      requestedModel: options.model,
      persistedModel: existing?.model,
      resolvedModel,
      requestedAdapter: options.adapter,
      persistedAdapter: existing?.adapter,
      resolvedAdapter,
      requestedAccount: options.account,
      persistedAccount: existing?.account,
      resolvedAccount,
      resolvedEffort,
      resolvedPermissionMode,
      resolvedPromptType,
      resolvedPromptName
    }, '[server] Starting new adapter process')

    if (existing == null) {
      serverLogger.info({ sessionId }, '[server] Session not found in DB, creating new entry')
      db.createSession(undefined, sessionId, undefined, undefined, {
        runtimeKind: 'interactive'
      })
      await provisionSessionWorkspace(sessionId, {
        createWorktree: await resolveInteractiveSessionWorktreeDefault()
      })
    }

    const withResolvedPermissionMode = (
      updates: Partial<Omit<Session, 'id' | 'createdAt' | 'messageCount'>>
    ) => {
      const latestPermissionMode = db.getSession(sessionId)?.permissionMode
      if (
        latestPermissionMode !== existing?.permissionMode &&
        latestPermissionMode !== resolvedPermissionMode
      ) {
        return updates
      }

      return { ...updates, permissionMode: resolvedPermissionMode }
    }

    if (
      resolvedModel !== existing?.model ||
      resolvedAdapter !== existing?.adapter ||
      resolvedAccount !== existing?.account ||
      resolvedEffort !== existing?.effort ||
      resolvedPermissionMode !== existing?.permissionMode ||
      resolvedPromptType !== existing?.promptType ||
      resolvedPromptName !== existing?.promptName
    ) {
      updateAndNotifySession(
        sessionId,
        withResolvedPermissionMode({
          model: resolvedModel,
          adapter: resolvedAdapter,
          account: resolvedAccount,
          effort: resolvedEffort,
          promptType: resolvedPromptType,
          promptName: resolvedPromptName
        })
      )
    }

    const connectionState = takeExternalSessionRuntime(sessionId) ?? createSessionConnectionState()
    const runId = uuidv4()
    activeAdapterRunStore.set(sessionId, runId)
    let adapterCliPrepareOperationActive = false

    const emitAdapterCliPrepareOperation = (
      type: 'operation_started' | 'operation_completed' | 'operation_failed',
      message?: string
    ) => {
      if ((resolvedAdapter ?? options.adapter) !== 'codex') {
        return
      }
      if (activeAdapterRunStore.get(sessionId) !== runId) {
        return
      }

      const runtimeEvent = buildAdapterCliPrepareRuntimeEvent({
        adapter: resolvedAdapter ?? options.adapter,
        message,
        runId,
        sessionId,
        type
      })
      const wsEvent: WSEvent = {
        type: 'adapter_event',
        data: { runtimeEvent }
      }

      applySessionEvent(sessionId, wsEvent, {
        broadcast: (ev) => emitRuntimeEvent(connectionState, ev),
        onSessionUpdated: (session) => {
          notifySessionUpdated(sessionId, session)
        }
      })
      forwardSessionEventToChannel(sessionId, wsEvent)

      adapterCliPrepareOperationActive = type === 'operation_started'
    }

    try {
      const workspace = await resolveSessionWorkspace(sessionId)
      const promptCwd = workspace.workspaceFolder
      const startScriptResults = await runConfiguredWorktreeEnvironmentScripts({
        operation: 'start',
        workspaceFolder: promptCwd,
        environmentId: workspace.worktreeEnvironment,
        sessionId
      })
      if (startScriptResults.length > 0) {
        serverLogger.info({
          sessionId,
          scripts: startScriptResults.map(result => result.scriptPath)
        }, '[server] Ran worktree environment start scripts')
      }
      const [data, resolvedConfig] = await generateAdapterQueryOptions(
        resolvedPromptType,
        resolvedPromptName,
        promptCwd,
        {
          adapter: resolvedAdapter,
          model: resolvedModel,
          updateConfiguredSkills: options.updateConfiguredSkills
        }
      )
      const adapterCwd = resolvedConfig.workspace?.cwd ?? promptCwd
      const runtimeStoreRoot = resolveSessionRuntimeStoreRoot(promptCwd)
      await mkdir(runtimeStoreRoot, { recursive: true })
      await watchRuntimeStoreRoot(runtimeStoreRoot).catch(error => {
        serverLogger.warn({
          sessionId,
          runtimeStoreRoot,
          error: error instanceof Error ? error.message : String(error)
        }, '[runtime-store] Failed to register session runtime root')
      })
      const runtimePromptMetadata = await readRuntimeSessionPromptMetadata(runtimeStoreRoot, sessionId)
      resolvedEffort = resolvedEffort ?? runtimePromptMetadata?.effort
      resolvedPermissionMode = resolvedPermissionMode ?? runtimePromptMetadata?.permissionMode
      if (
        resolvedEffort !== existing?.effort ||
        resolvedPermissionMode !== existing?.permissionMode
      ) {
        updateAndNotifySession(sessionId, withResolvedPermissionMode({ effort: resolvedEffort }))
      }
      const agentRoom = db.getAgentRoomByHostSessionId(sessionId)
      const env = {
        ...createSessionProjectPathEnv({
          adapterCwd,
          assetWorkspaceFolder: promptCwd
        }),
        ...createSessionChannelMemoryEnv(sessionId),
        __ONEWORKS_PROJECT_CTX_ID__: sessionId,
        __ONEWORKS_RUNTIME_PROTOCOL_DEFAULT_ADAPTER__: resolvedAdapter ?? '',
        __ONEWORKS_RUNTIME_PROTOCOL_DEFAULT_MODEL__: resolvedModel ?? '',
        __ONEWORKS_RUNTIME_PROTOCOL_DEFAULT_EFFORT__: resolvedEffort ?? '',
        __ONEWORKS_RUNTIME_PROTOCOL_DEFAULT_PERMISSION_MODE__: resolvedPermissionMode ?? '',
        __ONEWORKS_AGENT_ROOM_HOST_SESSION_ID__: sessionId,
        __ONEWORKS_AGENT_ROOM_ID__: agentRoom?.id ?? '',
        __ONEWORKS_AGENT_ROOM_TITLE__: agentRoom?.title ?? ''
      }
      const finalSystemPrompt = options.appendSystemPrompt === false
        ? (options.systemPrompt ?? resolvedConfig.systemPrompt)
        : [
          resolvedConfig.systemPrompt,
          buildAgentRoomRuntimeContextPrompt(
            sessionId,
            getDb().getSession(sessionId) ?? existing,
            runtimePromptMetadata
          ),
          options.systemPrompt
        ]
          .filter(Boolean)
          .join('\n\n')
      const { mergedConfig } = await loadConfigState(adapterCwd)
        .catch(() => ({ mergedConfig: {} as { modelLanguage?: string } }))
      const { modelLanguage } = mergedConfig
      const languagePrompt = modelLanguage == null
        ? undefined
        : (modelLanguage === 'en' ? 'Please respond in English.' : '请使用中文进行对话。')
      const mergedSystemPrompt = [
        finalSystemPrompt,
        buildChannelRuntimeSystemPrompt(env),
        seededFromHistory ? runtimeState?.historySeed?.trim() : undefined,
        languagePrompt
      ].filter(Boolean).join('\n\n')
      let sawFatalError = false
      let runtimeMcpServers: AdapterQueryOptions['runtimeMcpServers']

      try {
        const resolvedChannelMcpServers = await resolveChannelSessionMcpServers(sessionId)
        if (Object.keys(resolvedChannelMcpServers).length > 0) {
          runtimeMcpServers = resolvedChannelMcpServers
        }
      } catch (error) {
        serverLogger.warn({
          sessionId,
          error: error instanceof Error ? error.message : String(error)
        }, '[channel] Failed to resolve session companion MCP servers')
      }

      await syncPermissionStateMirrorBestEffort(sessionId, {
        adapter: resolvedAdapter
      })

      emitAdapterCliPrepareOperation(
        'operation_started',
        'Preparing Codex CLI. If no compatible system installation is available, One Works will install it now.'
      )

      const { session } = await run({
        env,
        cwd: adapterCwd,
        adapter: resolvedAdapter,
        updateConfiguredSkills: options.updateConfiguredSkills
      }, {
        type,
        runtime: 'server',
        sessionId,
        model: resolvedModel,
        account: resolvedAccount,
        effort: resolvedEffort,
        systemPrompt: mergedSystemPrompt,
        permissionMode: resolvedPermissionMode,
        appendSystemPrompt: options.appendSystemPrompt ?? true,
        tools: resolvedConfig.tools,
        mcpServers: resolvedConfig.mcpServers,
        runtimeMcpServers,
        promptAssetIds: resolvedConfig.promptAssetIds,
        assetBundle: resolvedConfig.assetBundle,
        onEvent: (event: AdapterOutputEvent) => {
          if (activeAdapterRunStore.get(sessionId) !== runId) {
            return
          }

          const broadcast = (ev: WSEvent) => {
            serverLogger.info({ event: 'broadcast', data: ev }, 'Broadcasting event')
            emitRuntimeEvent(connectionState, ev)
          }

          const applyEvent = (ev: WSEvent) => {
            applySessionEvent(sessionId, ev, {
              broadcast,
              onSessionUpdated: (session) => {
                notifySessionUpdated(sessionId, session)
              }
            })
            forwardSessionEventToChannel(sessionId, ev)
          }

          switch (event.type) {
            case 'init':
              if (adapterCliPrepareOperationActive) {
                emitAdapterCliPrepareOperation('operation_completed', 'Codex CLI is ready.')
              }
              if ('model' in (event.data as any)) {
                const reportedModel = typeof (event.data as any).model === 'string'
                  ? (event.data as any).model
                  : undefined
                const reportedAdapter = typeof (event.data as any).adapter === 'string'
                  ? (event.data as any).adapter
                  : undefined
                const reportedAccount = typeof (event.data as any).account === 'string'
                  ? (event.data as any).account
                  : undefined
                const persistedModel = resolvedModel ?? reportedModel
                const persistedAdapter = resolvedAdapter ?? reportedAdapter
                const persistedAccount = resolvedAccount ?? reportedAccount
                serverLogger.info({
                  sessionId,
                  requestedModel: options.model,
                  resolvedModel,
                  reportedModel,
                  persistedModel,
                  requestedAdapter: options.adapter,
                  resolvedAdapter,
                  reportedAdapter,
                  persistedAdapter,
                  requestedAccount: options.account,
                  resolvedAccount,
                  reportedAccount,
                  persistedAccount
                }, '[server] Adapter init received')
                updateAndNotifySession(
                  sessionId,
                  withResolvedPermissionMode({
                    model: persistedModel,
                    adapter: persistedAdapter,
                    account: persistedAccount,
                    effort: resolvedEffort,
                    promptType: resolvedPromptType,
                    promptName: resolvedPromptName
                  })
                )
                applyEvent({
                  type: 'session_info',
                  info: {
                    type: 'init',
                    ...(event.data as any)
                  } as SessionInfo
                })
              }
              break
            case 'context_compaction':
              applyEvent({
                type: 'adapter_event',
                data: {
                  source: 'adapter',
                  adapter: resolvedAdapter ?? options.adapter,
                  type: 'context_compaction',
                  ...event.data,
                  createdAt: event.data.createdAt ?? Date.now()
                }
              })
              break
            case 'session_update': {
              const title = normalizeSessionTitleUpdate(event.data.title)
              if (title != null) {
                updateAndNotifySession(sessionId, { title })
              }
              break
            }
            case 'message':
              if ('role' in (event.data as any)) {
                if ((event.data as any).role === 'assistant') {
                  rememberPermissionToolUses(sessionId, event.data)
                }
                if (
                  pendingPermissionRecoveryStore.get(sessionId)?.runId === runId &&
                  (event.data as any).role === 'assistant'
                ) {
                  break
                }
                applyEvent({
                  type: 'message',
                  message: event.data
                })
                if (
                  (event.data as any).role === 'assistant' &&
                  shouldInterruptForQueuedNext(sessionId, {
                    type: 'message',
                    message: event.data
                  })
                ) {
                  interruptSession(sessionId)
                }
              }
              break
            case 'interaction_request': {
              const interaction = event.data
              const permissionContext = interaction.payload.kind === 'permission'
                ? interaction.payload.permissionContext
                : undefined
              const subject = permissionContext?.subjectKey != null
                ? resolvePermissionSubjectFromInput({ toolName: permissionContext.subjectKey })
                : undefined

              if (typeof session.respondInteraction === 'function') {
                void (async () => {
                  try {
                    if (subject != null) {
                      const storedDecision = await resolveStoredPermissionDecision({
                        sessionId,
                        subject,
                        lookupKeys: permissionContext?.subjectLookupKeys
                      })
                      if (activeAdapterRunStore.get(sessionId) !== runId) return

                      if (storedDecision.result === 'allow') {
                        await session.respondInteraction?.(
                          interaction.id,
                          storedDecision.source === 'onceAllow' ? 'allow_once' : 'allow_session'
                        )
                        return
                      }

                      if (storedDecision.result === 'deny') {
                        await session.respondInteraction?.(
                          interaction.id,
                          storedDecision.source === 'projectDeny' ? 'deny_project' : 'deny_session'
                        )
                        return
                      }
                    }

                    const canDeliverInteraction = canRequestInteraction(sessionId) ||
                      await waitForInteractionDeliveryPath(sessionId)
                    if (activeAdapterRunStore.get(sessionId) !== runId) return

                    if (!canDeliverInteraction) {
                      await session.respondInteraction?.(interaction.id, PERMISSION_DECISION_CANCEL)
                      emitSessionError(sessionId, {
                        message: '权限确认通道不可用，已取消当前操作。',
                        code: 'permission_request_failed',
                        fatal: true
                      })
                      return
                    }

                    pendingPermissionRecoveryStore.set(sessionId, {
                      runId,
                      interactionId: interaction.id
                    })
                    const answer = await requestInteraction(interaction.payload, {
                      interactionId: interaction.id
                    })
                    if (
                      pendingPermissionRecoveryStore.get(sessionId)?.runId !== runId ||
                      pendingPermissionRecoveryStore.get(sessionId)?.interactionId !== interaction.id
                    ) {
                      return
                    }

                    pendingPermissionRecoveryStore.delete(sessionId)
                    const decision = resolvePermissionInteractionDecision(answer)
                    if (decision == null || decision === PERMISSION_DECISION_CANCEL) {
                      await session.respondInteraction?.(interaction.id, PERMISSION_DECISION_CANCEL)
                      emitSessionError(sessionId, buildPermissionDeclinedError('用户取消了本次权限授权。'))
                      return
                    }

                    if (decision !== 'deny_once') {
                      const subjectKey = permissionContext?.subjectKey
                      if (subjectKey != null && subjectKey.trim() !== '') {
                        await applyPermissionInteractionDecision({
                          sessionId,
                          subjectKeys: [subjectKey],
                          action: decision
                        })
                      }
                    }

                    await session.respondInteraction?.(interaction.id, decision)
                  } catch (error) {
                    if (
                      pendingPermissionRecoveryStore.get(sessionId)?.runId === runId &&
                      pendingPermissionRecoveryStore.get(sessionId)?.interactionId === interaction.id
                    ) {
                      pendingPermissionRecoveryStore.delete(sessionId)
                    }
                    await session.respondInteraction?.(interaction.id, PERMISSION_DECISION_CANCEL)
                    emitSessionError(sessionId, {
                      message: error instanceof Error && error.message.includes('timed out')
                        ? '权限确认已超时，已取消当前操作。'
                        : '权限确认失败，已取消当前操作。',
                      code: 'permission_request_failed',
                      details: error instanceof Error ? { message: error.message } : { error: String(error) },
                      fatal: true
                    })
                  }
                })()
                break
              }

              void requestInteraction(interaction.payload, {
                interactionId: interaction.id
              }).catch(() => undefined)
              break
            }
            case 'error':
              if (
                event.data.code === PERMISSION_REQUIRED_CODE &&
                pendingPermissionRecoveryStore.get(sessionId)?.runId === runId
              ) {
                break
              }
              if (
                event.data.code === PERMISSION_REQUIRED_CODE &&
                !pendingPermissionRecoveryStore.has(sessionId) &&
                canRequestInteraction(sessionId)
              ) {
                const permissionPrompt = resolvePermissionInteractionPayload(
                  sessionId,
                  resolvedAdapter,
                  resolvedPermissionMode,
                  event.data
                )

                pendingPermissionRecoveryStore.set(sessionId, { runId })
                void requestInteraction(permissionPrompt)
                  .then(async (answer) => {
                    if (pendingPermissionRecoveryStore.get(sessionId)?.runId !== runId) {
                      return
                    }

                    const { subjectKeys } = resolvePermissionErrorContext(sessionId, event.data)
                    const decision = resolvePermissionInteractionDecision(answer)
                    if (decision == null || decision === PERMISSION_DECISION_CANCEL) {
                      pendingPermissionRecoveryStore.delete(sessionId)
                      emitSessionError(
                        sessionId,
                        buildPermissionDeclinedError('用户取消了本次权限授权，任务未继续执行。')
                      )
                      return
                    }

                    if (decision === 'deny_once') {
                      pendingPermissionRecoveryStore.delete(sessionId)
                      emitSessionError(sessionId, buildPermissionDeclinedError('已拒绝本次权限授权，任务未继续执行。'))
                      return
                    }

                    if (subjectKeys.length > 0) {
                      await applyPermissionInteractionDecision({
                        sessionId,
                        subjectKeys,
                        action: decision
                      })
                    }

                    if (decision === 'deny_session' || decision === 'deny_project') {
                      pendingPermissionRecoveryStore.delete(sessionId)
                      emitSessionError(sessionId, buildPermissionDeclinedError('已记录权限拒绝规则，任务未继续执行。'))
                      return
                    }

                    try {
                      if (activeAdapterRunStore.get(sessionId) === runId) {
                        activeAdapterRunStore.delete(sessionId)
                      }
                      const activeRuntime = getAdapterSessionRuntime(sessionId)
                      if (activeRuntime?.config?.runId === runId) {
                        activeRuntime.session.kill()
                        deleteAdapterSessionRuntime(sessionId)
                      }

                      pendingPermissionRecoveryStore.delete(sessionId)
                      updateAndNotifySession(sessionId, {
                        status: 'running'
                      })
                      const latestPermissionMode = getDb().getSession(sessionId)?.permissionMode ??
                        resolvedPermissionMode
                      const recovered = await startAdapterSession(sessionId, {
                        model: resolvedModel,
                        adapter: resolvedAdapter,
                        effort: resolvedEffort,
                        permissionMode: latestPermissionMode,
                        promptType: resolvedPromptType,
                        promptName: resolvedPromptName
                      })
                      recovered.session.emit({
                        type: 'message',
                        content: [
                          {
                            type: 'text',
                            text: PERMISSION_CONTINUE_PROMPT
                          }
                        ]
                      })
                    } catch (error) {
                      pendingPermissionRecoveryStore.delete(sessionId)
                      emitSessionError(sessionId, {
                        message: '权限规则已更新，但恢复会话失败。',
                        code: 'permission_recovery_failed',
                        details: error instanceof Error ? { message: error.message } : { error: String(error) },
                        fatal: true
                      })
                    }
                  })
                  .catch((error) => {
                    if (pendingPermissionRecoveryStore.get(sessionId)?.runId !== runId) {
                      return
                    }

                    pendingPermissionRecoveryStore.delete(sessionId)
                    emitSessionError(sessionId, {
                      message: error instanceof Error && error.message.includes('timed out')
                        ? '权限确认已超时，任务未继续执行。'
                        : '权限确认失败，任务未继续执行。',
                      code: 'permission_request_failed',
                      details: error instanceof Error ? { message: error.message } : { error: String(error) },
                      fatal: true
                    })
                  })
                break
              }

              if (event.data.fatal !== false) {
                sawFatalError = true
              }
              applyEvent({
                type: 'error',
                data: event.data,
                message: event.data.message
              })
              break
            case 'exit': {
              const { exitCode, stderr } = event.data as { exitCode: number; stderr: string }
              if (pendingPermissionRecoveryStore.get(sessionId)?.runId === runId) {
                parkAdapterSessionRuntime(sessionId)
                if (activeAdapterRunStore.get(sessionId) === runId) {
                  activeAdapterRunStore.delete(sessionId)
                }
                break
              }

              recentPermissionToolUseStore.delete(sessionId)

              void finalizeSessionWorkspaceChangeTracking(sessionId, exitCode === 0 ? 'completed' : 'failed')
              updateAndNotifySession(sessionId, {
                status: exitCode === 0 ? 'completed' : 'failed'
              })
              if (exitCode === 0) {
                maybeDispatchQueuedTurn(sessionId, async (content) => {
                  await processUserMessage(sessionId, content)
                })
              }
              if (exitCode !== 0 && !sawFatalError) {
                const errorMessage = stderr !== ''
                  ? `Process exited with code ${exitCode}, stderr:\n${stderr}`
                  : `Process exited with code ${exitCode}`
                const errorEvent: WSEvent = {
                  type: 'error',
                  data: {
                    message: errorMessage,
                    details: stderr !== '' ? { stderr } : undefined,
                    fatal: true
                  },
                  message: errorMessage
                }
                emitRuntimeEvent(connectionState, errorEvent, { recordMessage: false })
                forwardSessionEventToChannel(sessionId, errorEvent)
              }

              deleteAdapterSessionRuntime(sessionId)
              if (activeAdapterRunStore.get(sessionId) === runId) {
                activeAdapterRunStore.delete(sessionId)
              }
              break
            }
            case 'summary': {
              const summaryData = event.data as { summary: string; leafUuid: string }
              applyEvent({
                type: 'session_info',
                info: {
                  type: 'summary',
                  summary: summaryData.summary,
                  leafUuid: summaryData.leafUuid
                }
              })
              break
            }
            case 'stop': {
              if (pendingPermissionRecoveryStore.get(sessionId)?.runId === runId) {
                break
              }
              const stopMessage = event.data != null &&
                  typeof event.data === 'object' &&
                  'role' in event.data
                ? event.data as ChatMessage
                : undefined
              forwardSessionEventToChannel(sessionId, buildChannelSessionStopEvent(stopMessage))
              const latestSession = getDb().getSession(sessionId)
              void finalizeSessionWorkspaceChangeTracking(
                sessionId,
                latestSession?.status === 'failed' ? 'failed' : 'completed'
              )
              if (latestSession?.status !== 'failed') {
                updateAndNotifySession(sessionId, { status: 'completed' })
                maybeDispatchQueuedTurn(sessionId, async (content) => {
                  await processUserMessage(sessionId, content)
                })
              }
              break
            }
          }
        }
      })

      if (seededFromHistory) {
        db.updateSessionRuntimeState(sessionId, { historySeedPending: false })
      }

      const runtime = setAdapterSessionRuntime(
        sessionId,
        bindAdapterSessionRuntime(connectionState, session, {
          runId,
          model: resolvedModel,
          adapter: resolvedAdapter,
          account: resolvedAccount,
          effort: resolvedEffort,
          permissionMode: resolvedPermissionMode,
          promptType: resolvedPromptType,
          promptName: resolvedPromptName,
          seededFromHistory
        })
      )
      if (listSessionQueuedMessages(sessionId).next.length > 0) {
        armNextQueueInterrupt(sessionId)
      }
      return runtime
    } catch (err) {
      if (adapterCliPrepareOperationActive) {
        emitAdapterCliPrepareOperation(
          'operation_failed',
          err instanceof Error ? err.message : 'Codex CLI preparation failed.'
        )
      }
      if (activeAdapterRunStore.get(sessionId) === runId) {
        activeAdapterRunStore.delete(sessionId)
      }
      updateAndNotifySession(sessionId, { status: 'failed' })
      serverLogger.error({ err, sessionId }, '[server] session init error')
      throw err
    }
  })()

  adapterSessionStartStore.set(sessionId, startPromise)

  try {
    return await startPromise
  } finally {
    if (adapterSessionStartStore.get(sessionId) === startPromise) {
      adapterSessionStartStore.delete(sessionId)
    }
  }
}

function extractTextFromContent(content: ChatMessageContent[]) {
  const textItem = content.find(
    (item): item is Extract<ChatMessageContent, { type: 'text' }> => item.type === 'text' && item.text.trim() !== ''
  )
  if (textItem != null) {
    return textItem.text
  }

  const fileItem = content.find(
    (item): item is Extract<ChatMessageContent, { type: 'file' }> => item.type === 'file' && item.path.trim() !== ''
  )
  if (fileItem != null) {
    return `Context file: ${fileItem.path}`
  }

  const imageItem = content.find((item): item is Extract<ChatMessageContent, { type: 'image' }> =>
    item.type === 'image'
  )
  if (imageItem != null) {
    return imageItem.name?.trim() ? `[图片:${imageItem.name.trim()}]` : '[图片]'
  }

  return undefined
}

const buildExternalRuntimeSessionMessageCommand = (
  sessionId: string,
  content: string | ChatMessageContent[],
  options: {
    model?: string
    permissionMode?: SessionPermissionMode
    runtimeContent?: string | ChatMessageContent[]
  } = {}
): RuntimeCommand => {
  const message = typeof content === 'string'
    ? content
    : summarizeRuntimeSessionContent(content) || '[内容]'
  const runtimeContent = options.runtimeContent
  const runtimeMessage = runtimeContent == null || Array.isArray(runtimeContent)
    ? undefined
    : runtimeContent
  return {
    protocolVersion: getCurrentProtocolVersion(),
    supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
    id: `cmd_send_message_${uuidv4()}`,
    ts: Date.now(),
    sessionId,
    type: 'send_message',
    priority: 20,
    source: 'user',
    commandId: `session-message-${uuidv4()}`,
    content: message,
    message,
    ...(options.model != null ? { model: options.model } : {}),
    ...(options.permissionMode != null ? { permissionMode: options.permissionMode } : {}),
    ...(Array.isArray(content) ? { contentItems: structuredClone(content) } : {}),
    ...(runtimeMessage != null && runtimeMessage !== message ? { runtimeMessage } : {}),
    ...(Array.isArray(runtimeContent) ? { runtimeContentItems: structuredClone(runtimeContent) } : {})
  } satisfies RuntimeCommand
}

const buildExternalRuntimeSessionStopCommand = (sessionId: string): RuntimeCommand =>
  ({
    protocolVersion: getCurrentProtocolVersion(),
    supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
    id: `cmd_stop_${uuidv4()}`,
    ts: Date.now(),
    sessionId,
    type: 'stop',
    priority: 0,
    source: 'web',
    commandId: `session-stop-${uuidv4()}`,
    mode: 'kill'
  }) satisfies RuntimeCommand

const buildExternalRuntimeUserMessageEvent = (
  command: RuntimeCommand,
  content: string | ChatMessageContent[]
) => {
  const commandId = command.commandId ?? command.id
  const contentItems = Array.isArray(content)
    ? structuredClone(content)
    : [{ type: 'text' as const, text: String(content ?? '') }]
  const message: ChatMessage = {
    id: commandId,
    role: 'user',
    content: Array.isArray(content) ? contentItems : String(content ?? ''),
    agentRoom: {
      source: command.source === 'ui' ? 'user' : command.source,
      commandId,
      causedByCommandId: command.id
    },
    createdAt: command.ts
  }
  return { type: 'message' as const, message }
}

const appendExternalRuntimeSessionMessageCommand = async (
  sessionId: string,
  command: RuntimeCommand
) => {
  const workspace = await resolveSessionWorkspace(sessionId).catch(() => undefined)
  const runtimeRoots: string[] = []
  if (workspace?.workspaceFolder != null) {
    const env = createWorkspaceRuntimeEnv(workspace.workspaceFolder, processEnv)
    await migrateRuntimeRoots({
      cwd: workspace.workspaceFolder,
      env
    })
    runtimeRoots.push(resolveSessionRuntimeStoreRoot(workspace.workspaceFolder, env))
  } else {
    return false
  }
  const stores = await discoverRuntimeSessionStores(runtimeRoots)
  const store = stores.find(item => item.sessionId === sessionId)
  if (store == null) {
    return false
  }

  await appendFile(store.commandsPath, `${JSON.stringify(command)}\n`, 'utf8')
  return true
}

export async function processUserMessage(
  sessionId: string,
  content: string | ChatMessageContent[],
  options: {
    channelContext?: Parameters<typeof writeChannelMessageContext>[1]
    model?: string
    runtimeContent?: string | ChatMessageContent[]
  } = {}
) {
  if (options.channelContext != null) {
    await writeChannelMessageContext(sessionId, options.channelContext)
  }

  const serverLogger = getSessionLogger(sessionId, 'server')
  const userText = typeof content === 'string' ? String(content ?? '') : ''
  const contentItems: ChatMessageContent[] = Array.isArray(content)
    ? content
    : [{ type: 'text', text: userText }]
  const summaryText = extractTextFromContent(contentItems) ?? '[内容]'
  const userMessage: ChatMessage = {
    id: uuidv4(),
    role: 'user',
    content: Array.isArray(content) ? contentItems : userText,
    createdAt: Date.now()
  }

  const ev: WSEvent = { type: 'message', message: userMessage }
  const db = getDb()
  const currentSessionData = db.getSession(sessionId)
  const runtimeState = db.getSessionRuntimeState(sessionId)
  const existingAdapterRuntime = getAdapterSessionRuntime(sessionId)
  const isExternalSession = runtimeState?.runtimeKind === 'external' && existingAdapterRuntime == null
  const updates: Partial<Omit<Session, 'id' | 'createdAt' | 'messageCount'>> = {
    lastMessage: summaryText,
    lastUserMessage: summaryText,
    status: 'running'
  }

  if (
    currentSessionData?.title == null || currentSessionData.title === '' ||
    currentSessionData.title === 'New Session'
  ) {
    const firstLine = summaryText.split('\n')[0].trim()
    updates.title = firstLine.length > 50 ? `${firstLine.slice(0, 50)}...` : firstLine
  }

  if (isExternalSession) {
    const command = buildExternalRuntimeSessionMessageCommand(sessionId, content, {
      model: options.model,
      permissionMode: currentSessionData?.permissionMode,
      runtimeContent: options.runtimeContent
    })
    const externalMessageEvent = buildExternalRuntimeUserMessageEvent(command, content)
    const didSave = db.saveMessage(sessionId, externalMessageEvent)
    updateAndNotifySession(sessionId, updates)
    if (didSave) {
      broadcastSessionEvent(sessionId, externalMessageEvent)
    }

    const appended = await appendExternalRuntimeSessionMessageCommand(sessionId, command)
    if (appended) {
      return
    }

    const workspace = await resolveSessionWorkspace(sessionId).catch(() => undefined)
    const latestSession = db.getSession(sessionId) ?? currentSessionData
    if (workspace != null && latestSession != null) {
      await createServerRuntimeSession({
        sessionId,
        cwd: workspace.workspaceFolder,
        title: latestSession.title,
        content,
        message: summaryText,
        runtimeContent: options.runtimeContent,
        model: options.model ?? latestSession.model,
        effort: latestSession.effort,
        permissionMode: latestSession.permissionMode,
        adapter: latestSession.adapter,
        promptType: latestSession.promptType,
        promptName: latestSession.promptName,
        channelContext: options.channelContext,
        systemPrompt: runtimeState?.historySeedPending === true ? runtimeState.historySeed : undefined
      })
      if (runtimeState?.historySeedPending === true) {
        db.updateSessionRuntimeState(sessionId, { historySeedPending: false })
      }
      return
    }

    serverLogger.warn({ sessionId }, '[runtime-store] External runtime store not found for user message')
    db.saveMessage(sessionId, ev)
    broadcastSessionEvent(sessionId, ev)
    return
  }

  db.saveMessage(sessionId, ev)
  updateAndNotifySession(sessionId, updates)

  if (listSessionQueuedMessages(sessionId).next.length > 0) {
    armNextQueueInterrupt(sessionId)
  }

  if (existingAdapterRuntime == null) {
    serverLogger.info({ sessionId }, '[server] Adapter runtime missing for user message, starting a new process')
  }
  const runtime = await startAdapterSession(sessionId, options.model == null ? {} : { model: options.model })

  if (runtime == null) {
    serverLogger.warn({ sessionId }, '[server] Adapter session not found when processing user message')
    return
  }

  broadcastSessionEvent(sessionId, ev)
  await beginSessionWorkspaceChangeTracking(sessionId)

  const messageList = db.getMessages(sessionId) as WSEvent[]
  const lastAssistantMessage = messageList
    .filter((m: WSEvent): m is Extract<WSEvent, { type: 'message' }> =>
      m.type === 'message' && m.message.role === 'assistant' && (m.message.id != null && m.message.id !== '')
    )
    .pop()

  const parentUuid = lastAssistantMessage != null ? lastAssistantMessage.message.id : undefined

  runtime.session.emit({
    type: 'message',
    content: Array.isArray(options.runtimeContent)
      ? options.runtimeContent
      : (options.runtimeContent == null ? contentItems : [{ type: 'text', text: options.runtimeContent }]),
    parentUuid: runtime.config?.seededFromHistory === true ? undefined : parentUuid
  })
}

export function updateAndNotifySession(
  id: string,
  updates: Partial<Omit<Session, 'id' | 'createdAt' | 'messageCount'>>
) {
  const db = getDb()
  const previous = db.getSession(id)
  db.updateSession(id, updates)
  const updated = db.getSession(id)
  if (updated) {
    notifySessionUpdated(id, updated)
    void maybeNotifySession(previous?.status, updated.status, updated).catch(() => undefined)
  }
}

export function killSession(
  sessionId: string,
  options: {
    recordWorkspaceChanges?: boolean
  } = {}
) {
  const db = getDb()
  const cached = getAdapterSessionRuntime(sessionId)
  const parked = getExternalSessionRuntime(sessionId)
  const runtimeState = db.getSessionRuntimeState(sessionId)
  const isExternalRuntime = runtimeState?.runtimeKind === 'external'
  const pendingRecovery = clearPendingPermissionRecovery(sessionId)
  const hadPendingInteraction = resolvePendingInteractionAsCancelled(sessionId, pendingRecovery?.interactionId)

  if (cached != null) {
    activeAdapterRunStore.delete(sessionId)
    getSessionLogger(sessionId, 'server').info({ sessionId }, '[server] Killing adapter process by request')
    cached.session.kill()
    deleteAdapterSessionRuntime(sessionId)
    if (options.recordWorkspaceChanges !== false) {
      void finalizeSessionWorkspaceChangeTracking(sessionId, 'terminated')
    }
  }

  if (parked != null) {
    deleteExternalSessionRuntime(sessionId)
  }

  recentPermissionToolUseStore.delete(sessionId)

  if (isExternalRuntime && cached == null) {
    getSessionLogger(sessionId, 'server').info(
      { sessionId },
      '[server] Ignoring terminate request for external runtime session'
    )
    return
  }

  if (cached != null || pendingRecovery != null || hadPendingInteraction) {
    updateAndNotifySession(sessionId, { status: 'terminated' })
  }
}

export async function requestSessionTermination(
  sessionId: string,
  options: {
    recordWorkspaceChanges?: boolean
  } = {}
) {
  const db = getDb()
  const cached = getAdapterSessionRuntime(sessionId)
  const runtimeState = db.getSessionRuntimeState(sessionId)
  const isExternalRuntime = runtimeState?.runtimeKind === 'external'

  if (isExternalRuntime && cached == null) {
    const command = buildExternalRuntimeSessionStopCommand(sessionId)
    const appended = await appendExternalRuntimeSessionMessageCommand(sessionId, command)
    if (!appended) {
      return {
        accepted: false,
        delivery: 'runtime_store_missing' as const
      }
    }

    const pendingRecovery = clearPendingPermissionRecovery(sessionId)
    resolvePendingInteractionAsCancelled(sessionId, pendingRecovery?.interactionId)
    deleteExternalSessionRuntime(sessionId)
    recentPermissionToolUseStore.delete(sessionId)
    if (options.recordWorkspaceChanges !== false) {
      void finalizeSessionWorkspaceChangeTracking(sessionId, 'terminated')
    }

    const latestSession = db.getSession(sessionId)
    if (latestSession?.status === 'running' || latestSession?.status === 'waiting_input') {
      updateAndNotifySession(sessionId, { status: 'terminated' })
    }

    return {
      accepted: true,
      delivery: 'runtime_store' as const
    }
  }

  killSession(sessionId, options)
  return {
    accepted: true,
    delivery: cached == null ? 'session_service' as const : 'adapter' as const
  }
}

export function interruptSession(sessionId: string) {
  const cached = getAdapterSessionRuntime(sessionId)
  if (cached != null) {
    getSessionLogger(sessionId, 'server').info({ sessionId }, '[server] Interrupting adapter process by request')
    cached.session.emit({ type: 'interrupt' })
  }
}
