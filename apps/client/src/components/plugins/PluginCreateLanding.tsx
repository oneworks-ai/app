/* eslint-disable max-lines -- plugin creation landing mirrors automation chat setup and composer wiring. */

import './PluginCreateLanding.scss'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import type { ChatMessageContent } from '@oneworks/core'
import type { ConfigResponse } from '@oneworks/types'

import { getConfig } from '#~/api.js'
import { Sender } from '#~/components/chat/sender/Sender'
import { ChatStatusBar } from '#~/components/chat/status-bar/ChatStatusBar'
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

const noop = () => {}

type Translate = (key: string, options?: Record<string, string>) => string

const buildPluginCreationText = (text: string, t: Translate) => {
  const request = text.trim()
  const lowerRequest = request.toLowerCase()
  if (
    lowerRequest.includes('create-plugin') ||
    lowerRequest.includes('plugin-creator')
  ) {
    return request
  }

  return t('pluginStore.createLandingSendInstruction', { request })
}

const buildPluginCreationContent = (content: ChatMessageContent[], t: Translate) => {
  let didWrapText = false
  const nextContent = content.map((item): ChatMessageContent => {
    if (item.type !== 'text' || didWrapText) return item

    didWrapText = true
    return {
      ...item,
      text: buildPluginCreationText(item.text, t)
    }
  })

  if (didWrapText) return nextContent

  return [
    { type: 'text' as const, text: t('pluginStore.createLandingAttachmentInstruction') },
    ...nextContent
  ]
}

export function PluginCreateLanding() {
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
  const [starterContent, setStarterContent] = useState('')
  const [starterContentKey, setStarterContentKey] = useState(0)
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
  const { effort, setEffort, effortOptions } = useChatEffort()
  const { permissionMode, setPermissionMode, permissionModeOptions } = useChatPermissionMode()
  const { isCreating, isStopping, send, sendContent, interrupt } = useChatSessionActions({
    modelForQuery: selectedModelWithService,
    hasAvailableModels,
    effort,
    permissionMode,
    adapter: selectedAdapter,
    sessionTargetDraft,
    workspaceDraft,
    onClearMessages: noop
  })

  const starters = useMemo(() => [
    {
      description: t('pluginStore.starterChatActionDescription'),
      icon: 'add_comment',
      prompt: t('pluginStore.starterChatActionPrompt'),
      title: t('pluginStore.starterChatActionTitle')
    },
    {
      description: t('pluginStore.starterLauncherDescription'),
      icon: 'manage_search',
      prompt: t('pluginStore.starterLauncherPrompt'),
      title: t('pluginStore.starterLauncherTitle')
    },
    {
      description: t('pluginStore.starterWorkbenchDescription'),
      icon: 'tab',
      prompt: t('pluginStore.starterWorkbenchPrompt'),
      title: t('pluginStore.starterWorkbenchTitle')
    },
    {
      description: t('pluginStore.starterRouteDescription'),
      icon: 'route',
      prompt: t('pluginStore.starterRoutePrompt'),
      title: t('pluginStore.starterRouteTitle')
    }
  ], [t])

  const handleSelectStarter = (prompt: string) => {
    setStarterContent(prompt)
    setStarterContentKey(current => current + 1)
  }

  useEffect(() => {
    if (workspaceDraftDirtyRef.current) return
    setWorkspaceDraft({ ...defaultWorkspaceDraft })
  }, [defaultWorkspaceDraft])

  const composer = (
    <div className='sender-container plugin-create-guide__composer'>
      <Sender
        key={starterContentKey}
        initialContent={starterContent}
        placeholder={t('pluginStore.createLandingPlaceholder')}
        autoFocus
        sessionStatus={isCreating ? 'running' : undefined}
        onInterrupt={interrupt}
        stopLoading={isStopping}
        onSend={text => send(buildPluginCreationText(text, t))}
        onSendContent={content => sendContent(buildPluginCreationContent(content, t))}
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
          disabled: isCreating,
          onChange: setSessionTargetDraft
        }}
      />
      <ChatStatusBar
        draftWorkspace={workspaceDraft}
        isCreating={isCreating}
        onDraftWorkspaceChange={(nextDraft) => {
          workspaceDraftDirtyRef.current = true
          setWorkspaceDraft(nextDraft)
        }}
      />
    </div>
  )

  const landingClassName = [
    'plugin-create-landing',
    isCompactLayout || isTouchInteraction ? 'plugin-create-landing--compact' : ''
  ].filter(Boolean).join(' ')

  return (
    <div className={landingClassName}>
      <div className='plugin-create-guide'>
        <div className='plugin-create-guide__header'>
          <h2>{t('pluginStore.createLandingTitle')}</h2>
          <p>{t('pluginStore.createLandingDescription')}</p>
        </div>
        <div className='plugin-create-guide__grid'>
          {starters.map(item => (
            <button
              key={item.title}
              type='button'
              className='plugin-create-guide__item'
              onClick={() => handleSelectStarter(item.prompt)}
            >
              <span className='material-symbols-rounded plugin-create-guide__icon'>{item.icon}</span>
              <span className='plugin-create-guide__item-text'>
                <span className='plugin-create-guide__item-title'>{item.title}</span>
                <span className='plugin-create-guide__item-desc'>{item.description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      {composer}
    </div>
  )
}
