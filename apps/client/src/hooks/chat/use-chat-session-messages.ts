import { useCallback, useEffect, useRef, useState } from 'react'
import type { SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { useSWRConfig } from 'swr'

import type {
  AskUserQuestionParams,
  ChatMessage,
  Session,
  SessionMessageQueueState,
  SessionWorkspaceChanges,
  WSEvent
} from '@oneworks/core'
import type { SessionCreationProgressEvent, SessionInfo } from '@oneworks/types'

import { getSessionMessages } from '#~/api.js'
import { connectionManager } from '#~/connectionManager.js'
import { isDeletedSessionUpdate, updateSessionCaches } from '#~/hooks/session-subscription-cache'
import type { SessionUpdate } from '#~/hooks/session-subscription-cache'

import type { ChatErrorState, InteractionRequestState } from './interaction-state'
import {
  applyInteractionStateEvent,
  findLatestFatalError,
  getFatalSessionError,
  restoreInteractionStateFromHistory
} from './interaction-state'
import {
  consumeStagedLocalUserMessages,
  reconcileLocalUserMessages,
  subscribeStagedLocalUserMessages
} from './local-user-message'
import type { OptimisticSessionCreation } from './optimistic-session-creation'
import {
  getLatestSessionCompactionInfo,
  getSessionCompactionInfoFromEvent,
  isSessionCompactionCompleteStatus,
  markSessionCompactionsCompressed,
  restoreSessionCompactionEventsFromHistoryEvents,
  upsertSessionCompactionEvent
} from './session-compaction'
import type { SessionCompactionInfo } from './session-compaction'
import {
  deleteChatSessionViewSnapshot,
  restoreChatSessionViewSnapshot,
  setChatSessionViewSnapshot
} from './session-view-cache'
import type { ChatSessionOperationInfo, ChatSessionViewSnapshot } from './session-view-cache'
import type { ChatEffort } from './use-chat-effort'
import type { PermissionMode } from './use-chat-permission-mode'

const EMPTY_QUEUED_MESSAGES: SessionMessageQueueState = { steer: [], next: [] }
const MAX_HISTORY_REFRESH_RETRIES = 2
type SessionQueuedMessagesSyncListener = (queuedMessages: SessionMessageQueueState) => void

const sessionQueuedMessagesSyncListeners = new Map<string, Set<SessionQueuedMessagesSyncListener>>()

export const syncSessionQueuedMessages = (
  sessionId: string,
  queuedMessages: SessionMessageQueueState
) => {
  const listeners = sessionQueuedMessagesSyncListeners.get(sessionId)
  if (listeners == null) {
    return
  }

  for (const listener of listeners) {
    listener(queuedMessages)
  }
}

const subscribeSessionQueuedMessagesSync = (
  sessionId: string,
  listener: SessionQueuedMessagesSyncListener
) => {
  const listeners = sessionQueuedMessagesSyncListeners.get(sessionId) ?? new Set<SessionQueuedMessagesSyncListener>()
  listeners.add(listener)
  sessionQueuedMessagesSyncListeners.set(sessionId, listeners)

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      sessionQueuedMessagesSyncListeners.delete(sessionId)
    }
  }
}

// eslint-disable-next-line ts/consistent-type-definitions
type RuntimeFlatMessageEvent = {
  type: 'message'
  id?: unknown
  role?: unknown
  content?: unknown
  agentRoom?: unknown
  source?: unknown
  sourceLabel?: unknown
  roomId?: unknown
  hostSessionId?: unknown
  memberKey?: unknown
  runId?: unknown
  runKey?: unknown
  commandId?: unknown
  causedByCommandId?: unknown
  model?: unknown
  createdAt?: unknown
  ts?: unknown
}

type SessionOperationEventInput = WSEvent | RuntimeFlatMessageEvent

interface MessageEventContext {
  agentRoom?: ChatMessage['agentRoom']
}

const isChatMessageRole = (role: unknown): role is ChatMessage['role'] => (
  role === 'user' || role === 'assistant' || role === 'system'
)

const isRuntimeFlatMessageEvent = (data: WSEvent | RuntimeFlatMessageEvent): data is RuntimeFlatMessageEvent => (
  data.type === 'message' && !('message' in data)
)

const resolveEventTimestamp = (event: RuntimeFlatMessageEvent) => {
  const timestamp = typeof event.createdAt === 'number'
    ? event.createdAt
    : event.ts
  return typeof timestamp === 'number' ? timestamp : Date.now()
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value != null && !Array.isArray(value)
)

const getOptionalString = (value: Record<string, unknown>, key: string) => (
  typeof value[key] === 'string' && value[key] !== '' ? value[key] : undefined
)

const normalizeAgentRoomSource = (value: string | undefined, fallback?: string) => {
  if (value == null) return fallback
  if (value === 'ui' || value === 'user') return fallback ?? 'user'
  return value
}

const getAgentRoomMessageMetadata = (value: unknown): ChatMessage['agentRoom'] | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const commandId = getOptionalString(value, 'commandId')
  const causedByCommandId = getOptionalString(value, 'causedByCommandId')
  const source = normalizeAgentRoomSource(
    getOptionalString(value, 'source'),
    commandId != null || causedByCommandId != null ? 'leader' : undefined
  )
  const sourceLabel = getOptionalString(value, 'sourceLabel')
  const roomId = getOptionalString(value, 'roomId')
  const hostSessionId = getOptionalString(value, 'hostSessionId')
  const memberKey = getOptionalString(value, 'memberKey')
  const runKey = getOptionalString(value, 'runKey') ?? getOptionalString(value, 'runId')
  const metadata = {
    ...(source != null ? { source } : {}),
    ...(sourceLabel != null ? { sourceLabel } : {}),
    ...(roomId != null ? { roomId } : {}),
    ...(hostSessionId != null ? { hostSessionId } : {}),
    ...(memberKey != null ? { memberKey } : {}),
    ...(runKey != null ? { runKey } : {}),
    ...(commandId != null ? { commandId } : {}),
    ...(causedByCommandId != null ? { causedByCommandId } : {})
  }

  return Object.keys(metadata).length === 0 ? undefined : metadata
}

