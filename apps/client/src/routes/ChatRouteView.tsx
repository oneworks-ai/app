import { useCallback, useMemo, useState } from 'react'
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
import type { ContextPickerFile, ContextReferenceRequest } from '#~/components/workspace/context-file-types'
import { useChatRouteDeepLinkView } from '#~/hooks/chat/use-chat-route-deep-link-view'
import { useChatSession } from '#~/hooks/chat/use-chat-session'
import { useSessionTimelineExperiment } from '#~/hooks/chat/use-session-timeline-experiment'

import { ChatRouteShell } from './ChatRouteShell'
import { CHAT_ROUTE_SENDER_FOCUS_QUERY_PARAM } from './chat-route-query'
import type { ChatRouteAgentRoomTranscript } from './chat-route-view-types'

const hiddenHistoryTimelineSessionStorageKey = 'oneworks.chat.hiddenHistoryTimelineSessionIds'

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
  sessionActivityLabel,
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
  const [searchParams] = useSearchParams()
  const [contextReferenceRequest, setContextReferenceRequest] = useState<ContextReferenceRequest | null>(null)
  const [hiddenHistoryTimelineSessionIds, setHiddenHistoryTimelineSessionIds] = useState(
    readHiddenHistoryTimelineSessionIds
  )
  const isAgentRoomMode = agentRoomTranscript != null
  const resolvedEnableTimelineView = useSessionTimelineExperiment(isAgentRoomMode ? false : enableTimelineView)
  const canUseTimelineView = isAgentRoomMode ? false : resolvedEnableTimelineView
  const currentSessionId = session?.id
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
    isReady,
    errorState,
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
  const senderFocusRequestId = searchParams.get(CHAT_ROUTE_SENDER_FOCUS_QUERY_PARAM)?.trim() || undefined
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
  const handleReferenceWorkspacePaths = (files: ContextPickerFile[]) => {
    if (files.length > 0) {
      setContextReferenceRequest(current => ({ id: (current?.id ?? 0) + 1, files }))
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
  useChatRouteDeepLinkView({ activeView, setActiveView, targetMessageId, targetToolUseId })
  return (
    <ChatRouteShell
      activeView={session?.id != null || isAgentRoomMode ? activeView : 'history'}
      headerActionsOverride={headerActionsOverride}
      historyView={({ onOpenUrlInAppBrowser, onOpenWorkspaceFile, workspaceRootPath }) => (
        <ChatHistoryView
          isReady={isReady}
          isAgentRoomSession={isAgentRoomSession}
          messages={messages}
          agentRoomSourceMembers={agentRoomSourceMembers}
          canonicalSessionId={canonicalSessionId ?? session?.id}
          session={session}
          sessions={sessions}
          targetMessageId={targetMessageId}
          targetToolUseId={targetToolUseId}
          sessionInfo={sessionInfo}
          sessionCompactionEvents={sessionCompactionEvents}
          sessionWorkspaceChanges={sessionWorkspaceChanges}
          historyStatusNotices={historyStatusNotices}
          historyCreationProgress={creationProgress}
          sessionActivityLabel={sessionActivityLabel}
          queuedMessages={queuedMessages}
          onRetryConnection={retryConnection}
          interactionRequest={interactionRequest}
          onInteractionResponse={handleInteractionResponse}
          setMessages={setMessages}
          onClearMessages={() => setMessages([])}
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
          hideHistoryTimeline={isHistoryTimelineHidden}
          onOpenUrlInAppBrowser={onOpenUrlInAppBrowser}
          onOpenWorkspaceFile={onOpenWorkspaceFile}
          workspaceRootPath={workspaceRootPath}
        />
      )}
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
      workspaceDrawerDefaultView={workspaceDrawerDefaultView}
      workspaceSessionId={agentRoomTranscript?.workspaceSessionId}
    />
  )
}
