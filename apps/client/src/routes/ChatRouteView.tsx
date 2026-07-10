import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import type { ChatMessageContent, Session } from '@oneworks/core'
import type { ConversationStarterConfig } from '@oneworks/types'

import type { AgentRoomMemberView } from '#~/components/agent-room'
import type { ChatHeaderBreadcrumb, ChatHeaderModeSwitch, ChatHeaderMoreItems } from '#~/components/chat/ChatHeader.js'
import { ChatHistoryView } from '#~/components/chat/ChatHistoryView.js'
import { ChatSettingsView } from '#~/components/chat/ChatSettingsView.js'
import { ChatTimelineView } from '#~/components/chat/ChatTimelineView.js'
import { buildChatHistoryStatusNotices } from '#~/components/chat/messages/build-chat-history-status-notices'
import type {
  PendingAnnotation,
  PendingAnnotationPreviewState,
  PendingFileComment
} from '#~/components/chat/sender/@types/sender-composer'
import type { ContextPickerFile, ContextReferenceRequest } from '#~/components/workspace/context-file-types'
import { useChatRouteDeepLinkView } from '#~/hooks/chat/use-chat-route-deep-link-view'
import { useChatSession } from '#~/hooks/chat/use-chat-session'
import { useSessionTimelineExperiment } from '#~/hooks/chat/use-session-timeline-experiment'
import type { WorkspaceFileLinkTarget } from '#~/utils/link-targets'

import { ChatRouteShell } from './ChatRouteShell'
import { CHAT_ROUTE_SENDER_FOCUS_QUERY_PARAM } from './chat-route-query'
import type { ChatRouteAgentRoomTranscript } from './chat-route-view-types'

const hiddenHistoryTimelineSessionStorageKey = 'oneworks.chat.hiddenHistoryTimelineSessionIds'

const PanelIndependentChatHistoryView = memo(ChatHistoryView)

const toPanelIndependentSession = (session: Session): Session => {
  const { panelState: _panelState, ...panelIndependentSession } = session
  return panelIndependentSession as Session
}

const getPanelIndependentSessionKey = (session?: Session) => {
  if (session == null) return ''

  return JSON.stringify(toPanelIndependentSession(session))
}

const getPanelIndependentSessionsKey = (sessions: Session[]) => JSON.stringify(sessions.map(toPanelIndependentSession))

const usePanelIndependentSession = (session?: Session) => {
  const key = useMemo(() => getPanelIndependentSessionKey(session), [session])
  const valueRef = useRef<{ key: string; value?: Session } | null>(null)

  if (valueRef.current?.key !== key) {
    valueRef.current = {
      key,
      value: session == null ? undefined : toPanelIndependentSession(session)
    }
  }

  return valueRef.current?.value
}

const usePanelIndependentSessions = (sessions: Session[]) => {
  const key = useMemo(() => getPanelIndependentSessionsKey(sessions), [sessions])
  const valueRef = useRef<{ key: string; value: Session[] } | null>(null)

  if (valueRef.current?.key !== key) {
    valueRef.current = {
      key,
      value: sessions.map(toPanelIndependentSession)
    }
  }

  return valueRef.current?.value ?? []
}

const readHiddenHistoryTimelineSessionIds = () => {
  if (typeof window === 'undefined') {
    return new Set<string>()
  }

  try {
    const rawValue = window.localStorage.getItem(hiddenHistoryTimelineSessionStorageKey)
    const parsedValue = rawValue == null ? [] : JSON.parse(rawValue)
    return new Set(
      Array.isArray(parsedValue) ? parsedValue.filter((value): value is string => typeof value === 'string') : []
    )
  } catch {
    return new Set<string>()
  }
}

const writeHiddenHistoryTimelineSessionIds = (sessionIds: Set<string>) => {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(hiddenHistoryTimelineSessionStorageKey, JSON.stringify([...sessionIds]))
  } catch {
    // Ignore storage failures; the in-memory toggle still works for this render.
  }
}

