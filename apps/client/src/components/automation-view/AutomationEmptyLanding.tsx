import './AutomationEmptyLanding.scss'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import type { ChatMessageContent } from '@oneworks/core'
import type { ConfigResponse } from '@oneworks/types'

import { getConfig } from '#~/api.js'
import { Sender } from '#~/components/chat/sender/Sender'
import { ChatStatusBar } from '#~/components/chat/status-bar/ChatStatusBar'
import { ComposerLanding } from '#~/components/composer-landing/ComposerLanding'
import {
  SidebarListCollapsedActionButton,
  SidebarListCollapsedActions
} from '#~/components/sidebar-list/SidebarListHeader'
import { DEFAULT_CHAT_SESSION_TARGET_DRAFT } from '#~/hooks/chat/chat-session-target'
import type { ChatSessionTargetDraft } from '#~/hooks/chat/chat-session-target'
import {
  DEFAULT_CHAT_SESSION_WORKSPACE_DRAFT,
  getChatSessionWorkspaceDraftFromConfig
} from '#~/hooks/chat/chat-session-workspace-draft'
import { useChatEffort } from '#~/hooks/chat/use-chat-effort'
import { useChatModelAdapterSelection } from '#~/hooks/chat/use-chat-model-adapter-selection'
import { useChatPermissionMode } from '#~/hooks/chat/use-chat-permission-mode'
import { useChatSessionActions } from '#~/hooks/chat/use-chat-session-actions'
import { useResponsiveLayout } from '#~/hooks/use-responsive-layout'
import { buildAutomationCreationContent, buildAutomationCreationText } from './@utils/automation-empty-message'
import { AutomationEmptyGuide } from './AutomationEmptyGuide'

const noop = () => {}

interface AutomationEmptyLandingProps {
  flushPanelPadding?: boolean
  isCreatingRule?: boolean
  isRulePanelCollapsed?: boolean
  onCreateRule?: () => void
}

export function AutomationEmptyLanding({
  flushPanelPadding = false,
  isCreatingRule = false,
  isRulePanelCollapsed = false,
  onCreateRule
}: AutomationEmptyLandingProps) {
  const { t } = useTranslation()
  const { isCompactLayout, isTouchInteraction } = useResponsiveLayout()
  const { data: configRes } = useSWR<ConfigResponse>('/api/config', getConfig)
  const workspaceDraftDirtyRef = useRef(false)
  const defaultWorkspaceDraft = useMemo(() => (
    configRes == null ? DEFAULT_CHAT_SESSION_WORKSPACE_DRAFT : getChatSessionWorkspaceDraftFromConfig(configRes)
  ), [configRes])
  const [sessionTargetDraft, setSessionTargetDraft] = useState<ChatSessionTargetDraft>(() => ({
    ...DEFAULT_CHAT_SESSION_TARGET_DRAFT
  }))
  const [workspaceDraft, setWorkspaceDraft] = useState(() => ({ ...DEFAULT_CHAT_SESSION_WORKSPACE_DRAFT }))
  const [starterContent, setStarterContent] = useState<ChatMessageContent[] | undefined>(undefined)
  const {
    adapterOptions,
    hasAvailableModels,
    hiddenBuiltinAdapterOptions,
    builtinPreviewModelOptions,
    modelMenuGroups,
    modelSearchOptions,
    recommendedModelOptions,
    selectedAdapter,
    selectedModel,
    selectedModelWithService,
    servicePreviewModelOptions,
    setSelectedAdapter,
    setSelectedModel,
    toggleRecommendedModel,
    updatingRecommendedModelValue
  } = useChatModelAdapterSelection()
  const { effort, setEffort, effortOptions } = useChatEffort({
    adapter: selectedAdapter,
    model: selectedModelWithService
  })
  const { permissionMode, setPermissionMode, permissionModeOptions } = useChatPermissionMode()
  const { isCreating: isCreatingSession, isStopping, send, sendContent, interrupt } = useChatSessionActions({
    modelForQuery: selectedModelWithService,
    hasAvailableModels,
    effort,
    permissionMode,
    adapter: selectedAdapter,
    sessionTargetDraft,
    workspaceDraft,
    onClearMessages: noop
  })

  const handleSelectStarter = (prompt: string) => {
    setStarterContent([{ type: 'text', text: prompt }])
  }

  const composer = (
    <div className='sender-container sender-container--chat-surface automation-empty-guide__composer'>
      <Sender
        initialContent={starterContent}
        placeholder={t('automation.emptyLandingPlaceholder')}
        autoFocus
        sessionStatus={isCreatingSession ? 'running' : undefined}
        onInterrupt={interrupt}
        stopLoading={isStopping}
        onSend={(text) => send(buildAutomationCreationText(text, t))}
        onSendContent={(content) => sendContent(buildAutomationCreationContent(content, t))}
        builtinPreviewModelOptions={builtinPreviewModelOptions}
        modelMenuGroups={modelMenuGroups}
        modelSearchOptions={modelSearchOptions}
        recommendedModelOptions={recommendedModelOptions}
        servicePreviewModelOptions={servicePreviewModelOptions}
        onToggleRecommendedModel={toggleRecommendedModel}
        updatingRecommendedModelValue={updatingRecommendedModelValue}
        selectedModel={selectedModel}
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
        modelUnavailable={!hasAvailableModels}
        sessionTarget={{
          draft: sessionTargetDraft,
          locked: false,
          disabled: isCreatingSession,
          onChange: setSessionTargetDraft
        }}
      />
      <ChatStatusBar
        draftWorkspace={workspaceDraft}
        isCreating={isCreatingSession}
        onDraftWorkspaceChange={(nextDraft) => {
          workspaceDraftDirtyRef.current = true
          setWorkspaceDraft(nextDraft)
        }}
      />
    </div>
  )

  useEffect(() => {
    if (workspaceDraftDirtyRef.current) return
    setWorkspaceDraft({ ...defaultWorkspaceDraft })
  }, [defaultWorkspaceDraft])

  const shellClassName = flushPanelPadding
    ? 'automation-empty-landing-shell automation-empty-landing-shell--flush-panel'
    : 'automation-empty-landing-shell'

  return (
    <div className={shellClassName}>
      {isRulePanelCollapsed && (
        <SidebarListCollapsedActions className='automation-empty-landing__collapsed-actions'>
          <SidebarListCollapsedActionButton
            active={isCreatingRule}
            disabled={isCreatingRule}
            filled={isCreatingRule}
            icon={isCreatingRule ? 'progress_activity' : 'add'}
            tooltip={isCreatingRule ? t('automation.creatingRule') : t('automation.newTask')}
            ariaLabel={isCreatingRule ? t('automation.creatingRule') : t('automation.newTask')}
            onClick={onCreateRule}
          />
        </SidebarListCollapsedActions>
      )}
      <ComposerLanding
        className='composer-landing--starter automation-empty-landing'
        compact={isCompactLayout || isTouchInteraction}
      >
        <AutomationEmptyGuide composer={composer} onSelectStarter={handleSelectStarter} />
      </ComposerLanding>
    </div>
  )
}