const getMessageAgentRoomMetadata = (
  data: RuntimeFlatMessageEvent,
  context?: MessageEventContext
): ChatMessage['agentRoom'] | undefined => (
  getAgentRoomMessageMetadata(data.agentRoom) ??
    getAgentRoomMessageMetadata(data) ??
    context?.agentRoom
)

const getNestedRuntimeEvent = (data: WSEvent): Record<string, unknown> | undefined => {
  if (
    data.type === 'operation_started' ||
    data.type === 'operation_completed' ||
    data.type === 'operation_failed'
  ) {
    return data as unknown as Record<string, unknown>
  }

  if (data.type !== 'adapter_event' || !isRecord(data.data)) {
    return undefined
  }

  return isRecord(data.data.runtimeEvent) ? data.data.runtimeEvent : undefined
}

const getRuntimeEventTimestamp = (event: Record<string, unknown>) => (
  typeof event.ts === 'number' ? event.ts : Date.now()
)

const getSessionOperationInfoFromEvent = (
  data: WSEvent
): { operationId: string; operationInfo: ChatSessionOperationInfo | null } | null => {
  const runtimeEvent = getNestedRuntimeEvent(data)
  if (runtimeEvent == null) {
    return null
  }
  const eventType = runtimeEvent.type
  if (
    eventType !== 'operation_started' &&
    eventType !== 'operation_completed' &&
    eventType !== 'operation_failed'
  ) {
    return null
  }

  const operationId = getOptionalString(runtimeEvent, 'operationId') ?? getOptionalString(runtimeEvent, 'id')
  if (operationId == null) {
    return null
  }

  if (eventType !== 'operation_started') {
    return { operationId, operationInfo: null }
  }

  return {
    operationId,
    operationInfo: {
      operationId,
      adapter: getOptionalString(runtimeEvent, 'adapter'),
      message: getOptionalString(runtimeEvent, 'message'),
      startedAt: getRuntimeEventTimestamp(runtimeEvent),
      summary: getOptionalString(runtimeEvent, 'summary'),
      title: getOptionalString(runtimeEvent, 'title')
    }
  }
}

export const shouldClearSessionOperationForMessage = (data: SessionOperationEventInput) => {
  if (data.type !== 'message') {
    return false
  }
  if (isRuntimeFlatMessageEvent(data)) {
    return data.role === 'assistant'
  }
  return data.message.role === 'assistant'
}

export const applySessionOperationEvent = (
  current: ChatSessionOperationInfo | null,
  data: SessionOperationEventInput
) => {
  if (shouldClearSessionOperationForMessage(data)) {
    return null
  }

  if (isRuntimeFlatMessageEvent(data)) {
    return current
  }

  const operation = getSessionOperationInfoFromEvent(data)
  if (operation == null) {
    return current
  }
  if (operation.operationInfo != null) {
    return operation.operationInfo
  }
  return current?.operationId === operation.operationId ? null : current
}

export const restoreSessionOperationInfoFromHistoryEvents = (events: SessionOperationEventInput[]) => {
  return events.reduce<ChatSessionOperationInfo | null>(applySessionOperationEvent, null)
}

const getPendingAgentRoomMessageMetadata = (data: WSEvent): ChatMessage['agentRoom'] | undefined => {
  const runtimeEvent = getNestedRuntimeEvent(data)
  if (runtimeEvent == null || runtimeEvent.type !== 'command_ack') {
    return undefined
  }

  return getAgentRoomMessageMetadata(runtimeEvent)
}

export const getChatMessageFromSessionHistoryEvent = (
  data: WSEvent | RuntimeFlatMessageEvent,
  context?: MessageEventContext
): ChatMessage | null => {
  if (data.type !== 'message') return null

  if ('message' in data && data.message != null) {
    if (context?.agentRoom == null || data.message.role !== 'user' || data.message.agentRoom != null) {
      return data.message
    }

    return {
      ...data.message,
      agentRoom: context.agentRoom
    }
  }
  if (!isRuntimeFlatMessageEvent(data)) return null

  if (!isChatMessageRole(data.role)) return null
  if (typeof data.content !== 'string' && !Array.isArray(data.content)) return null

  const agentRoom = getMessageAgentRoomMetadata(data, context)

  return {
    id: typeof data.id === 'string' && data.id !== '' ? data.id : `runtime-message-${resolveEventTimestamp(data)}`,
    role: data.role,
    content: data.content,
    ...(agentRoom != null ? { agentRoom } : {}),
    model: typeof data.model === 'string' ? data.model : undefined,
    createdAt: resolveEventTimestamp(data)
  }
}