export function ChatRouteView({
  headerBreadcrumb,
  headerActionsOverride,
  headerMoreItems,
  newSessionGuide,
  enableTimelineView,
  isAgentRoomSession,
  agentRoomSourceMembers,
  modeSwitch,
  canonicalSessionId,
  projectWorkspaceFolder,
  session,
  sessions = session == null ? [] : [session],
  sessionActivityLabel: sessionActivityLabelOverride,
  agentRoomTranscript
}: {
  headerBreadcrumb?: ChatHeaderBreadcrumb
  headerActionsOverride?: ReactNode
  headerMoreItems?: ChatHeaderMoreItems
  newSessionGuide?: {
    announcements?: string[]
    builtinActions?: ConversationStarterConfig[]
    placeholder?: string
    startupPresets?: ConversationStarterConfig[]
    transformContent?: (content: ChatMessageContent[]) => ChatMessageContent[]
    transformText?: (text: string) => string
  }
  enableTimelineView?: boolean
  isAgentRoomSession?: boolean
  agentRoomSourceMembers?: AgentRoomMemberView[]
  modeSwitch?: ChatHeaderModeSwitch
  canonicalSessionId?: string
  projectWorkspaceFolder?: string
  session?: Session
  sessions?: Session[]
  sessionActivityLabel?: string
  agentRoomTranscript?: ChatRouteAgentRoomTranscript
}) {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [contextReferenceRequest, setContextReferenceRequest] = useState<ContextReferenceRequest | null>(null)
  const [annotationReferenceRequest, setAnnotationReferenceRequest] = useState<
    {
      annotations: PendingAnnotation[]
      id: number
    } | null
  >(null)
  const [fileCommentReferenceRequest, setFileCommentReferenceRequest] = useState<
    {
      comments: PendingFileComment[]
      id: number
    } | null
  >(null)
  const [pendingAnnotationReferenceCount, setPendingAnnotationReferenceCount] = useState(0)
  const [pendingAnnotations, setPendingAnnotations] = useState<PendingAnnotation[]>([])
  const [pendingFileComments, setPendingFileComments] = useState<PendingFileComment[]>([])
  const [pendingAnnotationPreview, setPendingAnnotationPreview] = useState<PendingAnnotationPreviewState>({
    activeAnnotationId: null,
    isActive: false
  })
  const [hiddenHistoryTimelineSessionIds, setHiddenHistoryTimelineSessionIds] = useState(
    readHiddenHistoryTimelineSessionIds
  )
  const isAgentRoomMode = agentRoomTranscript != null
  const resolvedEnableTimelineView = useSessionTimelineExperiment(isAgentRoomMode ? false : enableTimelineView)
  const canUseTimelineView = isAgentRoomMode ? false : resolvedEnableTimelineView
  const currentSessionId = session?.id
  const senderFocusQueryValue = searchParams.get(CHAT_ROUTE_SENDER_FOCUS_QUERY_PARAM)?.trim() || undefined
  const [consumedSenderFocusRequest, setConsumedSenderFocusRequest] = useState<
    {
      id: string
      sessionId?: string
    } | null
  >(null)
  const consumedSenderFocusSessionId = consumedSenderFocusRequest?.sessionId
  const senderFocusRequestId = senderFocusQueryValue ??
    (consumedSenderFocusSessionId === currentSessionId ? consumedSenderFocusRequest?.id : undefined)
  const panelIndependentSession = usePanelIndependentSession(session)
  const panelIndependentSessions = usePanelIndependentSessions(sessions)
  const isHistoryTimelineHidden = currentSessionId == null
    ? false
    : hiddenHistoryTimelineSessionIds.has(currentSessionId)
  const {
    creationProgress,
    messages,
    sessionInfo,
    sessionCompactionInfo,
    sessionCompactionEvents,
    sessionWorkspaceChanges,
    queuedMessages,
    interactionRequest,
    sessionActivityLabel,
    isReady,
    errorState,
    workspaceConnectionError,
    retryConnection,
    activeView,
    isTerminalPanelFolded,
    isTerminalOpen,
    setActiveView,
    setIsTerminalOpen,
    setIsTerminalPanelFolded,
    handleInteractionResponse,
    setMessages,
    placeholder,
    modelMenuGroups,
    builtinPreviewModelOptions,
    modelSearchOptions,
    recommendedModelOptions,
    servicePreviewModelOptions,
    toggleRecommendedModel,
    updatingRecommendedModelValue,
    selectedModel,
    modelForQuery,
    setSelectedModel,
    effort,
    setEffort,
    effortOptions,
    fastMode,
    setFastMode,
    supportsFastMode,
    permissionMode,
    setPermissionMode,
    permissionModeOptions,
    selectedAdapter,
    setSelectedAdapter,
    selectedAccount,
    setSelectedAccount,
    accountOptions,
    showAccountSelector,
    adapterOptions,
    hiddenBuiltinAdapterOptions,
    hasAvailableModels,
    modelUnavailable
  } = useChatSession({ enableTimelineView: canUseTimelineView, session })
  const targetMessageId = searchParams.get('messageId') ?? undefined
  const targetToolUseId = searchParams.get('toolUseId') ?? undefined
  useEffect(() => {
    if (!searchParams.has(CHAT_ROUTE_SENDER_FOCUS_QUERY_PARAM)) {
      return
    }

    if (senderFocusQueryValue != null) {
      setConsumedSenderFocusRequest({
        id: senderFocusQueryValue,
        sessionId: currentSessionId
      })
    }

    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete(CHAT_ROUTE_SENDER_FOCUS_QUERY_PARAM)
    setSearchParams(nextParams, { replace: true })
  }, [currentSessionId, searchParams, senderFocusQueryValue, setSearchParams])

  const debugSessionLogPath: string | undefined = undefined
  const workspaceDrawerViewParam = searchParams.get('workspaceView') ?? searchParams.get('view')
  const workspaceDrawerDefaultView = workspaceDrawerViewParam === 'settings'
    ? 'settings'
    : workspaceDrawerViewParam === 'changes'
    ? 'changes'
    : workspaceDrawerViewParam === 'tree'
    ? 'tree'
    : isAgentRoomMode
    ? 'approvals'
    : undefined
  const historyStatusNotices = useMemo(() =>
    buildChatHistoryStatusNotices({
      errorState,
      modelUnavailable,
      t
    }), [errorState, modelUnavailable, t])
  const resolvedSessionActivityLabel = sessionActivityLabelOverride ?? sessionActivityLabel
  const handleReferenceWorkspacePaths = (files: ContextPickerFile[]) => {
    if (files.length > 0) {
      setContextReferenceRequest(current => ({ id: (current?.id ?? 0) + 1, files }))
    }
  }
  const handleReferenceAnnotations = (annotations: PendingAnnotation[]) => {
    if (annotations.length > 0) {
      setAnnotationReferenceRequest(current => ({ id: (current?.id ?? 0) + 1, annotations }))
      setPendingAnnotationReferenceCount(current => current + annotations.length)
    }
  }
  const handleReferenceFileComments = (comments: PendingFileComment[]) => {
    if (comments.length > 0) {
      setFileCommentReferenceRequest(current => ({ id: (current?.id ?? 0) + 1, comments }))
    }
  }
  const handleHistoryTimelineHiddenChange = useCallback((hidden: boolean) => {
    if (currentSessionId == null || currentSessionId === '') {
      return
    }

    setHiddenHistoryTimelineSessionIds((current) => {
      const next = new Set(current)
      if (hidden) {
        next.add(currentSessionId)
      } else {
        next.delete(currentSessionId)
      }
      writeHiddenHistoryTimelineSessionIds(next)
      return next
    })
  }, [currentSessionId])
  const handleClearMessages = useCallback(() => setMessages([]), [setMessages])
  const renderHistoryView = useCallback(({
    onOpenUrlInAppBrowser,
    onOpenWorkspaceFile,
    workspaceRootPath
  }: {
    onOpenUrlInAppBrowser: (url: string, title?: string) => void
    onOpenWorkspaceFile: (path: string, target?: Pick<WorkspaceFileLinkTarget, 'column' | 'line'>) => void
    workspaceRootPath?: string
  }) => (
    <PanelIndependentChatHistoryView
      isReady={isReady}
      isAgentRoomSession={isAgentRoomSession}
      messages={messages}
      agentRoomSourceMembers={agentRoomSourceMembers}
      canonicalSessionId={canonicalSessionId ?? currentSessionId}
      session={panelIndependentSession}
      sessions={panelIndependentSessions}
      targetMessageId={targetMessageId}
      targetToolUseId={targetToolUseId}
      sessionInfo={sessionInfo}
      sessionCompactionEvents={sessionCompactionEvents}
      sessionWorkspaceChanges={sessionWorkspaceChanges}
      historyStatusNotices={historyStatusNotices}
      historyCreationProgress={creationProgress}
      sessionActivityLabel={resolvedSessionActivityLabel}
      queuedMessages={queuedMessages}
      onRetryConnection={retryConnection}
      interactionRequest={interactionRequest}
      onInteractionResponse={handleInteractionResponse}
      setMessages={setMessages}
      onClearMessages={handleClearMessages}
      placeholder={placeholder}
      newSessionGuide={newSessionGuide}
      modelMenuGroups={modelMenuGroups}
      builtinPreviewModelOptions={builtinPreviewModelOptions}
      modelSearchOptions={modelSearchOptions}
      recommendedModelOptions={recommendedModelOptions}
      servicePreviewModelOptions={servicePreviewModelOptions}
      onToggleRecommendedModel={toggleRecommendedModel}
      updatingRecommendedModelValue={updatingRecommendedModelValue}
      selectedModel={selectedModel}
      modelForQuery={modelForQuery}
      onModelChange={setSelectedModel}
      effort={effort}
      effortOptions={effortOptions}
      onEffortChange={setEffort}
      fastMode={fastMode}
      supportsFastMode={supportsFastMode}
      onFastModeChange={setFastMode}
      permissionMode={permissionMode}
      permissionModeOptions={permissionModeOptions}
      onPermissionModeChange={setPermissionMode}
      selectedAdapter={selectedAdapter}
      adapterOptions={adapterOptions}
      hiddenBuiltinAdapterOptions={hiddenBuiltinAdapterOptions}
      onAdapterChange={setSelectedAdapter}
      selectedAccount={selectedAccount}
      accountOptions={accountOptions}
      showAccountSelector={showAccountSelector}
      onAccountChange={setSelectedAccount}
      senderAutoFocusKey={senderFocusRequestId}
      modelUnavailable={modelUnavailable}
      hasAvailableModels={hasAvailableModels}
      agentRoomTranscript={agentRoomTranscript}
      contextReferenceRequest={contextReferenceRequest}
      annotationReferenceRequest={annotationReferenceRequest}
      fileCommentReferenceRequest={fileCommentReferenceRequest}
      onPendingAnnotationCountChange={setPendingAnnotationReferenceCount}
      onPendingAnnotationsChange={setPendingAnnotations}
      onPendingFileCommentsChange={setPendingFileComments}
      onPendingAnnotationPreviewChange={setPendingAnnotationPreview}
      hideHistoryTimeline={isHistoryTimelineHidden}
      onOpenUrlInAppBrowser={onOpenUrlInAppBrowser}
      onOpenWorkspaceFile={onOpenWorkspaceFile}
      workspaceRootPath={workspaceRootPath}
    />
  ), [
    adapterOptions,
    agentRoomSourceMembers,
    agentRoomTranscript,
    builtinPreviewModelOptions,
    canonicalSessionId,
    annotationReferenceRequest,
    contextReferenceRequest,
    fileCommentReferenceRequest,
    creationProgress,
    currentSessionId,
    effort,
    effortOptions,
    fastMode,
    handleClearMessages,
    handleInteractionResponse,
    hasAvailableModels,
    hiddenBuiltinAdapterOptions,
    historyStatusNotices,
    interactionRequest,
    isAgentRoomSession,
    isHistoryTimelineHidden,
    isReady,
    messages,
    modelForQuery,
    modelMenuGroups,
    modelSearchOptions,
    modelUnavailable,
    newSessionGuide,
    panelIndependentSession,
    panelIndependentSessions,
    pendingAnnotationReferenceCount,
    setPendingAnnotationPreview,
    permissionMode,
    permissionModeOptions,
    placeholder,
    queuedMessages,
    recommendedModelOptions,
    retryConnection,
    resolvedSessionActivityLabel,
    selectedAccount,
    selectedAdapter,
    selectedModel,
    senderFocusRequestId,
    servicePreviewModelOptions,
    setFastMode,
    sessionCompactionEvents,
    sessionInfo,
    sessionWorkspaceChanges,
    setEffort,
    setMessages,
    setPermissionMode,
    setSelectedAccount,
    setSelectedAdapter,
    setSelectedModel,
    supportsFastMode,
    showAccountSelector,
    targetMessageId,
    targetToolUseId,
    toggleRecommendedModel,
    updatingRecommendedModelValue
  ])
  useChatRouteDeepLinkView({ activeView, setActiveView, targetMessageId, targetToolUseId })
  return (
    <ChatRouteShell
      activeView={session?.id != null || isAgentRoomMode ? activeView : 'history'}
      headerActionsOverride={headerActionsOverride}
      historyView={renderHistoryView}
      agentRoster={agentRoomTranscript == null
        ? undefined
        : {
          members: agentRoomTranscript.members,
          onOpenRun: agentRoomTranscript.onOpenRun
        }}
      agentApprovals={agentRoomTranscript == null
        ? undefined
        : {
          room: agentRoomTranscript.room,
          onOpenRun: agentRoomTranscript.onOpenRun
        }}
      displayTitle={agentRoomTranscript?.room.title}
      debugSessionLogPath={debugSessionLogPath}
      enableTimelineView={canUseTimelineView}
      headerBreadcrumb={headerBreadcrumb}
      headerMoreItems={headerMoreItems}
      historyTimelineHidden={isHistoryTimelineHidden}
      isNewSession={!isAgentRoomMode && !session?.id && messages.length === 0 && sessionCompactionEvents.length === 0 &&
        sessionWorkspaceChanges.length === 0 &&
        historyStatusNotices.length === 0}
      isReady={isReady}
      isTerminalPanelFolded={isTerminalPanelFolded}
      isTerminalOpen={isTerminalOpen}
      messages={messages}
      modeSwitch={modeSwitch}
      projectWorkspaceFolder={projectWorkspaceFolder}
      roomIconSeed={agentRoomTranscript?.room.id}
      roomIconStatus={agentRoomTranscript?.roomIconStatus}
      session={session}
      sessionCompactionInfo={sessionCompactionInfo}
      sessionInfo={sessionInfo}
      settingsView={session?.id
        ? (
          <ChatSettingsView
            session={session}
            sessionCompactionInfo={sessionCompactionInfo}
            sessionInfo={sessionInfo}
            onClose={() => setActiveView('history')}
          />
        )
        : undefined}
      setActiveView={setActiveView}
      setIsTerminalPanelFolded={setIsTerminalPanelFolded}
      setIsTerminalOpen={setIsTerminalOpen}
      showViewSwitches={isAgentRoomMode ? false : undefined}
      timelineView={isAgentRoomMode ? undefined : <ChatTimelineView messages={messages} />}
      onHistoryTimelineHiddenChange={isAgentRoomMode ? undefined : handleHistoryTimelineHiddenChange}
      onReferenceWorkspacePaths={handleReferenceWorkspacePaths}
      onReferenceAnnotations={handleReferenceAnnotations}
      onReferenceFileComments={handleReferenceFileComments}
      hasPendingAnnotationReferences={pendingAnnotationReferenceCount > 0}
      pendingAnnotations={pendingAnnotations}
      pendingFileComments={pendingFileComments}
      pendingAnnotationPreview={pendingAnnotationPreview}
      workspaceDrawerDefaultView={workspaceDrawerDefaultView}
      workspaceConnectionError={workspaceConnectionError}
      workspaceConnectionInterrupted={errorState?.kind === 'connection' && errorState.code !== 'auth_required'}
      workspaceSessionId={agentRoomTranscript?.workspaceSessionId}
    />
  )
}
