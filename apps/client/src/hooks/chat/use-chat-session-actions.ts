import { App } from 'antd'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { useSWRConfig } from 'swr'

import type { ChatMessageContent, Session, SessionQueuedMessageMode, WSEvent } from '@oneworks/core'
import type { SessionCreationProgressEvent } from '@oneworks/types'

import {
  branchSessionFromMessage,
  createQueuedMessage,
  createSession,
  deleteQueuedMessage,
  deleteSession,
  getApiErrorMessage,
  getSessionMessages,
  moveQueuedMessage,
  reorderQueuedMessages,
  sendSessionMessage,
  terminateSession,
  updateQueuedMessage
} from '#~/api.js'
import { useSenderHeaderQueryState } from '#~/hooks/use-sender-header-query-state.js'
import { buildMessageBranchSearch } from '#~/utils/message-branch-session'
import { createSocket } from '#~/ws.js'

import { getChatSessionTargetPrompt } from './chat-session-target'
import type { ChatSessionTargetDraft } from './chat-session-target'
import type { ChatSessionWorkspaceDraft } from './chat-session-workspace-draft'
import { stageLocalUserMessage } from './local-user-message'
import {
  clearOptimisticSessionDiscarded,
  createOptimisticSessionCreation,
  createOptimisticSessionId,
  getActiveOptimisticSessionCreation,
  isOptimisticSessionDiscarded,
  markOptimisticSessionCreationCreating,
  markOptimisticSessionCreationFailed,
  markOptimisticSessionDiscarded,
  optimisticSessionCreationsAtom,
  removeSessionFromList
} from './optimistic-session-creation'
import type {
  OptimisticSessionCreation,
  OptimisticSessionCreationOptions,
  OptimisticSessionCreationRequest
} from './optimistic-session-creation'
import type { PendingSessionCreationContext } from './session-creation-context'
import type { ChatEffort } from './use-chat-effort'
import type { PermissionMode } from './use-chat-permission-mode'
import { syncSessionQueuedMessages } from './use-chat-session-messages'

const closeSocket = (socket: WebSocket | undefined) => {
  if (socket == null || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
    return
  }

  if (socket.readyState === WebSocket.CONNECTING) {
    socket.addEventListener('open', () => socket.close(), { once: true })
    return
  }

  socket.close()
}

const activeSessionCreationRequests = new Set<string>()
const SESSION_CREATION_REQUEST_TIMEOUT_MS = 30_000

const buildWorkspacePayload = (workspaceDraft: ChatSessionWorkspaceDraft | undefined, isDirty: boolean) => {
  if (workspaceDraft == null) {
    return undefined
  }

  if (!isDirty) {
    return undefined
  }

  if (!workspaceDraft.createWorktree) {
    return {
      createWorktree: false
    }
  }

  return {
    createWorktree: true,
    worktreeEnvironment: workspaceDraft.worktreeEnvironment,
    branch: workspaceDraft.branch
  }
}

