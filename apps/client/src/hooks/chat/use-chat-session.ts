/* eslint-disable max-lines -- hook wires the chat route state surface. */
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { Session } from '@oneworks/core'

import { getActiveOptimisticSessionCreation, optimisticSessionCreationsAtom } from './optimistic-session-creation'
import { getSessionActivityLabel } from './session-activity-label'
import { useChatAdapterAccountSelection } from './use-chat-adapter-account-selection'
import { useChatEffort } from './use-chat-effort'
import { useChatInteraction } from './use-chat-interaction'
import { useChatModelAdapterSelection } from './use-chat-model-adapter-selection'
import { useChatPermissionMode } from './use-chat-permission-mode'
import { useChatSessionMessages } from './use-chat-session-messages'
import { useChatView } from './use-chat-view'
import { useSessionPermissionModeChange } from './use-session-permission-mode-change'

type ObservedSessionSelection = Pick<Session, 'id' | 'model' | 'permissionMode' | 'adapter' | 'account' | 'effort'>

export function useChatSession({ enableTimelineView, session }: { enableTimelineView?: boolean; session?: Session }) {
  const { t } = useTranslation()
  const optimisticCreations = useAtomValue(optimisticSessionCreationsAtom)
  const optimisticCreation = getActiveOptimisticSessionCreation(session, optimisticCreations)
  const {
    adapterOptions,
    applySessionSelection,
    hiddenBuiltinAdapterOptions,
    modelMenuGroups,
    selectedAdapter,
    selectedModel,
    selectedModelWithService,
    setSelectedModel,
    setSelectedAdapter,
    builtinPreviewModelOptions,
    modelSearchOptions,
    recommendedModelOptions,
    servicePreviewModelOptions,
    toggleRecommendedModel,
    updatingRecommendedModelValue,
    hasAvailableModels
  } = useChatModelAdapterSelection({
    adapterLocked: session?.id != null
  })
  const {
    accountOptions,
    selectedAccount,
    setSelectedAccount,
    applySessionSelection: applySessionAccountSelection,
    showAccountSelector
  } = useChatAdapterAccountSelection({
    adapter: selectedAdapter,
    model: selectedModelWithService
  })
  const { permissionMode, setPermissionMode, permissionModeOptions } = useChatPermissionMode()
  const { effort, setEffort, effortOptions } = useChatEffort()
  const {
    activeView,
    isTerminalOpen,
    isTerminalPanelFolded,
    setActiveView,
    setIsTerminalOpen,
    setIsTerminalPanelFolded
  } = useChatView({ enableTimelineView })
  const { interactionRequest, setInteractionRequest, handleInteractionResponse: submitInteractionResponse } =
    useChatInteraction({
      sessionId: session?.id
    })
  const {
    creationProgress,
    messages,
    setMessages,
    sessionInfo,
    sessionOperationInfo,
    sessionCompactionInfo,
    sessionCompactionEvents,
    sessionWorkspaceChanges,
    queuedMessages,
    isReady,
    errorState,
    workspaceConnectionError,
    retryConnection,
    reconcileAfterInteraction
  } = useChatSessionMessages({
    session,
    modelForQuery: selectedModelWithService,
    effort,
    permissionMode,
    adapter: selectedAdapter,
    account: selectedAccount,
    optimisticCreation,
    setInteractionRequest
  })
  const handleInteractionResponse = useCallback((id: string, data: string | string[]) => {
    reconcileAfterInteraction()
    submitInteractionResponse(id, data)
  }, [reconcileAfterInteraction, submitInteractionResponse])
  const handlePermissionModeChange = useSessionPermissionModeChange(session?.id, setPermissionMode)
  const lastObservedSessionRef = useRef<ObservedSessionSelection | null>(null)
  const isThinking = session?.status === 'running'
  const sessionActivityLabel = getSessionActivityLabel(sessionOperationInfo, t)

  useEffect(() => {
    if (session?.id == null || session.id === '') {
      lastObservedSessionRef.current = null
      return
    }

    const previous = lastObservedSessionRef.current
    const sessionChanged = previous?.id !== session.id

    if (sessionChanged || previous?.model !== session.model || previous?.adapter !== session.adapter) {
      applySessionSelection({
        model: session.model,
        adapter: session.adapter
      })
    }

    if (sessionChanged || previous?.account !== session.account) {
      applySessionAccountSelection({
        account: session.account
      })
    }

    if (sessionChanged || previous?.permissionMode !== session.permissionMode) {
      setPermissionMode(session.permissionMode)
    }

    if (sessionChanged || previous?.effort !== session.effort) {
      setEffort(session.effort)
    }

    lastObservedSessionRef.current = {
      id: session.id,
      model: session.model,
      permissionMode: session.permissionMode,
      adapter: session.adapter,
      account: session.account,
      effort: session.effort
    }
  }, [
    applySessionAccountSelection,
    session?.adapter,
    session?.account,
    session?.effort,
    session?.id,
    session?.model,
    session?.permissionMode,
    applySessionSelection,
    setEffort,
    setPermissionMode
  ])

  return {
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
    workspaceConnectionError,
    retryConnection,
    isThinking,
    sessionActivityLabel,
    activeView,
    isTerminalPanelFolded,
    isTerminalOpen,
    setActiveView,
    setIsTerminalOpen,
    setIsTerminalPanelFolded,
    handleInteractionResponse,
    setMessages,
    placeholder: !session?.id ? t('chat.newSessionPlaceholder') : undefined,
    modelMenuGroups,
    builtinPreviewModelOptions,
    modelSearchOptions,
    recommendedModelOptions,
    servicePreviewModelOptions,
    toggleRecommendedModel,
    updatingRecommendedModelValue,
    selectedModel,
    modelForQuery: selectedModelWithService,
    setSelectedModel,
    effort,
    setEffort,
    effortOptions,
    permissionMode,
    setPermissionMode: handlePermissionModeChange,
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
    modelUnavailable: !hasAvailableModels
  }
}