export const restoreChatMessagesFromSessionHistoryEvents = (events: WSEvent[]): ChatMessage[] => {
  let currentMessages: ChatMessage[] = []
  let pendingAgentRoom: ChatMessage['agentRoom'] | undefined

  for (const data of events) {
    pendingAgentRoom = getPendingAgentRoomMessageMetadata(data) ?? pendingAgentRoom
    currentMessages = applyMessageEvent(
      currentMessages,
      data,
      pendingAgentRoom != null ? { agentRoom: pendingAgentRoom } : undefined
    )
    currentMessages = applyToolResultEvent(currentMessages, data)
    if (data.type === 'message') {
      pendingAgentRoom = undefined
    }
  }

  return currentMessages
}

export const shouldTerminateSessionForConfigChange = (session: Session | undefined, hasConfigChanged: boolean) => {
  if (!hasConfigChanged) return false
  if (session?.id == null || session.id === '') return false
  if (session.parentSessionId != null && session.parentSessionId !== '') return false
  return session.status === 'waiting_input'
}

export const shouldApplyHistoryRefreshResult = ({
  activeSessionId,
  appliedRequestSeq,
  requestSeq,
  sessionId
}: {
  activeSessionId?: string
  appliedRequestSeq: number
  requestSeq: number
  sessionId: string
}) => activeSessionId === sessionId && requestSeq >= appliedRequestSeq

export const shouldRefreshHistoryForSessionUpdate = (
  currentSession: Session,
  updatedSession: SessionUpdate
) => {
  if (isDeletedSessionUpdate(updatedSession) || updatedSession.id !== currentSession.id) {
    return false
  }

  return updatedSession.status !== currentSession.status ||
    updatedSession.lastMessage !== currentSession.lastMessage ||
    updatedSession.messageCount !== currentSession.messageCount
}

export const shouldUseOptimisticSessionOnlyView = (
  optimisticCreation: OptimisticSessionCreation | undefined
): optimisticCreation is OptimisticSessionCreation & { status: 'failed' } => optimisticCreation?.status === 'failed'

const getHistoryRefreshRetryDelay = (retryAttempt: number) => 800 * 2 ** retryAttempt

const applyMessageEvent = (currentMessages: ChatMessage[], data: WSEvent, context?: MessageEventContext) => {
  const message = getChatMessageFromSessionHistoryEvent(data, context)
  if (message == null) return currentMessages

  const exists = currentMessages.find((msg) => msg.id === message.id)
  if (exists != null) {
    return currentMessages.map((msg) => (msg.id === message.id ? message : msg))
  }
  return [...currentMessages, message]
}

const getToolCallEventId = (message: ChatMessage) => (
  message.toolCall?.id ?? message.id
)

const applyToolResultEvent = (currentMessages: ChatMessage[], data: WSEvent): ChatMessage[] => {
  if (data.type !== 'tool_result') return currentMessages
  const status = data.isError === true ? 'error' : 'success'
  return currentMessages.map((msg) => {
    if (msg.toolCall != null && getToolCallEventId(msg) === data.toolCallId) {
      return {
        ...msg,
        toolCall: {
          ...msg.toolCall,
          status,
          output: data.output
        }
      }
    }
    return msg
  })
}

const applySessionCreationProgressEvent = (
  currentProgress: SessionCreationProgressEvent[],
  data: WSEvent
) => {
  if (data.type !== 'session_creation_progress') return currentProgress
  return [...currentProgress, data.progress]
}

export const upsertSessionWorkspaceChanges = (
  currentChanges: SessionWorkspaceChanges[],
  changes: SessionWorkspaceChanges
) => {
  const next = currentChanges.some(item => item.id === changes.id)
    ? currentChanges.map(item => item.id === changes.id ? changes : item)
    : [...currentChanges, changes]

  return next.sort((left, right) => {
    const timestampDelta = left.createdAt - right.createdAt
    return timestampDelta !== 0 ? timestampDelta : left.id.localeCompare(right.id)
  })
}

export const restoreSessionWorkspaceChangesFromHistoryEvents = (events: WSEvent[]) => {
  return events.reduce<SessionWorkspaceChanges[]>((current, event) => {
    if (event.type !== 'workspace_changes') {
      return current
    }
    return upsertSessionWorkspaceChanges(current, event.changes)
  }, [])
}