export function useChatSessionActions({
  canonicalSessionId,
  session,
  modelForQuery,
  hasAvailableModels,
  effort,
  permissionMode,
  adapter,
  account,
  workspaceSourceSessionId,
  navigateOnCreate = true,
  collapseSenderHeaderOnCreate = true,
  onSessionCreated,
  sessionTargetDraft,
  sessionCreationContext,
  workspaceDraft,
  workspaceDraftDirty,
  workspaceConfigReady,
  onClearMessages
}: {
  canonicalSessionId?: string
  session?: Session
  modelForQuery?: string
  hasAvailableModels: boolean
  effort: ChatEffort
  permissionMode: PermissionMode
  adapter?: string
  account?: string
  workspaceSourceSessionId?: string
  navigateOnCreate?: boolean
  collapseSenderHeaderOnCreate?: boolean
  onSessionCreated?: (session: Session) => void
  sessionTargetDraft?: ChatSessionTargetDraft
  sessionCreationContext?: PendingSessionCreationContext
  workspaceDraft?: ChatSessionWorkspaceDraft
  workspaceDraftDirty?: boolean
  workspaceConfigReady?: boolean
  onClearMessages: () => void
}) {
  const { message } = App.useApp()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { mutate } = useSWRConfig()
  const { setHeaderCollapsed } = useSenderHeaderQueryState()
  const optimisticCreations = useAtomValue(optimisticSessionCreationsAtom)
  const setOptimisticCreations = useSetAtom(optimisticSessionCreationsAtom)
  const [isCreating, setIsCreating] = useState(false)
  const [terminatingSessionId, setTerminatingSessionId] = useState<string | undefined>()
  const [creationProgress, setCreationProgress] = useState<SessionCreationProgressEvent[]>([])
  const isThinking = isCreating || session?.status === 'running'
  const optimisticCreation = getActiveOptimisticSessionCreation(session, optimisticCreations)
  const isStopping = terminatingSessionId != null && terminatingSessionId === session?.id
  const shouldWatchCreationProgress = workspaceDraft?.createWorktree === true ||
    (workspaceDraftDirty !== true && workspaceConfigReady !== true)

  const navigateWithSearchPatch = useCallback((
    pathname: string,
    patch?: Record<string, string>,
    options: { replace?: boolean } = {}
  ) => {
    const nextParams = new URLSearchParams(location.search)

    if (patch != null) {
      for (const [key, value] of Object.entries(patch)) {
        if (value === '') {
          nextParams.delete(key)
        } else {
          nextParams.set(key, value)
        }
      }
    }

    void navigate({
      pathname,
      search: nextParams.toString() === '' ? '' : `?${nextParams.toString()}`
    }, { replace: options.replace })
  }, [location.search, navigate])

  const navigateWithCurrentSearch = useCallback((pathname: string, options: { replace?: boolean } = {}) => {
    navigateWithSearchPatch(pathname, undefined, options)
  }, [navigateWithSearchPatch])

  const insertSessionIntoCache = useCallback(async (newSession: Session) => {
    await mutate('/api/sessions', (prev: { sessions: Session[] } | undefined) => {
      if (!prev?.sessions) {
        return { sessions: [newSession] }
      }

      const withoutCurrent = prev.sessions.filter((item) => item.id !== newSession.id)
      return {
        ...prev,
        sessions: [newSession, ...withoutCurrent]
      }
    }, false)
  }, [mutate])

  const removeSessionFromCache = useCallback(async (id: string) => {
    await mutate('/api/sessions', (prev: { sessions: Session[] } | undefined) => {
      if (prev?.sessions == null) return prev
      return {
        ...prev,
        sessions: removeSessionFromList(prev.sessions, id)
      }
    }, false)
    await mutate('/api/sessions/archived', (prev: { sessions: Session[] } | undefined) => {
      if (prev?.sessions == null) return prev
      return {
        ...prev,
        sessions: removeSessionFromList(prev.sessions, id)
      }
    }, false)
  }, [mutate])

  const removeOptimisticCreation = useCallback((id: string) => {
    setOptimisticCreations((prev) => {
      if (prev[id] == null) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [setOptimisticCreations])

  const updateOptimisticCreation = useCallback((
    id: string,
    updater: (creation: OptimisticSessionCreation) => OptimisticSessionCreation
  ) => {
    setOptimisticCreations((prev) => {
      const current = prev[id]
      if (current == null) return prev
      return {
        ...prev,
        [id]: updater(current)
      }
    })
  }, [setOptimisticCreations])

  const resolveCreatedSession = useCallback(async (id: string) => {
    try {
      const res = await getSessionMessages(id, { limit: 20 })
      return res.session
    } catch (err) {
      console.warn('Failed to verify optimistic session creation state:', err)
      return undefined
    }
  }, [])

  const handleResolvedSessionCreation = useCallback(async (newSession: Session) => {
    if (isOptimisticSessionDiscarded(newSession.id)) {
      removeOptimisticCreation(newSession.id)
      await removeSessionFromCache(newSession.id)
      try {
        await deleteSession(newSession.id, { force: true })
      } catch (err) {
        console.warn('Failed to delete discarded optimistic session:', err)
      } finally {
        clearOptimisticSessionDiscarded(newSession.id)
      }
      return false
    }

    await insertSessionIntoCache(newSession)
    removeOptimisticCreation(newSession.id)
    clearOptimisticSessionDiscarded(newSession.id)
    if (collapseSenderHeaderOnCreate) {
      setHeaderCollapsed(true)
    }
    return true
  }, [
    collapseSenderHeaderOnCreate,
    insertSessionIntoCache,
    removeOptimisticCreation,
    removeSessionFromCache,
    setHeaderCollapsed
  ])

  const buildCreateSessionOptions = useCallback((id: string): OptimisticSessionCreationOptions => {
    const targetPrompt = getChatSessionTargetPrompt(sessionTargetDraft)
    const workspacePayload = buildWorkspacePayload(workspaceDraft, workspaceDraftDirty === true)
    return {
      id,
      ...targetPrompt,
      effort: effort === 'default' ? undefined : effort,
      permissionMode,
      parentSessionId: workspaceSourceSessionId,
      adapter,
      account,
      tags: sessionCreationContext?.tags,
      workspace: workspaceSourceSessionId == null
        ? workspacePayload
        : {
          ...workspacePayload,
          sourceSessionId: workspaceSourceSessionId,
          createWorktree: false
        }
    }
  }, [
    account,
    adapter,
    effort,
    permissionMode,
    sessionCreationContext?.tags,
    sessionTargetDraft,
    workspaceSourceSessionId,
    workspaceDraft,
    workspaceDraftDirty
  ])

  const openCreationProgressSocket = useCallback((sessionId: string) => {
    let socket: WebSocket | undefined
    let readyResolved = false
    let readyTimer: ReturnType<typeof setTimeout> | undefined

    const resolveReady = (resolve: () => void) => {
      if (readyResolved) return
      readyResolved = true
      if (readyTimer != null) {
        clearTimeout(readyTimer)
      }
      resolve()
    }

    const ready = new Promise<void>((resolve) => {
      readyTimer = setTimeout(() => resolveReady(resolve), 750)
      socket = createSocket<WSEvent>({
        onOpen: () => resolveReady(resolve),
        onError: () => resolveReady(resolve),
        onMessage: (data) => {
          if (data.type !== 'session_creation_progress' || data.sessionId !== sessionId) {
            return
          }

          setCreationProgress(current => [...current, data.progress])
        }
      }, { subscribe: 'sessions' })
    })

    return {
      ready,
      close: () => closeSocket(socket)
    }
  }, [])

  const createSessionWithTimeout = useCallback(async (
    request: OptimisticSessionCreationRequest
  ) => {
    const abortController = new AbortController()
    const timer = setTimeout(() => {
      abortController.abort()
    }, SESSION_CREATION_REQUEST_TIMEOUT_MS)

    try {
      return await createSession(
        request.title,
        request.initialMessage,
        request.initialContent,
        request.model,
        request.options,
        { signal: abortController.signal }
      )
    } finally {
      clearTimeout(timer)
    }
  }, [])

  const runSessionCreationRequest = useCallback(async (
    request: OptimisticSessionCreationRequest
  ) => {
    if (activeSessionCreationRequests.has(request.id)) {
      return false
    }

    activeSessionCreationRequests.add(request.id)
    let progressSocket: ReturnType<typeof openCreationProgressSocket> | undefined
    setCreationProgress([])
    try {
      progressSocket = shouldWatchCreationProgress
        ? openCreationProgressSocket(request.id)
        : undefined
      await progressSocket?.ready
      const { session: newSession } = await createSessionWithTimeout(request)

      return await handleResolvedSessionCreation(newSession)
    } catch (err) {
      console.error(err)
      const recoveredSession = await resolveCreatedSession(request.id)
      if (recoveredSession != null) {
        return await handleResolvedSessionCreation(recoveredSession)
      }
      if (isOptimisticSessionDiscarded(request.id)) {
        removeOptimisticCreation(request.id)
        await removeSessionFromCache(request.id)
        clearOptimisticSessionDiscarded(request.id)
        return false
      }
      const errorMessage = getApiErrorMessage(err, t('chat.sessionCreateFailedMessage'))
      updateOptimisticCreation(request.id, creation => markOptimisticSessionCreationFailed(creation, errorMessage))
      return false
    } finally {
      activeSessionCreationRequests.delete(request.id)
      progressSocket?.close()
    }
  }, [
    createSessionWithTimeout,
    handleResolvedSessionCreation,
    openCreationProgressSocket,
    removeOptimisticCreation,
    removeSessionFromCache,
    resolveCreatedSession,
    shouldWatchCreationProgress,
    t,
    updateOptimisticCreation
  ])

  const startOptimisticSessionCreation = useCallback((
    request: OptimisticSessionCreationRequest
  ) => {
    const creation = createOptimisticSessionCreation(request)
    clearOptimisticSessionDiscarded(creation.session.id)
    setIsCreating(true)
    setOptimisticCreations(prev => ({
      ...prev,
      [creation.session.id]: creation
    }))
    stageLocalUserMessage(creation.session.id, creation.message)
    void insertSessionIntoCache(creation.session)
    onSessionCreated?.(creation.session)
    void runSessionCreationRequest(request)
    if (navigateOnCreate) {
      navigateWithSearchPatch(`/session/${creation.session.id}`, {
        senderHeader: 'collapsed'
      })
    }
  }, [
    insertSessionIntoCache,
    navigateOnCreate,
    navigateWithSearchPatch,
    onSessionCreated,
    runSessionCreationRequest,
    setOptimisticCreations
  ])

  useEffect(() => {
    if (optimisticCreation?.status !== 'creating') {
      return
    }

    void runSessionCreationRequest(optimisticCreation.request)
  }, [optimisticCreation?.request, optimisticCreation?.status, runSessionCreationRequest])

  const retrySessionCreation = useCallback(async () => {
    if (optimisticCreation == null) {
      return false
    }

    updateOptimisticCreation(optimisticCreation.session.id, markOptimisticSessionCreationCreating)
    void insertSessionIntoCache({
      ...optimisticCreation.session,
      status: 'running'
    })

    return await runSessionCreationRequest(optimisticCreation.request)
  }, [insertSessionIntoCache, optimisticCreation, runSessionCreationRequest, updateOptimisticCreation])

  useEffect(() => {
    if (!isCreating || session?.id == null || session.id === '') return
    setIsCreating(false)
  }, [isCreating, session?.id])

  const send = useCallback(async (text: string, _mode?: SessionQueuedMessageMode) => {
    if (text.trim() === '' || isThinking) return false
    if (!hasAvailableModels) {
      void message.warning(t('chat.modelConfigRequired'))
      return false
    }
    if (optimisticCreation != null) {
      void message.warning(t('chat.retrySessionCreationRequired'))
      return false
    }

    if (!session?.id) {
      const id = createOptimisticSessionId()
      startOptimisticSessionCreation({
        id,
        title: sessionCreationContext?.title,
        initialMessage: text.trim(),
        model: modelForQuery,
        options: buildCreateSessionOptions(id)
      })
      return true
    }

    try {
      await sendSessionMessage(session.id, text.trim(), { permissionMode })
      return true
    } catch (err) {
      console.error(err)
      void message.error(getApiErrorMessage(err, t('common.operationFailed')))
      return false
    }
  }, [
    buildCreateSessionOptions,
    hasAvailableModels,
    isThinking,
    message,
    modelForQuery,
    optimisticCreation,
    permissionMode,
    sessionCreationContext?.title,
    session?.id,
    startOptimisticSessionCreation,
    t
  ])

  const sendContent = useCallback(async (content: ChatMessageContent[], _mode?: SessionQueuedMessageMode) => {
    if (content.length === 0 || isThinking) return false
    if (!hasAvailableModels) {
      void message.warning(t('chat.modelConfigRequired'))
      return false
    }
    if (optimisticCreation != null) {
      void message.warning(t('chat.retrySessionCreationRequired'))
      return false
    }

    if (!session?.id) {
      const id = createOptimisticSessionId()
      startOptimisticSessionCreation({
        id,
        title: sessionCreationContext?.title,
        initialContent: content,
        model: modelForQuery,
        options: buildCreateSessionOptions(id)
      })
      return true
    }

    try {
      await sendSessionMessage(session.id, content, { permissionMode })
      return true
    } catch (err) {
      console.error(err)
      void message.error(getApiErrorMessage(err, t('common.operationFailed')))
      return false
    }
  }, [
    buildCreateSessionOptions,
    hasAvailableModels,
    isThinking,
    message,
    modelForQuery,
    optimisticCreation,
    permissionMode,
    sessionCreationContext?.title,
    session?.id,
    startOptimisticSessionCreation,
    t
  ])

  const interrupt = useCallback(async () => {
    if (!session?.id || isThinking === false || terminatingSessionId === session.id) return

    const sessionId = session.id
    const messageKey = `chat-session-stop-${sessionId}`
    const isCreatingSession = optimisticCreation?.status === 'creating'
    setTerminatingSessionId(sessionId)
    void message.open({
      type: 'loading',
      content: t('chat.sessionStoppingMessage'),
      duration: 0,
      key: messageKey
    })

    try {
      await terminateSession(sessionId)
      void message.success({
        content: t('chat.sessionStopRequestedMessage'),
        duration: 1.6,
        key: messageKey
      })

      if (isCreatingSession) {
        markOptimisticSessionDiscarded(sessionId)
        removeOptimisticCreation(sessionId)
        await removeSessionFromCache(sessionId)
        setIsCreating(false)
      }
    } catch (err) {
      console.error(err)
      void message.error({
        content: getApiErrorMessage(err, t('chat.sessionStopFailedMessage')),
        duration: 3,
        key: messageKey
      })
    } finally {
      setTerminatingSessionId(current => current === sessionId ? undefined : current)
    }
  }, [
    isThinking,
    message,
    optimisticCreation?.status,
    removeOptimisticCreation,
    removeSessionFromCache,
    session?.id,
    t,
    terminatingSessionId
  ])

  const clearMessages = useCallback(() => {
    onClearMessages()
    void message.success('Messages cleared')
  }, [message, onClearMessages])

  const runMessageAction = useCallback(async (
    messageId: string,
    action: 'fork' | 'recall' | 'edit',
    options?: { content?: string | ChatMessageContent[] }
  ) => {
    if (session?.id == null || session.id === '') {
      return false
    }

    try {
      const { session: newSession } = await branchSessionFromMessage(session.id, messageId, action, options)
      await insertSessionIntoCache(newSession)
      const rootSessionId = canonicalSessionId ?? session.id
      void navigate({
        pathname: `/session/${rootSessionId}`,
        search: buildMessageBranchSearch({
          currentSearch: location.search,
          rootSessionId,
          targetSessionId: newSession.id
        })
      }, { replace: action === 'edit' })
      return true
    } catch (err) {
      console.error(err)
      void message.error(getApiErrorMessage(err, t('common.operationFailed')))
      return false
    }
  }, [canonicalSessionId, insertSessionIntoCache, location.search, message, navigate, session?.id, t])

  const forkMessage = useCallback((messageId: string) => {
    return runMessageAction(messageId, 'fork')
  }, [runMessageAction])

  const recallMessage = useCallback((messageId: string) => {
    return runMessageAction(messageId, 'recall')
  }, [runMessageAction])

  const editMessage = useCallback((messageId: string, content: string | ChatMessageContent[]) => {
    return runMessageAction(messageId, 'edit', { content })
  }, [runMessageAction])

  const enqueueContent = useCallback(async (mode: SessionQueuedMessageMode, content: ChatMessageContent[]) => {
    if (session?.id == null || session.id === '') {
      return false
    }
    if (content.length === 0) {
      return false
    }

    try {
      const { queuedMessages } = await createQueuedMessage(session.id, mode, content)
      syncSessionQueuedMessages(session.id, queuedMessages)
      return true
    } catch (err) {
      console.error(err)
      void message.error(getApiErrorMessage(err, t('common.operationFailed')))
      return false
    }
  }, [message, session?.id, t])

  const updateQueuedContent = useCallback(async (queueId: string, content: ChatMessageContent[]) => {
    if (session?.id == null || session.id === '') {
      return false
    }
    if (content.length === 0) {
      return false
    }

    try {
      const { queuedMessages } = await updateQueuedMessage(session.id, queueId, content)
      syncSessionQueuedMessages(session.id, queuedMessages)
      return true
    } catch (err) {
      console.error(err)
      void message.error(getApiErrorMessage(err, t('common.operationFailed')))
      return false
    }
  }, [message, session?.id, t])

  const removeQueuedContent = useCallback(async (queueId: string) => {
    if (session?.id == null || session.id === '') {
      return false
    }

    try {
      const { queuedMessages } = await deleteQueuedMessage(session.id, queueId)
      syncSessionQueuedMessages(session.id, queuedMessages)
      return true
    } catch (err) {
      console.error(err)
      void message.error(getApiErrorMessage(err, t('common.operationFailed')))
      return false
    }
  }, [message, session?.id, t])

  const moveQueuedContent = useCallback(async (queueId: string, mode: SessionQueuedMessageMode) => {
    if (session?.id == null || session.id === '') {
      return false
    }

    try {
      const { queuedMessages } = await moveQueuedMessage(session.id, queueId, mode)
      syncSessionQueuedMessages(session.id, queuedMessages)
      return true
    } catch (err) {
      console.error(err)
      void message.error(getApiErrorMessage(err, t('common.operationFailed')))
      return false
    }
  }, [message, session?.id, t])

  const reorderQueuedContent = useCallback(async (mode: SessionQueuedMessageMode, ids: string[]) => {
    if (session?.id == null || session.id === '') {
      return false
    }

    try {
      const { queuedMessages } = await reorderQueuedMessages(session.id, mode, ids)
      syncSessionQueuedMessages(session.id, queuedMessages)
      return true
    } catch (err) {
      console.error(err)
      void message.error(getApiErrorMessage(err, t('common.operationFailed')))
      return false
    }
  }, [message, session?.id, t])

  return {
    creationProgress,
    isCreating,
    isStopping,
    isThinking,
    send,
    sendContent,
    retrySessionCreation,
    enqueueContent,
    updateQueuedContent,
    removeQueuedContent,
    moveQueuedContent,
    reorderQueuedContent,
    editMessage,
    forkMessage,
    interrupt,
    clearMessages,
    recallMessage
  }
}
