import { useAtomValue } from 'jotai'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import type { Session } from '@oneworks/core'

import { getSession, getSessionCacheKey } from '#~/api'
import { ChatHistoryView } from '#~/components/chat/ChatHistoryView'
import { buildChatHistoryStatusNotices } from '#~/components/chat/messages/build-chat-history-status-notices'
import { optimisticSessionCreationsAtom } from '#~/hooks/chat/optimistic-session-creation'
import { useChatSession } from '#~/hooks/chat/use-chat-session'

import type { InteractionPanelSessionPage } from './interaction-panel-session-pages'

const getPanelSessionTitle = (session: Session | undefined, fallback: string) => (
  session?.title?.trim() || session?.lastUserMessage?.trim() || session?.id || fallback
)

export function InteractionPanelSessionView({
  autoFocusRequestId,
  page,
  sourceSessionId,
  onChangePage
}: {
  autoFocusRequestId?: string
  page: InteractionPanelSessionPage
  sourceSessionId?: string
  onChangePage: (updater: (page: InteractionPanelSessionPage) => InteractionPanelSessionPage) => void
}) {
  const { t } = useTranslation()
  const optimisticCreations = useAtomValue(optimisticSessionCreationsAtom)
  const optimisticCreation = page.sessionId == null ? undefined : optimisticCreations[page.sessionId]
  const { data: sessionRes } = useSWR<{ session: Session }>(
    page.sessionId != null && optimisticCreation?.status !== 'creating' ? getSessionCacheKey(page.sessionId) : null,
    () => getSession(page.sessionId ?? '')
  )
  const session = sessionRes?.session ?? optimisticCreation?.session
  const {
    creationProgress,
    messages,
    sessionInfo,
    sessionCompactionEvents,
    queuedMessages,
    interactionRequest,
    isReady,
    errorState,
    retryConnection,
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
  } = useChatSession({ enableTimelineView: false, session })
  const historyStatusNotices = useMemo(() =>
    buildChatHistoryStatusNotices({
      errorState,
      modelUnavailable,
      t
    }), [errorState, modelUnavailable, t])

  useEffect(() => {
    if (session == null) return
    const title = getPanelSessionTitle(session, page.title)
    if (title === page.title && session.id === page.sessionId) return
    onChangePage(current => ({
      ...current,
      sessionId: session.id,
      title
    }))
  }, [onChangePage, page.sessionId, page.title, session])

  return (
    <div className='chat-interaction-panel-session'>
      <ChatHistoryView
        embeddedSessionChrome
        navigateOnCreate={false}
        isReady={isReady}
        canonicalSessionId={session?.id}
        messages={messages}
        session={session}
        sessions={session == null ? [] : [session]}
        sessionInfo={sessionInfo}
        sessionCompactionEvents={sessionCompactionEvents}
        historyStatusNotices={historyStatusNotices}
        historyCreationProgress={creationProgress}
        queuedMessages={queuedMessages}
        onRetryConnection={retryConnection}
        interactionRequest={interactionRequest}
        onInteractionResponse={handleInteractionResponse}
        setMessages={setMessages}
        onClearMessages={() => setMessages([])}
        placeholder={placeholder}
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
        senderAutoFocusKey={autoFocusRequestId}
        modelUnavailable={modelUnavailable}
        hasAvailableModels={hasAvailableModels}
        workspaceSourceSessionId={sourceSessionId}
        onSessionCreated={(createdSession) => {
          onChangePage(current => ({
            ...current,
            sessionId: createdSession.id,
            title: getPanelSessionTitle(createdSession, current.title)
          }))
        }}
      />
    </div>
  )
}