export function useChatSessionMessages({
  session,
  modelForQuery,
  effort,
  permissionMode,
  adapter,
  account,
  optimisticCreation,
  setInteractionRequest
}: {
  session?: Session
  modelForQuery?: string
  effort: ChatEffort
  permissionMode: PermissionMode
  adapter?: string
  account?: string
  optimisticCreation?: OptimisticSessionCreation
  setInteractionRequest: (value: { id: string; payload: AskUserQuestionParams } | null) => void
}) {
  const { t } = useTranslation()
  const { mutate } = useSWRConfig()
  const [messagesState, setMessagesState] = useState<ChatMessage[]>([])
  const [creationProgressState, setCreationProgressState] = useState<SessionCreationProgressEvent[]>([])
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [sessionOperationInfo, setSessionOperationInfo] = useState<ChatSessionOperationInfo | null>(null)
  const [sessionCompactionInfo, setSessionCompactionInfo] = useState<SessionCompactionInfo | null>(null)
  const [sessionCompactionEvents, setSessionCompactionEvents] = useState<SessionCompactionInfo[]>([])
  const [sessionWorkspaceChanges, setSessionWorkspaceChanges] = useState<SessionWorkspaceChanges[]>([])
  const [queuedMessages, setQueuedMessages] = useState<SessionMessageQueueState>({ steer: [], next: [] })
  const [isReady, setIsReady] = useState(false)
  const [errorState, setErrorState] = useState<ChatErrorState | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const isInitialLoadRef = useRef<boolean>(true)
  const lastConnectedModelRef = useRef<string | undefined>(undefined)
  const lastConnectedEffortRef = useRef<string | undefined>(undefined)
  const lastConnectedPermissionModeRef = useRef<string | undefined>(undefined)
  const lastConnectedAdapterRef = useRef<string | undefined>(undefined)
  const lastConnectedAccountRef = useRef<string | undefined>(undefined)
  const lastObservedSessionStatusRef = useRef<Session['status'] | undefined>(session?.status)
  const expectedCloseRef = useRef(false)
  const fatalSessionErrorRef = useRef(false)
  const interactionRequestRef = useRef<InteractionRequestState | null>(null)
  const sessionOperationInfoRef = useRef<ChatSessionOperationInfo | null>(null)
  const activeSessionIdRef = useRef<string | undefined>(session?.id)
  const historyRequestSeqRef = useRef(0)
  const appliedHistoryRequestSeqRef = useRef(0)
  const reconcileTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const historyRetryTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const sessionViewCacheRef = useRef(new Map<string, ChatSessionViewSnapshot>())
  const sessionCompactionEventsRef = useRef<SessionCompactionInfo[]>([])

  activeSessionIdRef.current = session?.id

  const updateSessionViewCache = useCallback((
    sessionId: string,
    patch: Partial<{
      messages: ChatMessage[]
      creationProgress: SessionCreationProgressEvent[]
      sessionInfo: SessionInfo | null
      sessionOperationInfo: ChatSessionOperationInfo | null
      sessionCompactionInfo: SessionCompactionInfo | null
      sessionCompactionEvents: SessionCompactionInfo[]
      sessionWorkspaceChanges: SessionWorkspaceChanges[]
      queuedMessages: SessionMessageQueueState
      errorState: ChatErrorState | null
      interactionRequest: InteractionRequestState | null
      isHydrated: boolean
    }>
  ) => {
    return setChatSessionViewSnapshot(sessionViewCacheRef.current, sessionId, patch)
  }, [])

  const removeSessionViewCache = useCallback((sessionId: string) => {
    deleteChatSessionViewSnapshot(sessionViewCacheRef.current, sessionId)
  }, [])

  const applySessionCompactionEvents = useCallback((
    next: SessionCompactionInfo[],
    sessionId = activeSessionIdRef.current
  ) => {
    sessionCompactionEventsRef.current = next
    setSessionCompactionEvents(next)

    const latest = getLatestSessionCompactionInfo(next)
    setSessionCompactionInfo(latest)

    if (sessionId != null && sessionId !== '') {
      updateSessionViewCache(sessionId, {
        sessionCompactionEvents: next,
        sessionCompactionInfo: latest
      })
    }
  }, [updateSessionViewCache])

  const updateSessionCompactionEvents = useCallback((
    updater: (current: SessionCompactionInfo[]) => SessionCompactionInfo[]
  ) => {
    const current = sessionCompactionEventsRef.current
    const next = updater(current)
    if (next === current) {
      return
    }

    applySessionCompactionEvents(next)
  }, [applySessionCompactionEvents])

  const setMessages = useCallback((value: SetStateAction<ChatMessage[]>) => {
    setMessagesState((current) => {
      const next = typeof value === 'function'
        ? value(current)
        : value
      const sessionId = activeSessionIdRef.current

      if (sessionId != null && sessionId !== '') {
        const currentSnapshot = sessionViewCacheRef.current.get(sessionId)
        updateSessionViewCache(sessionId, {
          messages: next,
          isHydrated: currentSnapshot?.isHydrated === true
        })
      }

      return next
    })
  }, [updateSessionViewCache])

  const setMessagesFromHistory = useCallback((value: SetStateAction<ChatMessage[]>) => {
    setMessagesState((current) => {
      const proposed = typeof value === 'function'
        ? value(current)
        : value
      const next = reconcileLocalUserMessages(proposed, current)
      const sessionId = activeSessionIdRef.current

      if (sessionId != null && sessionId !== '') {
        const currentSnapshot = sessionViewCacheRef.current.get(sessionId)
        updateSessionViewCache(sessionId, {
          messages: next,
          isHydrated: currentSnapshot?.isHydrated === true
        })
      }

      return next
    })
  }, [updateSessionViewCache])

  const applyQueuedMessages = useCallback((
    nextQueuedMessages: SessionMessageQueueState,
    sessionId = activeSessionIdRef.current
  ) => {
    setQueuedMessages(nextQueuedMessages)

    if (sessionId != null && sessionId !== '') {
      updateSessionViewCache(sessionId, {
        queuedMessages: nextQueuedMessages
      })
    }
  }, [updateSessionViewCache])

  const applySessionOperationInfo = useCallback((
    nextOperationInfo: ChatSessionOperationInfo | null,
    sessionId = activeSessionIdRef.current
  ) => {
    sessionOperationInfoRef.current = nextOperationInfo
    setSessionOperationInfo(nextOperationInfo)

    if (sessionId != null && sessionId !== '') {
      updateSessionViewCache(sessionId, {
        sessionOperationInfo: nextOperationInfo
      })
    }
  }, [updateSessionViewCache])

  const clearScheduledReconciles = useCallback(() => {
    for (const timer of reconcileTimersRef.current) {
      clearTimeout(timer)
    }
    reconcileTimersRef.current = []
  }, [])

  const clearScheduledHistoryRetries = useCallback(() => {
    for (const timer of historyRetryTimersRef.current) {
      clearTimeout(timer)
    }
    historyRetryTimersRef.current = []
  }, [])

  const refreshHistory = useCallback(async (options: { retryAttempt?: number; updateReadiness?: boolean } = {}) => {
    const sessionId = activeSessionIdRef.current
    if (sessionId == null || sessionId === '') {
      return
    }

    const requestSeq = ++historyRequestSeqRef.current

    try {
      const res = await getSessionMessages(sessionId)
      if (
        !shouldApplyHistoryRefreshResult({
          activeSessionId: activeSessionIdRef.current,
          appliedRequestSeq: appliedHistoryRequestSeqRef.current,
          requestSeq,
          sessionId
        })
      ) {
        return
      }
      appliedHistoryRequestSeqRef.current = requestSeq
      clearScheduledHistoryRetries()

      const events = res.messages as WSEvent[]

      if (res.session) {
        updateSessionCaches(mutate, res.session)
      }

      const currentMessages = restoreChatMessagesFromSessionHistoryEvents(events)
      const currentSessionCompactionEvents = restoreSessionCompactionEventsFromHistoryEvents(
        events,
        res.session?.status
      )
      const currentSessionCompactionInfo = getLatestSessionCompactionInfo(currentSessionCompactionEvents)
      const currentSessionWorkspaceChanges = restoreSessionWorkspaceChangesFromHistoryEvents(events)
      const currentSessionOperationInfo = restoreSessionOperationInfoFromHistoryEvents(events)
      let currentCreationProgress: SessionCreationProgressEvent[] = []
      let currentSessionInfo: SessionInfo | null = null
      const restoredInteraction = restoreInteractionStateFromHistory(
        events,
        res.interaction ?? null,
        res.session?.status
      )
      const latestFatalError = findLatestFatalError(events)
      const nextErrorState = restoredInteraction == null && res.session?.status === 'failed' && latestFatalError != null
        ? {
          kind: 'session' as const,
          message: latestFatalError.message,
          code: latestFatalError.code
        }
        : null
      const nextQueuedMessages = res.queuedMessages ?? EMPTY_QUEUED_MESSAGES

      interactionRequestRef.current = restoredInteraction
      sessionOperationInfoRef.current = currentSessionOperationInfo
      setInteractionRequest(restoredInteraction)
      applyQueuedMessages(nextQueuedMessages, sessionId)
      applySessionOperationInfo(currentSessionOperationInfo, sessionId)
      setErrorState(nextErrorState)

      for (const data of events) {
        currentCreationProgress = applySessionCreationProgressEvent(currentCreationProgress, data)
        if (data.type === 'session_info') {
          if (data.info != null && data.info.type !== 'summary') {
            currentSessionInfo = data.info
          }
        }
      }

      updateSessionViewCache(sessionId, {
        messages: currentMessages,
        creationProgress: currentCreationProgress,
        sessionInfo: currentSessionInfo,
        sessionOperationInfo: currentSessionOperationInfo,
        sessionCompactionInfo: currentSessionCompactionInfo,
        sessionCompactionEvents: currentSessionCompactionEvents,
        sessionWorkspaceChanges: currentSessionWorkspaceChanges,
        queuedMessages: nextQueuedMessages,
        errorState: nextErrorState,
        interactionRequest: restoredInteraction,
        isHydrated: true
      })

      setMessagesFromHistory(currentMessages)
      setCreationProgressState(currentCreationProgress)
      setSessionInfo(currentSessionInfo)
      setSessionOperationInfo(currentSessionOperationInfo)
      setSessionCompactionInfo(currentSessionCompactionInfo)
      sessionCompactionEventsRef.current = currentSessionCompactionEvents
      setSessionCompactionEvents(currentSessionCompactionEvents)
      setSessionWorkspaceChanges(currentSessionWorkspaceChanges)

      if (options.updateReadiness !== false) {
        setTimeout(() => {
          if (
            !shouldApplyHistoryRefreshResult({
              activeSessionId: activeSessionIdRef.current,
              appliedRequestSeq: appliedHistoryRequestSeqRef.current,
              requestSeq,
              sessionId
            })
          ) {
            return
          }
          setIsReady(true)
          isInitialLoadRef.current = false
        }, 100)
      }
    } catch (err) {
      if (
        !shouldApplyHistoryRefreshResult({
          activeSessionId: activeSessionIdRef.current,
          appliedRequestSeq: appliedHistoryRequestSeqRef.current,
          requestSeq,
          sessionId
        }) ||
        sessionViewCacheRef.current.get(sessionId)?.isHydrated === true
      ) {
        return
      }

      console.error('Failed to fetch history messages:', err)
      const retryAttempt = options.retryAttempt ?? 0
      if (retryAttempt < MAX_HISTORY_REFRESH_RETRIES) {
        const retryTimer = globalThis.setTimeout(() => {
          historyRetryTimersRef.current = historyRetryTimersRef.current.filter(timer => timer !== retryTimer)
          void refreshHistory({
            ...options,
            retryAttempt: retryAttempt + 1
          })
        }, getHistoryRefreshRetryDelay(retryAttempt))
        historyRetryTimersRef.current.push(retryTimer)
        return
      }

      const nextErrorState = {
        kind: 'connection',
        message: t('chat.historyLoadFailed'),
        recoverable: true,
        reason: 'error'
      } satisfies ChatErrorState
      setErrorState(nextErrorState)
      updateSessionViewCache(sessionId, {
        errorState: nextErrorState
      })
      if (options.updateReadiness !== false) {
        setIsReady(true)
        isInitialLoadRef.current = false
      }
    }
  }, [
    applyQueuedMessages,
    applySessionOperationInfo,
    clearScheduledHistoryRetries,
    mutate,
    setInteractionRequest,
    setMessagesFromHistory,
    t,
    updateSessionViewCache
  ])

  const reconcileAfterInteraction = useCallback(() => {
    clearScheduledReconciles()

    for (const delay of [0, 800, 2400, 5000, 9000, 15000]) {
      const timer = globalThis.setTimeout(() => {
        void refreshHistory({ updateReadiness: false })
      }, delay)
      reconcileTimersRef.current.push(timer)
    }
  }, [clearScheduledReconciles, refreshHistory])

  const retryConnection = useCallback(() => {
    if (session?.id == null || session.id === '') return
    expectedCloseRef.current = true
    fatalSessionErrorRef.current = false
    setErrorState(null)
    updateSessionViewCache(session.id, { errorState: null })
    connectionManager.close(session.id)
    setRetryCount((count) => count + 1)
  }, [session?.id, updateSessionViewCache])

  useEffect(() => {
    if (session?.id == null || session.id === '') {
      historyRequestSeqRef.current += 1
      appliedHistoryRequestSeqRef.current = historyRequestSeqRef.current
      clearScheduledHistoryRetries()
      setMessagesState([])
      setCreationProgressState([])
      setSessionInfo(null)
      setSessionOperationInfo(null)
      setSessionCompactionInfo(null)
      sessionCompactionEventsRef.current = []
      setSessionCompactionEvents([])
      setSessionWorkspaceChanges([])
      setQueuedMessages(EMPTY_QUEUED_MESSAGES)
      setIsReady(true)
      setErrorState(null)
      setInteractionRequest(null)
      interactionRequestRef.current = null
      sessionOperationInfoRef.current = null
      isInitialLoadRef.current = true
      lastConnectedModelRef.current = undefined
      lastConnectedEffortRef.current = undefined
      lastConnectedPermissionModeRef.current = undefined
      lastConnectedAdapterRef.current = undefined
      lastConnectedAccountRef.current = undefined
      fatalSessionErrorRef.current = false
      clearScheduledReconciles()
      return
    }

    if (shouldUseOptimisticSessionOnlyView(optimisticCreation)) {
      clearScheduledReconciles()
      historyRequestSeqRef.current += 1
      appliedHistoryRequestSeqRef.current = historyRequestSeqRef.current
      clearScheduledHistoryRetries()
      const nextMessages = [optimisticCreation.message]
      const nextErrorState = {
        action: 'retry-session-creation',
        code: 'session_create_failed',
        kind: 'session',
        message: optimisticCreation.errorMessage ?? t('chat.sessionCreateFailedMessage')
      } satisfies ChatErrorState

      interactionRequestRef.current = null
      setInteractionRequest(null)
      setMessagesState(nextMessages)
      setSessionInfo(null)
      setSessionOperationInfo(null)
      setSessionCompactionInfo(null)
      sessionOperationInfoRef.current = null
      sessionCompactionEventsRef.current = []
      setSessionCompactionEvents([])
      setSessionWorkspaceChanges([])
      setQueuedMessages(EMPTY_QUEUED_MESSAGES)
      setErrorState(nextErrorState)
      setIsReady(true)
      isInitialLoadRef.current = false
      updateSessionViewCache(session.id, {
        messages: nextMessages,
        sessionInfo: null,
        sessionOperationInfo: null,
        sessionCompactionInfo: null,
        sessionCompactionEvents: [],
        sessionWorkspaceChanges: [],
        queuedMessages: EMPTY_QUEUED_MESSAGES,
        errorState: nextErrorState,
        interactionRequest: null,
        isHydrated: true
      })
      return
    }

    const restoredState = restoreChatSessionViewSnapshot(sessionViewCacheRef.current.get(session.id))
    const stagedLocalMessages = consumeStagedLocalUserMessages(session.id)
    const hasStagedLocalMessages = stagedLocalMessages.length > 0
    const restoredMessages = reconcileLocalUserMessages(restoredState.messages, stagedLocalMessages)

    setMessagesState(restoredMessages)
    setCreationProgressState(restoredState.creationProgress)
    setSessionInfo(restoredState.sessionInfo)
    setSessionOperationInfo(restoredState.sessionOperationInfo)
    setSessionCompactionInfo(restoredState.sessionCompactionInfo)
    sessionCompactionEventsRef.current = restoredState.sessionCompactionEvents
    setSessionCompactionEvents(restoredState.sessionCompactionEvents)
    setSessionWorkspaceChanges(restoredState.sessionWorkspaceChanges)
    setQueuedMessages(restoredState.queuedMessages)
    setErrorState(restoredState.errorState)
    setInteractionRequest(restoredState.interactionRequest)
    interactionRequestRef.current = restoredState.interactionRequest
    sessionOperationInfoRef.current = restoredState.sessionOperationInfo
    setIsReady(restoredState.isReady || hasStagedLocalMessages)
    isInitialLoadRef.current = !(restoredState.isReady || hasStagedLocalMessages)
    if (hasStagedLocalMessages) {
      updateSessionViewCache(session.id, {
        messages: restoredMessages,
        isHydrated: restoredState.isReady || hasStagedLocalMessages
      })
    }

    void refreshHistory()

    return () => {
      clearScheduledReconciles()
      clearScheduledHistoryRetries()
    }
  }, [
    clearScheduledHistoryRetries,
    clearScheduledReconciles,
    optimisticCreation,
    refreshHistory,
    session?.id,
    setInteractionRequest,
    t,
    updateSessionViewCache
  ])

  useEffect(() => {
    if (session?.id == null || session.id === '') {
      return
    }

    return subscribeSessionQueuedMessagesSync(session.id, queuedMessages => {
      applyQueuedMessages(queuedMessages, session.id)
    })
  }, [applyQueuedMessages, session?.id])

  useEffect(() => {
    if (session?.id == null || session.id === '') {
      return
    }

    return subscribeStagedLocalUserMessages(session.id, message => {
      setMessagesFromHistory(current => reconcileLocalUserMessages(current, [message]))
    })
  }, [session?.id, setMessagesFromHistory])

  useEffect(() => {
    if (session?.id == null || session.id === '') {
      lastObservedSessionStatusRef.current = undefined
      return
    }
    if (shouldUseOptimisticSessionOnlyView(optimisticCreation)) {
      lastObservedSessionStatusRef.current = session.status
      return
    }

    const previousStatus = lastObservedSessionStatusRef.current
    lastObservedSessionStatusRef.current = session.status

    if (previousStatus == null || previousStatus === session.status) {
      return
    }

    if (isSessionCompactionCompleteStatus(session.status)) {
      updateSessionCompactionEvents(markSessionCompactionsCompressed)
    }
    void refreshHistory({ updateReadiness: false })
  }, [optimisticCreation, refreshHistory, session?.id, session?.status, updateSessionCompactionEvents])

  useEffect(() => {
    if (session?.id == null || session.id === '') {
      return
    }
    if (shouldUseOptimisticSessionOnlyView(optimisticCreation)) {
      expectedCloseRef.current = true
      fatalSessionErrorRef.current = false
      connectionManager.close(session.id)
      return
    }

    let isDisposed = false
    let cleanup: (() => void) | undefined
    const openHistoryRefreshTimers: Array<ReturnType<typeof setTimeout>> = []
    const normalizedModel = modelForQuery ?? ''
    const modelChanged = modelForQuery != null &&
      lastConnectedModelRef.current != null &&
      normalizedModel !== lastConnectedModelRef.current &&
      session?.status !== 'running'
    const normalizedEffort = effort === 'default' ? '' : effort
    const effortChanged = lastConnectedEffortRef.current != null &&
      normalizedEffort !== lastConnectedEffortRef.current &&
      session?.status !== 'running'
    const normalizedPermissionMode = permissionMode ?? ''
    const normalizedAdapter = adapter ?? ''
    const adapterChanged = adapter != null &&
      lastConnectedAdapterRef.current != null &&
      normalizedAdapter !== lastConnectedAdapterRef.current &&
      session?.status !== 'running'
    const normalizedAccount = account ?? ''
    const accountChanged = account != null &&
      lastConnectedAccountRef.current != null &&
      normalizedAccount !== lastConnectedAccountRef.current &&
      session?.status !== 'running'
    const hasRuntimeRestartConfigChanged = modelChanged || effortChanged || adapterChanged || accountChanged
    const shouldTerminateForConfigChange = shouldTerminateSessionForConfigChange(
      session,
      hasRuntimeRestartConfigChanged
    )

    if (shouldTerminateForConfigChange) {
      expectedCloseRef.current = true
      fatalSessionErrorRef.current = false
      setErrorState(null)
      connectionManager.send(session.id, { type: 'terminate_session' })
      connectionManager.close(session.id)
    }
    lastConnectedModelRef.current = normalizedModel
    lastConnectedEffortRef.current = normalizedEffort
    lastConnectedPermissionModeRef.current = normalizedPermissionMode
    lastConnectedAdapterRef.current = normalizedAdapter
    lastConnectedAccountRef.current = normalizedAccount

    const timer = setTimeout(() => {
      if (isDisposed) return

      const connectionParams: Record<string, string> = {}
      if (modelForQuery) {
        connectionParams.model = modelForQuery
      }
      if (effort !== 'default') {
        connectionParams.effort = effort
      }
      if (permissionMode) {
        connectionParams.permissionMode = permissionMode
      }
      if (adapter) {
        connectionParams.adapter = adapter
      }
      if (account) {
        connectionParams.account = account
      }

      cleanup = connectionManager.connect(session.id, {
        onOpen() {
          expectedCloseRef.current = false
          fatalSessionErrorRef.current = false
          setErrorState((current) => {
            const next = current?.kind === 'session' ? current : null
            updateSessionViewCache(session.id, {
              errorState: next
            })
            return next
          })
          if (session.status === 'running') {
            for (const delayMs of [500, 1500, 3000]) {
              const refreshTimer = setTimeout(() => {
                if (isDisposed) return
                void refreshHistory({ updateReadiness: false })
              }, delayMs)
              openHistoryRefreshTimers.push(refreshTimer)
            }
          }
        },
        onMessage(data: WSEvent) {
          if (isDisposed) return
          const nextInteraction = applyInteractionStateEvent(interactionRequestRef.current, data)
          if (nextInteraction !== interactionRequestRef.current) {
            interactionRequestRef.current = nextInteraction
            setInteractionRequest(nextInteraction)
            updateSessionViewCache(session.id, {
              interactionRequest: nextInteraction
            })
            if (nextInteraction != null) {
              setErrorState(null)
              updateSessionViewCache(session.id, {
                errorState: null
              })
            }
          }
          if (data.type === 'interaction_response') {
            reconcileAfterInteraction()
            return
          }
          if (data.type === 'error') {
            const fatalError = getFatalSessionError(data)
            if (fatalError != null) {
              fatalSessionErrorRef.current = true
              const nextErrorState = {
                kind: 'session',
                message: fatalError.message,
                code: fatalError.code
              } satisfies ChatErrorState
              setErrorState(nextErrorState)
              updateSessionViewCache(session.id, {
                errorState: nextErrorState
              })
            }
            return
          }

          if (data.type === 'session_updated') {
            const updatedSession = data.session as SessionUpdate
            if (isDeletedSessionUpdate(updatedSession)) {
              removeSessionViewCache(updatedSession.id)
            } else if (isSessionCompactionCompleteStatus(updatedSession.status)) {
              updateSessionCompactionEvents(markSessionCompactionsCompressed)
            }
            if (shouldRefreshHistoryForSessionUpdate(session, updatedSession)) {
              void refreshHistory({ updateReadiness: false })
            }
            updateSessionCaches(mutate, updatedSession)
            return
          }

          if (data.type === 'session_queue_updated') {
            applyQueuedMessages(data.queue, session.id)
            return
          }

          const nextOperationInfo = applySessionOperationEvent(sessionOperationInfoRef.current, data)
          if (nextOperationInfo !== sessionOperationInfoRef.current) {
            applySessionOperationInfo(nextOperationInfo, session.id)
          }

          if (data.type === 'message') {
            const message = getChatMessageFromSessionHistoryEvent(data)
            if (message?.role === 'assistant') {
              applySessionOperationInfo(null, session.id)
              updateSessionCompactionEvents(markSessionCompactionsCompressed)
            }
            setMessagesFromHistory((current) => applyMessageEvent(current, data))
            return
          }

          if (data.type === 'session_creation_progress') {
            setCreationProgressState((current) => {
              const next = applySessionCreationProgressEvent(current, data)
              updateSessionViewCache(session.id, {
                creationProgress: next
              })
              return next
            })
            return
          }

          if (data.type === 'workspace_changes') {
            setSessionWorkspaceChanges((current) => {
              const next = upsertSessionWorkspaceChanges(current, data.changes)
              updateSessionViewCache(session.id, {
                sessionWorkspaceChanges: next
              })
              return next
            })
            return
          }

          if (data.type === 'session_info') {
            if (data.info != null && data.info.type === 'summary') {
              void mutate('/api/sessions')
            } else {
              setSessionInfo(data.info ?? null)
              updateSessionViewCache(session.id, {
                sessionInfo: data.info ?? null
              })
              if (isInitialLoadRef.current) {
                setTimeout(() => {
                  if (isDisposed) return
                  if (isInitialLoadRef.current) {
                    setIsReady(true)
                    isInitialLoadRef.current = false
                  }
                }, 100)
              }
            }
            return
          }

          const compactionInfo = getSessionCompactionInfoFromEvent(data)
          if (compactionInfo != null) {
            updateSessionCompactionEvents(current => upsertSessionCompactionEvent(current, compactionInfo))
            return
          }

          if (data.type === 'tool_result') {
            setMessages((current) => applyToolResultEvent(current, data))
            return
          }

          if (data.type === 'interaction_request') {
            interactionRequestRef.current = data
            setInteractionRequest(data)
            updateSessionViewCache(session.id, {
              interactionRequest: data
            })
          }
        },
        onError() {
          if (isDisposed) return
          const nextErrorState = {
            kind: 'connection',
            message: t('chat.connectionError'),
            reason: 'error'
          } satisfies ChatErrorState
          setErrorState(nextErrorState)
          updateSessionViewCache(session.id, {
            errorState: nextErrorState
          })
        },
        onClose(event) {
          if (isDisposed) return
          if (expectedCloseRef.current) {
            expectedCloseRef.current = false
            return
          }
          const isAuthFailure = event.code === 1008 && event.reason === 'Login required'
          const isRecoverableClose = !fatalSessionErrorRef.current &&
            event.code !== 1000 &&
            event.code !== 1008
          setErrorState((current) => {
            const next = current ?? {
              ...(isAuthFailure ? { code: 'auth_required' } : {}),
              kind: 'connection',
              message: isAuthFailure ? t('chat.connectionAuthRequired') : event.reason || t('chat.connectionClosed'),
              recoverable: isRecoverableClose,
              reason: 'closed'
            }
            updateSessionViewCache(session.id, {
              errorState: next
            })
            return next
          })
        },
        shouldReconnect(event) {
          if (expectedCloseRef.current || fatalSessionErrorRef.current) {
            return false
          }

          return event.code !== 1000 && event.code !== 1008
        }
      }, Object.keys(connectionParams).length > 0 ? connectionParams : undefined)
    }, shouldTerminateForConfigChange ? 200 : 100)

    return () => {
      isDisposed = true
      clearTimeout(timer)
      for (const refreshTimer of openHistoryRefreshTimers) {
        clearTimeout(refreshTimer)
      }
      cleanup?.()
    }
  }, [
    adapter,
    account,
    applyQueuedMessages,
    applySessionOperationInfo,
    clearScheduledReconciles,
    effort,
    modelForQuery,
    mutate,
    optimisticCreation,
    permissionMode,
    reconcileAfterInteraction,
    retryCount,
    refreshHistory,
    session?.id,
    session?.status,
    setInteractionRequest,
    t,
    removeSessionViewCache,
    updateSessionCompactionEvents,
    updateSessionViewCache
  ])

  return {
    messages: messagesState,
    creationProgress: creationProgressState,
    setMessages,
    sessionInfo,
    sessionOperationInfo,
    sessionCompactionInfo,
    sessionCompactionEvents,
    sessionWorkspaceChanges,
    queuedMessages,
    isReady,
    errorState,
    retryConnection,
    reconcileAfterInteraction
  }
}
