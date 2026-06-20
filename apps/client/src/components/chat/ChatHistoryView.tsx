import { App } from 'antd'
import { useAtomValue, useSetAtom } from 'jotai'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import useSWR from 'swr'

import type {
  AskUserQuestionParams,
  ChatMessage,
  ChatMessageContent,
  Session,
  SessionMessageQueueState,
  SessionQueuedMessage,
  SessionQueuedMessageMode,
  SessionWorkspaceChanges
} from '@oneworks/core'
import type {
  ConfigResponse,
  ConfigSource,
  ConversationStarterConfig,
  SessionCreationProgressEvent,
  SessionInfo
} from '@oneworks/types'

import {
  getApiErrorMessage,
  getConfig,
  openSessionWorkspaceFileInExternalOpener,
  openWorkspaceFileInExternalOpener,
  updateConfig
} from '#~/api'
import {
  AgentRoomTranscript,
  createAgentRoomSenderSubmit,
  getAgentRoomMemberMention,
  getAgentRoomMentionCompletions,
  resolveRoomTarget
} from '#~/components/agent-room'
import type {
  AgentRoomMemberView,
  AgentRoomMessageView,
  AgentRoomRunView,
  AgentRoomSenderSubmit,
  AgentRoomViewModel
} from '#~/components/agent-room'
import { ComposerStack } from '#~/components/composer-landing/ComposerLanding'
import {
  buildModelServiceConfigSessionInitialContent,
  buildModelServiceConfigSessionTitle
} from '#~/components/config/modelServiceConfigSession'
import type { ContextReferenceRequest } from '#~/components/workspace/context-file-types'
import {
  DEFAULT_CHAT_SESSION_TARGET_DRAFT,
  getChatSessionTargetDraftFromSession,
  isChatSessionTargetReady
} from '#~/hooks/chat/chat-session-target'
import type { ChatSessionTargetDraft } from '#~/hooks/chat/chat-session-target'
import {
  DEFAULT_CHAT_SESSION_WORKSPACE_DRAFT,
  getChatSessionWorkspaceDraftFromConfig
} from '#~/hooks/chat/chat-session-workspace-draft'
import type { ChatSessionWorkspaceDraft } from '#~/hooks/chat/chat-session-workspace-draft'
import { createLocalUserMessageId } from '#~/hooks/chat/local-user-message'
import type { SessionCompactionInfo } from '#~/hooks/chat/session-compaction'
import { resolveSessionCompactionStatus } from '#~/hooks/chat/session-compaction'
import {
  hasPersistedSessionCreationTarget,
  pendingSessionCreationContextAtom,
  pendingSessionInitialContentAtom,
  shouldUsePendingSessionCreationContext
} from '#~/hooks/chat/session-creation-context'
import type { ChatAdapterAccountOption } from '#~/hooks/chat/use-chat-adapter-account-selection'
import type { ChatEffort } from '#~/hooks/chat/use-chat-effort'
import type {
  ChatAdapterSelectOption,
  HiddenBuiltinAdapterOption,
  ModelSelectMenuGroup,
  ModelSelectOption
} from '#~/hooks/chat/use-chat-model-adapter-selection'
import type { PermissionMode } from '#~/hooks/chat/use-chat-permission-mode'
import { useChatScroll } from '#~/hooks/chat/use-chat-scroll'
import { useChatSessionActions } from '#~/hooks/chat/use-chat-session-actions'
import { useResponsiveLayout } from '#~/hooks/use-responsive-layout'
import { getLoopedIndex } from '#~/hooks/use-roving-focus-list'
import type { WorkspaceFileLinkTarget } from '#~/utils/link-targets'
import { buildMessageBranchSearch } from '#~/utils/message-branch-session'
import { resolveMessageLinksConfig } from '#~/utils/message-links-config'

import { CurrentTodoList } from './CurrentTodoList'
import { NewSessionGuide } from './NewSessionGuide'
import { QueuedMessagesCard } from './QueuedMessagesCard'
import {
  ChatHistoryTimelineView,
  buildChatHistoryTimelineCurrentStatus,
  buildChatHistoryTimelineFromMessageTurns,
  useChatHistoryTimelineController
} from './history-timeline'
import type { ChatHistoryTimelineSelectHandler } from './history-timeline'
import { AgentRoomChildRequestCard } from './messages/AgentRoomChildRequestCard'
import { MessageItem } from './messages/MessageItem'
import { MessageStatusNotice } from './messages/MessageStatusNotice'
import { SessionWorkspaceChangesCard } from './messages/SessionWorkspaceChangesCard'
import { createSessionCompactionNotice } from './messages/build-chat-history-status-notices'
import type { ChatHistoryStatusNotice } from './messages/build-chat-history-status-notices'
import { buildMessageBranchNavigationMap } from './messages/message-branch-navigation'
import type { ChatRenderItem } from './messages/message-render-types'
import { buildMessageTurns } from './messages/message-turns'
import { processMessages } from './messages/message-utils'
import {
  buildConversationStarterInitialContent,
  buildConversationStarterTargetDraft,
  buildConversationStarterWorkspacePatch,
  getNewSessionGuideData
} from './new-session-guide-config'
import { SenderInteractionPanel } from './sender/@components/sender-interaction-panel/SenderInteractionPanel'
import { Sender } from './sender/Sender'
import { SessionCreationProgressBanner } from './session-creation-progress/SessionCreationProgressBanner'
import { ChatStatusBar } from './status-bar/ChatStatusBar'
import { ToolGroup } from './tools/core/ToolGroup'

const modelServiceConfigSourcePriority: ConfigSource[] = ['user', 'project', 'global']

const getCompactionNoticeAnchorId = (id: string) => (
  `status-notice-${id.replace(/[^\w-]/g, '-')}`
)

const getWorkspaceChangesAnchorId = (id: string) => (
  `workspace-changes-${id.replace(/[^\w-]/g, '-')}`
)

export function ChatHistoryView({
  isReady,
  isAgentRoomSession,
  agentRoomSourceMembers,
  canonicalSessionId,
  messages,
  session,
  sessions = session == null ? [] : [session],
  targetMessageId,
  targetToolUseId,
  sessionInfo,
  sessionCompactionEvents = [],
  sessionWorkspaceChanges = [],
  historyStatusNotices,
  historyCreationProgress = [],
  sessionActivityLabel,
  queuedMessages,
  onRetryConnection,
  interactionRequest,
  onInteractionResponse,
  setMessages,
  onClearMessages,
  placeholder,
  newSessionGuide,
  modelMenuGroups,
  builtinPreviewModelOptions,
  modelSearchOptions,
  recommendedModelOptions,
  servicePreviewModelOptions,
  onToggleRecommendedModel,
  updatingRecommendedModelValue,
  selectedModel,
  modelForQuery,
  onModelChange,
  effort,
  effortOptions,
  onEffortChange,
  permissionMode,
  permissionModeOptions,
  onPermissionModeChange,
  selectedAdapter,
  adapterOptions,
  hiddenBuiltinAdapterOptions,
  onAdapterChange,
  selectedAccount,
  accountOptions,
  showAccountSelector,
  onAccountChange,
  modelUnavailable,
  hasAvailableModels,
  agentRoomTranscript,
  contextReferenceRequest,
  hideHistoryTimeline = false,
  onOpenUrlInAppBrowser,
  onOpenWorkspaceFile,
  workspaceRootPath,
  embeddedSessionChrome = false,
  navigateOnCreate = true,
  onSessionCreated,
  workspaceSourceSessionId,
  senderAutoFocusKey
}: {
  isReady: boolean
  isAgentRoomSession?: boolean
  agentRoomSourceMembers?: AgentRoomMemberView[]
  canonicalSessionId?: string
  messages: ChatMessage[]
  session?: Session
  sessions?: Session[]
  targetMessageId?: string
  targetToolUseId?: string
  sessionInfo: SessionInfo | null
  sessionCompactionEvents?: SessionCompactionInfo[]
  sessionWorkspaceChanges?: SessionWorkspaceChanges[]
  historyStatusNotices: ChatHistoryStatusNotice[]
  historyCreationProgress?: SessionCreationProgressEvent[]
  sessionActivityLabel?: string
  queuedMessages: SessionMessageQueueState
  onRetryConnection: () => void
  interactionRequest: { id: string; payload: AskUserQuestionParams } | null
  onInteractionResponse: (id: string, data: string | string[]) => void
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
  onClearMessages: () => void
  placeholder?: string
  newSessionGuide?: {
    announcements?: string[]
    builtinActions?: ConversationStarterConfig[]
    placeholder?: string
    startupPresets?: ConversationStarterConfig[]
    transformContent?: (content: ChatMessageContent[]) => ChatMessageContent[]
    transformText?: (text: string) => string
  }
  modelMenuGroups: ModelSelectMenuGroup[]
  builtinPreviewModelOptions: ModelSelectOption[]
  modelSearchOptions: ModelSelectOption[]
  recommendedModelOptions: ModelSelectOption[]
  servicePreviewModelOptions: ModelSelectOption[]
  onToggleRecommendedModel: (option: ModelSelectOption) => void | Promise<void>
  updatingRecommendedModelValue?: string
  selectedModel?: string
  modelForQuery?: string
  onModelChange: (model: string) => void
  effort: ChatEffort
  effortOptions: Array<{ value: ChatEffort; label: React.ReactNode }>
  onEffortChange: (effort: ChatEffort) => void
  permissionMode: PermissionMode
  permissionModeOptions: Array<{ value: PermissionMode; label: React.ReactNode }>
  onPermissionModeChange: (mode: PermissionMode) => void
  selectedAdapter?: string
  adapterOptions: ChatAdapterSelectOption[]
  hiddenBuiltinAdapterOptions: HiddenBuiltinAdapterOption[]
  onAdapterChange: (adapter: string) => void
  selectedAccount?: string
  accountOptions: ChatAdapterAccountOption[]
  showAccountSelector: boolean
  onAccountChange: (account: string) => void
  modelUnavailable: boolean
  hasAvailableModels: boolean
  agentRoomTranscript?: {
    room: AgentRoomViewModel
    members: AgentRoomMemberView[]
    workspaceSessionId?: string
    onOpenHostSession?: () => void
    onOpenRun?: (run: AgentRoomRunView) => void
    onReplyToRun?: (message: AgentRoomMessageView) => void
    onRespondInteraction?: (interactionId: string, data: string | string[]) => Promise<void> | void
    onSubmitMessage: (request: AgentRoomSenderSubmit) => Promise<void> | void
  }
  contextReferenceRequest?: ContextReferenceRequest | null
  hideHistoryTimeline?: boolean
  onOpenUrlInAppBrowser?: (url: string, title?: string) => void
  onOpenWorkspaceFile?: (path: string) => void
  workspaceRootPath?: string
  embeddedSessionChrome?: boolean
  navigateOnCreate?: boolean
  onSessionCreated?: (session: Session) => void
  workspaceSourceSessionId?: string
  senderAutoFocusKey?: string
}) {
  const { i18n, t } = useTranslation()
  const { message } = App.useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const { isCompactLayout } = useResponsiveLayout()
  const { data: configRes, mutate: mutateConfig } = useSWR<ConfigResponse>('/api/config', getConfig)
  const configWorkspaceDraft = useMemo(
    () => getChatSessionWorkspaceDraftFromConfig(configRes),
    [configRes]
  )
  const messageLinksConfig = useMemo(
    () => resolveMessageLinksConfig(configRes?.sources?.merged?.general?.messageLinks),
    [configRes?.sources?.merged?.general?.messageLinks]
  )
  const showVoiceInputInSender = configRes?.sources?.merged?.voice?.speechToText?.showInSender !== false
  const workspaceDraftDirtyRef = useRef(false)
  const pendingSessionCreationContext = useAtomValue(pendingSessionCreationContextAtom)
  const pendingSessionInitialContent = useAtomValue(pendingSessionInitialContentAtom)
  const setPendingSessionCreationContext = useSetAtom(pendingSessionCreationContextAtom)
  const setPendingSessionInitialContent = useSetAtom(pendingSessionInitialContentAtom)
  const [sessionTargetDraft, setSessionTargetDraft] = useState<ChatSessionTargetDraft>(() => ({
    ...DEFAULT_CHAT_SESSION_TARGET_DRAFT
  }))
  const [workspaceDraft, setWorkspaceDraft] = useState(() => ({
    ...DEFAULT_CHAT_SESSION_WORKSPACE_DRAFT
  }))
  const [newSessionInitialContent, setNewSessionInitialContent] = useState<ChatMessageContent[] | undefined>(undefined)
  const hasPersistedSession = hasPersistedSessionCreationTarget(session)
  const shouldApplyPendingSessionCreationContext = shouldUsePendingSessionCreationContext(session)
  const handleSessionCreated = useCallback((createdSession: Session) => {
    if (pendingSessionCreationContext != null) {
      setPendingSessionCreationContext(undefined)
    }
    onSessionCreated?.(createdSession)
  }, [onSessionCreated, pendingSessionCreationContext, setPendingSessionCreationContext])
  const handleOpenVoiceConfig = useCallback(() => {
    void navigate('/config/voice')
  }, [navigate])
  const handleShowVoiceInputInSender = useCallback(() => {
    void (async () => {
      try {
        const config = await getConfig()
        const currentVoice = config.sources?.user?.voice ?? {}
        await updateConfig('user', 'voice', {
          ...currentVoice,
          speechToText: {
            ...(currentVoice.speechToText ?? {}),
            showInSender: true
          }
        })
        await mutateConfig()
      } catch (error) {
        void message.error({
          content: getApiErrorMessage(error, t('chat.voiceInput.showInSenderFailed')),
          key: 'chat-voice-input-show-failed'
        })
      }
    })()
  }, [message, mutateConfig, t])
  const handleConnectMoreModelServices = useCallback(() => {
    try {
      const language = i18n.resolvedLanguage ?? i18n.language
      const request = {
        mode: 'create' as const,
        source: 'global' as const
      }
      const title = buildModelServiceConfigSessionTitle(request, { language })
      const initialContent = buildModelServiceConfigSessionInitialContent(request, {
        language,
        globalConfigPath: configRes?.meta?.sourceFiles?.global?.writableConfigPath,
        projectConfigPath: configRes?.meta?.sourceFiles?.project?.writableConfigPath,
        userConfigPath: configRes?.meta?.sourceFiles?.user?.writableConfigPath
      })
      setPendingSessionCreationContext({
        initialContent,
        tags: ['config', 'model-services'],
        title
      })
      navigate({
        pathname: '/',
        search: location.search
      })
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('config.actions.modelServiceSessionCreateFailed')))
    }
  }, [
    configRes?.meta?.sourceFiles?.global?.writableConfigPath,
    configRes?.meta?.sourceFiles?.project?.writableConfigPath,
    configRes?.meta?.sourceFiles?.user?.writableConfigPath,
    i18n.language,
    i18n.resolvedLanguage,
    location.search,
    message,
    navigate,
    setPendingSessionCreationContext,
    t
  ])
  const resolveModelServiceConfigSource = useCallback((serviceKey?: string): ConfigSource => {
    const normalizedServiceKey = serviceKey?.trim()
    if (normalizedServiceKey == null || normalizedServiceKey === '') return 'global'

    for (const source of modelServiceConfigSourcePriority) {
      const modelServices = configRes?.sources?.[source]?.modelServices
      if (modelServices != null && Object.hasOwn(modelServices, normalizedServiceKey)) {
        return source
      }
    }

    return 'global'
  }, [
    configRes?.sources?.global?.modelServices,
    configRes?.sources?.project?.modelServices,
    configRes?.sources?.user?.modelServices
  ])
  const handleOpenModelServicesConfig = useCallback((serviceKey?: string) => {
    const normalizedServiceKey = serviceKey?.trim()
    const params = new URLSearchParams(location.search)
    params.delete('tab')
    params.delete('detail')
    params.delete('section')
    params.set('source', resolveModelServiceConfigSource(normalizedServiceKey))
    navigate({
      pathname: normalizedServiceKey != null && normalizedServiceKey !== ''
        ? `/config/modelServices/${encodeURIComponent(normalizedServiceKey)}`
        : '/config/modelServices',
      search: `?${params.toString()}`
    })
  }, [location.search, navigate, resolveModelServiceConfigSource])
  useEffect(() => {
    if (!hasPersistedSession || pendingSessionCreationContext == null) return
    setPendingSessionCreationContext(undefined)
  }, [hasPersistedSession, pendingSessionCreationContext, setPendingSessionCreationContext])
  useEffect(() => {
    if (!shouldApplyPendingSessionCreationContext || pendingSessionInitialContent == null) return
    setNewSessionInitialContent(pendingSessionInitialContent)
    setPendingSessionInitialContent(undefined)
  }, [
    pendingSessionInitialContent,
    setPendingSessionInitialContent,
    shouldApplyPendingSessionCreationContext
  ])
  const {
    creationProgress,
    isCreating,
    isStopping,
    send,
    sendContent,
    retrySessionCreation,
    enqueueContent,
    removeQueuedContent,
    moveQueuedContent,
    reorderQueuedContent,
    editMessage,
    forkMessage,
    interrupt,
    clearMessages,
    recallMessage
  } = useChatSessionActions({
    canonicalSessionId,
    session,
    modelForQuery,
    hasAvailableModels,
    effort,
    permissionMode,
    adapter: selectedAdapter,
    account: selectedAccount,
    workspaceSourceSessionId,
    navigateOnCreate,
    collapseSenderHeaderOnCreate: true,
    onSessionCreated: handleSessionCreated,
    sessionTargetDraft,
    sessionCreationContext: shouldApplyPendingSessionCreationContext ? pendingSessionCreationContext : undefined,
    workspaceDraft,
    workspaceDraftDirty: workspaceDraftDirtyRef.current,
    workspaceConfigReady: configRes != null,
    onClearMessages
  })
  const isAgentRoomMode = agentRoomTranscript != null
  const agentRoomSenderSessionInfo = useMemo<SessionInfo | null>(() => {
    if (agentRoomTranscript == null) {
      return null
    }

    return {
      type: 'init',
      uuid: agentRoomTranscript.room.id,
      model: 'agent-room',
      version: 'agent-room',
      tools: [],
      slashCommands: [],
      cwd: '',
      agents: getAgentRoomMentionCompletions(agentRoomTranscript.members).map(item => item.value.slice(1)),
      title: agentRoomTranscript.room.title
    }
  }, [agentRoomTranscript])
  const showThinkingIndicator = isCreating || session?.status === 'running' || sessionActivityLabel != null
  const historyRenderCount = (
    isAgentRoomMode ? agentRoomTranscript.room.messages.length : messages.length
  ) +
    (isAgentRoomMode ? 0 : sessionCompactionEvents.length) +
    (isAgentRoomMode ? 0 : sessionWorkspaceChanges.length) +
    historyStatusNotices.length +
    creationProgress.length +
    historyCreationProgress.length +
    (showThinkingIndicator ? 1 : 0)
  const shouldRevealMessages = isReady || historyRenderCount > 0 ||
    (hasPersistedSession && session?.status !== 'running')
  const {
    hasScrollableContent,
    messagesEndRef,
    messagesContainerRef,
    messagesContentRef,
    scrollVersion,
    showScrollBottom,
    scrollToBottom
  } = useChatScroll({
    contentVersion: historyRenderCount
  })
  const initialScrollDoneRef = useRef(false)
  const handledHashAnchorIdRef = useRef('')
  const handledTargetScrollKeyRef = useRef('')
  const suppressTimelineScrollSpyUntilRef = useRef(0)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [collapsedTurnIds, setCollapsedTurnIds] = useState<Set<string>>(new Set())
  const [expandedTurnIds, setExpandedTurnIds] = useState<Set<string>>(new Set())
  const [queueMode, setQueueMode] = useState<SessionQueuedMessageMode>('steer')
  const [statusBarCollapsed, setStatusBarCollapsed] = useState(() => embeddedSessionChrome)
  const [queuedDraft, setQueuedDraft] = useState<{ content: ChatMessageContent[] } | null>(null)
  const [agentRoomSubmitLoading, setAgentRoomSubmitLoading] = useState(false)
  const [agentRoomComposerTarget, setAgentRoomComposerTarget] = useState<
    {
      requestId: string
      content: ChatMessageContent[]
    } | null
  >(null)
  const [activeInteractionOptionIndex, setActiveInteractionOptionIndex] = useState(0)
  const interactionOptions = interactionRequest?.payload.options ?? []
  const baseNewSessionGuide = useMemo(
    () => getNewSessionGuideData(configRes),
    [configRes]
  )
  const announcements = newSessionGuide?.announcements ?? baseNewSessionGuide.announcements
  const startupPresets = newSessionGuide?.startupPresets ?? baseNewSessionGuide.startupPresets
  const builtinActions = newSessionGuide?.builtinActions ?? baseNewSessionGuide.builtinActions
  const buildUserMessage = (content: string | ChatMessageContent[]): ChatMessage => {
    return {
      id: createLocalUserMessageId(),
      role: 'user' as const,
      content,
      createdAt: Date.now()
    }
  }
  const validateSessionTarget = () => {
    if (session?.id != null || isChatSessionTargetReady(sessionTargetDraft)) {
      return true
    }

    void message.warning(t('chat.sessionTarget.missingResourceWarning'))
    return false
  }

  const handleOpenWorkspaceFileInExternalOpener = useCallback(async (target: WorkspaceFileLinkTarget) => {
    try {
      const opener = messageLinksConfig.workspaceFileOpener
      if (session?.id != null && session.id !== '') {
        await openSessionWorkspaceFileInExternalOpener(session.id, target.path, {
          line: target.line,
          column: target.column,
          opener
        })
      } else {
        await openWorkspaceFileInExternalOpener(target.path, {
          line: target.line,
          column: target.column,
          opener
        })
      }
    } catch (error) {
      void message.error(getApiErrorMessage(error, t('chat.workspaceFileExternalOpenFailed')))
    }
  }, [message, messageLinksConfig.workspaceFileOpener, session?.id, t])

  const handleSendContent = async (content: ChatMessageContent[], mode?: SessionQueuedMessageMode) => {
    if (!validateSessionTarget()) {
      return false
    }

    const outgoingContent = !session?.id && newSessionGuide?.transformContent != null
      ? newSessionGuide.transformContent(content)
      : content
    const resolvedMode = mode ?? queueMode

    if (session?.id && session.status === 'running') {
      const didQueue = await enqueueContent(resolvedMode, outgoingContent)
      if (didQueue && queuedDraft != null) {
        setQueuedDraft(null)
        setQueueMode('steer')
      }
      return didQueue
    }

    if (!session?.id) {
      const didSend = await sendContent(outgoingContent, mode)
      if (didSend && queuedDraft != null) {
        setQueuedDraft(null)
        setQueueMode('steer')
      }
      return didSend
    }

    const didSend = await sendContent(outgoingContent, mode)
    if (didSend) {
      setMessages((prev) => [...prev, buildUserMessage(outgoingContent)])
      if (queuedDraft != null) {
        setQueuedDraft(null)
        setQueueMode('steer')
      }
    }
    return didSend
  }

  const handleSend = async (text: string, mode?: SessionQueuedMessageMode) => {
    if (!validateSessionTarget()) {
      return false
    }

    const resolvedMode = mode ?? queueMode
    const outgoingText = !session?.id && newSessionGuide?.transformText != null
      ? newSessionGuide.transformText(text)
      : text

    if (session?.id && session.status === 'running') {
      const didQueue = await enqueueContent(resolvedMode, [{ type: 'text', text: outgoingText.trim() }])
      if (didQueue && queuedDraft != null) {
        setQueuedDraft(null)
        setQueueMode('steer')
      }
      return didQueue
    }

    if (!session?.id) {
      const didSend = await send(outgoingText, mode)
      if (didSend && queuedDraft != null) {
        setQueuedDraft(null)
        setQueueMode('steer')
      }
      return didSend
    }

    const didSend = await send(outgoingText, mode)
    if (didSend) {
      setMessages((prev) => [...prev, buildUserMessage(outgoingText)])
      if (queuedDraft != null) {
        setQueuedDraft(null)
        setQueueMode('steer')
      }
    }
    return didSend
  }
  const handleSendAgentRoomText = async (text: string) => {
    if (agentRoomTranscript == null) {
      return false
    }

    const resolution = resolveRoomTarget(text, agentRoomTranscript.members)
    if (resolution.status === 'empty') {
      return false
    }
    if (resolution.status === 'missing') {
      void message.warning(t('agentRoom.composer.error.missingTarget', { target: resolution.mention }))
      return false
    }
    if (resolution.status === 'ambiguous') {
      void message.warning(t('agentRoom.composer.error.ambiguousTarget', { target: resolution.mention }))
      return false
    }
    if (resolution.status === 'empty-targeted-message') {
      void message.warning(t('agentRoom.composer.error.emptyTargetedMessage', { target: resolution.previewLabel }))
      return false
    }

    setAgentRoomSubmitLoading(true)
    try {
      await agentRoomTranscript.onSubmitMessage(createAgentRoomSenderSubmit(resolution))
      return true
    } catch (error) {
      console.error('Failed to send agent room message:', error)
      void message.error(t('common.operationFailed'))
      return false
    } finally {
      setAgentRoomSubmitLoading(false)
    }
  }
  const handleSendAgentRoomContent = async (content: ChatMessageContent[]) => {
    const unsupportedItems = content.filter(item => item.type !== 'text')
    if (unsupportedItems.length > 0) {
      void message.warning(t('agentRoom.composer.error.unsupportedAttachments'))
      return false
    }

    const text = content
      .filter((item): item is Extract<ChatMessageContent, { type: 'text' }> => item.type === 'text')
      .map(item => item.text)
      .join('\n')
      .trim()

    return handleSendAgentRoomText(text)
  }
  const handleSelectAgentRoomMemberTarget = (member: AgentRoomMemberView) => {
    const mention = getAgentRoomMemberMention(member)
    setAgentRoomComposerTarget({
      requestId: `${member.memberKey}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
      content: [{ type: 'text', text: `${mention} ` }]
    })
  }
  const handleSelectAgentRoomHostTarget = () => {
    setAgentRoomComposerTarget({
      requestId: `host:${Date.now()}:${Math.random().toString(16).slice(2)}`,
      content: []
    })
  }
  useEffect(() => {
    initialScrollDoneRef.current = false
    handledHashAnchorIdRef.current = ''
    handledTargetScrollKeyRef.current = ''
    setEditingMessageId(null)
    setCollapsedTurnIds(new Set())
    setExpandedTurnIds(new Set())
    setQueuedDraft(null)
    setQueueMode('steer')
    setAgentRoomSubmitLoading(false)
    setAgentRoomComposerTarget(null)
    setNewSessionInitialContent(undefined)
    setSessionTargetDraft(
      session?.id != null
        ? getChatSessionTargetDraftFromSession(session)
        : { ...DEFAULT_CHAT_SESSION_TARGET_DRAFT }
    )
  }, [agentRoomTranscript?.room.id, session?.id, session?.promptName, session?.promptType])
  useEffect(() => {
    if (session?.id != null) {
      return
    }
    setNewSessionInitialContent(pendingSessionCreationContext?.initialContent)
  }, [pendingSessionCreationContext?.initialContent, session?.id])
  useEffect(() => {
    if (session?.id != null) {
      return
    }

    workspaceDraftDirtyRef.current = false
    setWorkspaceDraft({
      ...configWorkspaceDraft
    })
  }, [session?.id])
  useEffect(() => {
    if (session?.id != null) {
      return
    }

    if (workspaceDraftDirtyRef.current) {
      return
    }

    setWorkspaceDraft({
      ...configWorkspaceDraft
    })
  }, [configWorkspaceDraft, session?.id])
  useEffect(() => {
    setActiveInteractionOptionIndex(0)
  }, [interactionRequest?.id])
  useEffect(() => {
    if (interactionOptions.length === 0) {
      setActiveInteractionOptionIndex(0)
      return
    }

    setActiveInteractionOptionIndex((current) => Math.min(current, interactionOptions.length - 1))
  }, [interactionOptions.length])

  const handleMoveInteractionOption = useCallback((delta: number) => {
    if (interactionOptions.length === 0) {
      return
    }

    setActiveInteractionOptionIndex((current) => getLoopedIndex(current, delta, interactionOptions.length))
  }, [interactionOptions.length])

  const handleSubmitActiveInteractionOption = useCallback(() => {
    if (interactionRequest == null) {
      return
    }

    const option = interactionOptions[activeInteractionOptionIndex] ?? interactionOptions[0]
    if (option == null) {
      return
    }

    onInteractionResponse(interactionRequest.id, option.value ?? option.label)
  }, [activeInteractionOptionIndex, interactionOptions, interactionRequest, onInteractionResponse])

  useEffect(() => {
    if (!initialScrollDoneRef.current && isReady && location.hash === '') {
      scrollToBottom('auto')
      initialScrollDoneRef.current = true
    }
  }, [historyRenderCount, isReady, location.hash, scrollToBottom])
  useEffect(() => {
    if (location.hash === '' && !showScrollBottom) {
      scrollToBottom('auto')
    }
  }, [historyRenderCount, location.hash, scrollToBottom, showScrollBottom])
  const handleStartEditing = (messageId: string) => {
    let isBlocked = false

    setEditingMessageId((current) => {
      if (current != null && current !== messageId) {
        isBlocked = true
        return current
      }

      return messageId
    })

    if (isBlocked) {
      void message.warning(t('chat.messageActions.editInProgress'))
    }
  }
  const isInlineEditing = editingMessageId != null
  const shouldShowNewSessionGuide = !embeddedSessionChrome &&
    !isAgentRoomMode &&
    !session?.id &&
    messages.length === 0 &&
    sessionCompactionEvents.length === 0 &&
    sessionWorkspaceChanges.length === 0 &&
    historyStatusNotices.length === 0
  const handleApplyConversationStarter = useCallback((starter: ConversationStarterConfig) => {
    if (session?.id != null) {
      return
    }

    if (starter.mode != null) {
      setSessionTargetDraft(buildConversationStarterTargetDraft(starter))
    }

    const workspacePatch = buildConversationStarterWorkspacePatch(starter)
    if (workspacePatch != null) {
      workspaceDraftDirtyRef.current = true
      setWorkspaceDraft(current => ({
        ...current,
        ...workspacePatch
      }))
    }

    const model = starter.model?.trim()
    if (model != null && model !== '') {
      onModelChange(model)
    }

    const adapter = starter.adapter?.trim()
    if (adapter != null && adapter !== '') {
      onAdapterChange(adapter)
    }

    const account = starter.account?.trim()
    if (account != null && account !== '') {
      onAccountChange(account)
    }

    if (starter.effort != null) {
      onEffortChange(starter.effort)
    }

    if (starter.permissionMode != null) {
      onPermissionModeChange(starter.permissionMode)
    }

    setNewSessionInitialContent(buildConversationStarterInitialContent(starter))
  }, [
    onAccountChange,
    onAdapterChange,
    onEffortChange,
    onModelChange,
    onPermissionModeChange,
    session?.id
  ])
  const renderItems = useMemo(() => {
    if (isAgentRoomMode) {
      return []
    }

    const baseItems = processMessages(messages)
    if (sessionCompactionEvents.length === 0 && sessionWorkspaceChanges.length === 0) {
      return baseItems
    }

    const compactionItems: ChatRenderItem[] = sessionCompactionEvents.map((info) => {
      const status = resolveSessionCompactionStatus(info, session?.status)
      const resolvedInfo = status === info.status ? info : { ...info, status }
      const notice = createSessionCompactionNotice(t, resolvedInfo)
      const originalMessage: ChatMessage = {
        id: `context-compaction:${info.id}`,
        role: 'system',
        content: '',
        createdAt: info.createdAt
      }

      return {
        anchorId: getCompactionNoticeAnchorId(info.id),
        originalMessage,
        notice,
        type: 'status-notice' as const
      }
    })
    const workspaceChangeItems: ChatRenderItem[] = sessionWorkspaceChanges.map((changes) => {
      const originalMessage: ChatMessage = {
        id: `workspace-changes:${changes.id}`,
        role: 'system',
        content: '',
        createdAt: changes.createdAt
      }

      return {
        anchorId: getWorkspaceChangesAnchorId(changes.id),
        originalMessage,
        changes,
        type: 'workspace-changes' as const
      }
    })

    const getTieRank = (item: ChatRenderItem) => {
      if (item.type === 'message' && item.originalMessage.role === 'user') {
        return 0
      }
      if (item.type === 'status-notice') {
        return 1
      }
      if (item.type === 'workspace-changes') {
        return 3
      }
      return 2
    }

    return [...baseItems, ...compactionItems, ...workspaceChangeItems]
      .map((item, index) => ({ item, index }))
      .sort((left, right) => {
        const timestampDelta = left.item.originalMessage.createdAt - right.item.originalMessage.createdAt
        if (timestampDelta !== 0) {
          return timestampDelta
        }

        const rankDelta = getTieRank(left.item) - getTieRank(right.item)
        return rankDelta !== 0 ? rankDelta : left.index - right.index
      })
      .map(entry => entry.item)
  }, [isAgentRoomMode, messages, session?.status, sessionCompactionEvents, sessionWorkspaceChanges, t])
  const messageBranchNavigationMap = useMemo(() =>
    buildMessageBranchNavigationMap({
      currentSession: session,
      messages,
      sessions
    }), [messages, session, sessions])
  const handleSwitchBranchSession = useCallback((sessionId: string) => {
    const rootSessionId = canonicalSessionId ?? session?.id
    if (rootSessionId == null || rootSessionId === '') {
      return
    }

    void navigate({
      pathname: `/session/${rootSessionId}`,
      search: buildMessageBranchSearch({
        currentSearch: location.search,
        rootSessionId,
        targetSessionId: sessionId
      })
    })
  }, [canonicalSessionId, location.search, navigate, session?.id])
  const hashAnchorId = useMemo(() => decodeURIComponent(location.hash.replace(/^#/, '')), [location.hash])
  const targetAnchorId = useMemo(() => {
    if (targetToolUseId != null && targetToolUseId !== '') {
      const targetToolGroup = renderItems.find((item) => {
        return item.type === 'tool-group' && item.items.some(toolItem => toolItem.item.id === targetToolUseId)
      })
      return targetToolGroup?.anchorId ?? ''
    }

    if (targetMessageId != null && targetMessageId !== '') {
      const targetMessage = renderItems.find((item) => {
        return item.type === 'message' && item.originalMessage.id === targetMessageId
      })
      return targetMessage?.anchorId ?? ''
    }

    return ''
  }, [renderItems, targetMessageId, targetToolUseId])
  const messageTurns = useMemo(() =>
    buildMessageTurns({
      renderItems,
      collapsedTurnIds,
      expandedTurnIds,
      hashAnchorId: hashAnchorId !== '' ? hashAnchorId : targetAnchorId,
      keepLastTurnExpanded: isCreating || session?.status === 'running' || session?.status === 'waiting_input'
    }), [collapsedTurnIds, expandedTurnIds, hashAnchorId, isCreating, renderItems, session?.status, targetAnchorId])
  const historyTimelineCurrentStatus = useMemo(() =>
    buildChatHistoryTimelineCurrentStatus({
      interactionKind: interactionRequest?.payload.kind,
      labels: {
        failed: t('chat.timeline.failed'),
        permission: t('chat.timeline.permissionRequest'),
        running: t('chat.timeline.running'),
        terminated: t('chat.timeline.terminated'),
        waiting: t('chat.timeline.waitingInput')
      },
      sessionStatus: isCreating ? 'running' : session?.status
    }), [interactionRequest?.payload.kind, isCreating, session?.status, t])
  const historyTimeline = useMemo(() =>
    buildChatHistoryTimelineFromMessageTurns({
      currentStatus: historyTimelineCurrentStatus,
      getForkCount: messageId => messageBranchNavigationMap.get(messageId)?.total,
      turns: messageTurns
    }), [historyTimelineCurrentStatus, messageBranchNavigationMap, messageTurns])
  const historyTimelineController = useChatHistoryTimelineController({
    initialNodeId: historyTimeline.initialNodeId,
    nodes: historyTimeline.nodes
  })
  const {
    activeNodeIds: historyTimelineActiveNodeIds,
    activePathNodes: historyTimelineActivePathNodes,
    graphExpanded: historyTimelineGraphExpanded,
    scrollSpyNodeIds: historyTimelineScrollSpyNodeIds,
    selectedNodeId: historyTimelineSelectedNodeId,
    selectTimelineNode: selectHistoryTimelineNode,
    setActiveNodeFromScroll: setActiveHistoryTimelineNodeFromScroll,
    setGraphExpanded: setHistoryTimelineGraphExpanded
  } = historyTimelineController
  const isSessionBusy = isCreating || session?.status === 'running' || session?.status === 'waiting_input'
  const handleEditQueuedMessage = async (item: SessionQueuedMessage) => {
    const removed = await removeQueuedContent(item.id)
    if (!removed) {
      return
    }
    setQueuedDraft({ content: item.content })
    setQueueMode('steer')
  }
  const handleMoveQueuedMessage = async (item: SessionQueuedMessage, targetMode: SessionQueuedMessageMode) => {
    await moveQueuedContent(item.id, targetMode)
  }
  const isPermissionInteraction = !isAgentRoomMode && interactionRequest?.payload.kind === 'permission'
  const interactionPanel = !isAgentRoomMode && !isInlineEditing && interactionRequest != null
    ? (
      <SenderInteractionPanel
        interactionRequest={interactionRequest}
        activeOptionIndex={activeInteractionOptionIndex}
        permissionContext={interactionRequest.payload.kind === 'permission'
          ? interactionRequest.payload.permissionContext
          : undefined}
        deniedTools={interactionRequest.payload.kind === 'permission'
          ? (interactionRequest.payload.permissionContext?.deniedTools ?? [])
          : []}
        reasons={interactionRequest.payload.kind === 'permission'
          ? (interactionRequest.payload.permissionContext?.reasons ?? [])
          : []}
        onActiveOptionIndexChange={setActiveInteractionOptionIndex}
        onMoveActiveOption={handleMoveInteractionOption}
        onInteractionResponse={onInteractionResponse}
      />
    )
    : null
  const senderSessionId = isAgentRoomMode ? agentRoomTranscript.workspaceSessionId : session?.id
  const senderAdapterLocked = senderSessionId != null && senderSessionId !== ''
  const senderSessionStatus = isAgentRoomMode ? undefined : isCreating ? 'running' : session?.status
  const senderIsThinking = !isAgentRoomMode && (isCreating || session?.status === 'running')
  const senderInitialContent = isAgentRoomMode
    ? agentRoomComposerTarget?.content
    : queuedDraft?.content ?? newSessionInitialContent
  const senderSubmitLabel = !isAgentRoomMode && queuedDraft != null ? t('chat.queue.requeueMessage') : undefined
  const senderPlaceholder = isAgentRoomMode
    ? t('agentRoom.composer.placeholder')
    : embeddedSessionChrome
    ? t('chat.childSessionPlaceholder')
    : newSessionGuide?.placeholder ?? placeholder
  const senderSessionInfo = isAgentRoomMode ? agentRoomSenderSessionInfo : sessionInfo
  const shouldShowMessages = shouldRevealMessages || isAgentRoomMode || messageTurns.length > 0
  const showHistoryTimeline = !embeddedSessionChrome &&
    !isAgentRoomMode &&
    !isCompactLayout &&
    !hideHistoryTimeline &&
    hasScrollableContent &&
    shouldShowMessages &&
    historyTimeline.nodes.length >= 2

  const scrollHistoryTimelineNodeIntoView = useCallback((nodeId: string, behavior: ScrollBehavior = 'smooth') => {
    const anchorId = historyTimeline.anchorIdByNodeId.get(nodeId)
    const contentElement = messagesContentRef.current
    const targetElement = anchorId == null ? null : document.getElementById(anchorId)

    if (contentElement == null || targetElement == null || !contentElement.contains(targetElement)) {
      return
    }

    targetElement.scrollIntoView({ block: 'center', behavior })
  }, [historyTimeline.anchorIdByNodeId, messagesContentRef])

  const syncHistoryTimelineFromScroll = useCallback(() => {
    if (!showHistoryTimeline) return
    if (window.performance.now() < suppressTimelineScrollSpyUntilRef.current) return

    const containerElement = messagesContainerRef.current
    const contentElement = messagesContentRef.current

    if (containerElement == null || contentElement == null) return

    const containerRect = containerElement.getBoundingClientRect()
    const distanceToBottom = containerElement.scrollHeight -
      (containerElement.scrollTop + containerElement.clientHeight)
    const viewportAnchor = containerRect.top + Math.min(containerRect.height * 0.16, 120)
    let closestNodeId: string | null = null
    let closestDistance = Number.POSITIVE_INFINITY

    if (distanceToBottom <= 2) {
      const lastScrollSpyNode = [...historyTimeline.nodes]
        .reverse()
        .find(node => historyTimelineScrollSpyNodeIds.has(node.id))
      closestNodeId = lastScrollSpyNode?.id ?? null
    }

    if (closestNodeId == null) {
      for (const node of historyTimeline.nodes) {
        if (!historyTimelineScrollSpyNodeIds.has(node.id)) continue

        const anchorId = historyTimeline.anchorIdByNodeId.get(node.id)
        const element = anchorId == null ? null : document.getElementById(anchorId)

        if (element == null || !contentElement.contains(element)) continue

        const rect = element.getBoundingClientRect()
        const center = rect.top + rect.height / 2
        const distance = Math.abs(center - viewportAnchor)

        if (distance < closestDistance) {
          closestDistance = distance
          closestNodeId = node.id
        }
      }
    }

    if (closestNodeId != null && closestNodeId !== historyTimelineSelectedNodeId) {
      setActiveHistoryTimelineNodeFromScroll(closestNodeId)
    }
  }, [
    historyTimeline.anchorIdByNodeId,
    historyTimeline.nodes,
    historyTimelineScrollSpyNodeIds,
    historyTimelineSelectedNodeId,
    messagesContainerRef,
    messagesContentRef,
    setActiveHistoryTimelineNodeFromScroll,
    showHistoryTimeline
  ])

  const handleSelectHistoryTimelineNode = useCallback<ChatHistoryTimelineSelectHandler>((nodeId, detail) => {
    suppressTimelineScrollSpyUntilRef.current = window.performance.now() + 650
    selectHistoryTimelineNode(nodeId, detail)
    scrollHistoryTimelineNodeIntoView(nodeId)
  }, [scrollHistoryTimelineNodeIntoView, selectHistoryTimelineNode])

  useEffect(() => {
    const hash = hashAnchorId
    if (hash === '') {
      handledHashAnchorIdRef.current = ''
      return
    }

    if (!isReady || handledHashAnchorIdRef.current === hash) return

    let removeHighlightTimer: ReturnType<typeof setTimeout> | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let frameId: number | null = null

    const scrollToAnchor = () => {
      const target = document.getElementById(hash)
      if (target == null) {
        return false
      }

      handledHashAnchorIdRef.current = hash
      target.scrollIntoView({ block: 'center', behavior: 'auto' })
      target.classList.add('is-anchor-target')
      removeHighlightTimer = setTimeout(() => {
        target.classList.remove('is-anchor-target')
      }, 1800)
      return true
    }

    if (!scrollToAnchor()) {
      frameId = requestAnimationFrame(() => {
        if (!scrollToAnchor()) {
          retryTimer = setTimeout(() => {
            void scrollToAnchor()
          }, 120)
        }
      })
    }

    return () => {
      if (frameId != null) {
        cancelAnimationFrame(frameId)
      }
      if (retryTimer != null) {
        clearTimeout(retryTimer)
      }
      if (removeHighlightTimer != null) {
        clearTimeout(removeHighlightTimer)
      }
    }
  }, [hashAnchorId, historyRenderCount, isReady, messageTurns])

  useEffect(() => {
    const targetAttr = targetToolUseId != null && targetToolUseId !== ''
      ? { key: 'data-tool-use-id', value: targetToolUseId, targetKey: `tool:${targetToolUseId}` }
      : targetMessageId != null && targetMessageId !== ''
      ? { key: 'data-message-id', value: targetMessageId, targetKey: `message:${targetMessageId}` }
      : undefined
    if (targetAttr == null) {
      handledTargetScrollKeyRef.current = ''
      return
    }

    if (handledTargetScrollKeyRef.current === targetAttr.targetKey) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      const container = messagesContentRef.current
      if (container == null) {
        return
      }

      const target = Array.from(container.querySelectorAll<HTMLElement>(`[${targetAttr.key}]`))
        .find(element => element.getAttribute(targetAttr.key) === targetAttr.value)
      if (target == null) {
        return
      }

      handledTargetScrollKeyRef.current = targetAttr.targetKey
      target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [historyRenderCount, messageTurns, messagesContentRef, targetMessageId, targetToolUseId])

  useEffect(() => {
    if (!showHistoryTimeline) return

    const frame = window.requestAnimationFrame(() => {
      syncHistoryTimelineFromScroll()
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [historyRenderCount, scrollVersion, showHistoryTimeline, syncHistoryTimelineFromScroll])

  const toggleTurnCollapsed = (turnId: string, isCollapsed: boolean) => {
    setCollapsedTurnIds((prev) => {
      const next = new Set(prev)
      if (isCollapsed) {
        next.delete(turnId)
      } else {
        next.add(turnId)
      }
      return next
    })

    setExpandedTurnIds((prev) => {
      const next = new Set(prev)
      if (isCollapsed) {
        next.add(turnId)
      } else {
        next.delete(turnId)
      }
      return next
    })
  }

  const formatTurnDuration = (durationMs: number | null) => {
    if (durationMs == null) return null
    const totalSeconds = Math.floor(durationMs / 1000)
    if (totalSeconds <= 0) {
      return t('chat.turnDurationUnderSecond')
    }

    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    if (hours > 0) {
      return [
        t('chat.turnDurationHours', { count: hours }),
        minutes > 0 ? t('chat.turnDurationMinutes', { count: minutes }) : null
      ].filter(Boolean).join(' ')
    }

    if (minutes > 0) {
      return [
        t('chat.turnDurationMinutes', { count: minutes }),
        seconds > 0 ? t('chat.turnDurationSeconds', { count: seconds }) : null
      ].filter(Boolean).join(' ')
    }

    return t('chat.turnDurationSeconds', { count: seconds })
  }

  const renderTurnSummary = (turn: (typeof messageTurns)[number]) => (
    <div className={`chat-turn-summary ${turn.isCollapsed ? 'is-collapsed' : 'is-expanded'}`}>
      <div className='chat-turn-summary__content'>
        <div className='chat-turn-summary__meta'>
          {formatTurnDuration(turn.durationMs) != null && (
            <span className='chat-turn-summary__time'>
              {t('chat.turnProcessedDuration', { duration: formatTurnDuration(turn.durationMs) })}
            </span>
          )}
          <span className='chat-turn-summary__count'>
            {t('chat.turnSummaryCount', { count: turn.hiddenCount })}
          </span>
        </div>
        <button
          type='button'
          className='chat-turn-summary__toggle'
          aria-expanded={!turn.isCollapsed}
          onClick={() => toggleTurnCollapsed(turn.id, turn.isCollapsed)}
        >
          <span className='material-symbols-rounded'>
            chevron_right
          </span>
        </button>
      </div>
    </div>
  )

  const renderTurnItem = (item: (typeof renderItems)[number], key?: string) => {
    if (item.type === 'agent-room-child-request') {
      return (
        <div
          key={key ?? item.anchorId}
          id={item.anchorId}
          className={[
            'chat-message-assistant',
            'chat-message-agent-room-child-request',
            item.originalMessage.id === targetMessageId ? 'is-targeted' : ''
          ].filter(Boolean).join(' ')}
          data-message-id={item.originalMessage.id}
        >
          <div className='message-body-container'>
            <div className='bubble'>
              <AgentRoomChildRequestCard request={item.request} />
            </div>
          </div>
        </div>
      )
    }

    if (item.type === 'message') {
      return (
        <MessageItem
          key={key ?? item.anchorId}
          anchorId={item.anchorId}
          msg={item.message}
          isFirstInGroup={item.isFirstInGroup}
          isTargeted={item.originalMessage.id === targetMessageId}
          originalMessage={item.originalMessage}
          isAgentRoomSession={isAgentRoomSession}
          agentRoomSourceMembers={agentRoomSourceMembers}
          session={session}
          sessionInfo={sessionInfo}
          isEditing={editingMessageId === item.originalMessage.id}
          isSessionBusy={isSessionBusy}
          messageLinksConfig={messageLinksConfig}
          onEditMessage={editMessage}
          onForkMessage={forkMessage}
          onRecallMessage={recallMessage}
          onOpenUrlInAppBrowser={onOpenUrlInAppBrowser}
          onOpenWorkspaceFile={onOpenWorkspaceFile}
          onOpenWorkspaceFileInExternalOpener={handleOpenWorkspaceFileInExternalOpener}
          workspaceRootPath={workspaceRootPath}
          branchNavigation={messageBranchNavigationMap.get(item.originalMessage.id)}
          onSwitchBranchSession={handleSwitchBranchSession}
          onStartEditing={handleStartEditing}
          onCancelEditing={(messageId) => {
            setEditingMessageId((current) => current === messageId ? null : current)
          }}
          sessionId={session?.id}
        />
      )
    }

    if (item.type === 'status-notice') {
      return (
        <div
          key={key ?? item.anchorId}
          id={item.anchorId}
          className='chat-context-compaction-divider'
          role='status'
          aria-live='polite'
        >
          <span
            className='chat-context-compaction-divider__icon material-symbols-rounded'
            aria-hidden='true'
          >
            {item.notice.icon}
          </span>
          <span className='chat-context-compaction-divider__text'>{item.notice.title}</span>
        </div>
      )
    }

    if (item.type === 'workspace-changes') {
      return (
        <div
          key={key ?? item.anchorId}
          id={item.anchorId}
          className='chat-message-assistant chat-message-workspace-changes'
        >
          <div className='message-body-container'>
            <div className='bubble'>
              <SessionWorkspaceChangesCard changes={item.changes} />
            </div>
          </div>
        </div>
      )
    }

    return (
      <ToolGroup
        key={key ?? item.id}
        anchorId={item.anchorId}
        items={item.items}
        originalMessage={item.originalMessage}
        sessionId={session?.id}
        targetToolUseId={targetToolUseId}
        footer={item.footer}
      />
    )
  }

  // Embedded session chrome only removes the route shell around child sessions.
  // The composer surface must stay shared with primary chat so Sender props do
  // not drift; default-collapsed status chrome is the intentional child-session
  // exception.
  const useChatSenderSurface = !isAgentRoomMode
  useEffect(() => {
    if (!useChatSenderSurface && statusBarCollapsed) {
      setStatusBarCollapsed(false)
    }
  }, [statusBarCollapsed, useChatSenderSurface])
  const handleDraftWorkspaceChange = (nextDraft: ChatSessionWorkspaceDraft) => {
    workspaceDraftDirtyRef.current = true
    setWorkspaceDraft(nextDraft)
  }
  const statusBarGitControlsInMore = useChatSenderSurface && statusBarCollapsed
    ? senderSessionId != null && senderSessionId !== ''
      ? {
        type: 'session' as const,
        sessionId: senderSessionId
      }
      : {
        type: 'draft' as const,
        disabled: !isAgentRoomMode && isCreating,
        draftWorkspace: workspaceDraft,
        onDraftWorkspaceChange: handleDraftWorkspaceChange
      }
    : undefined

  const composerContent = (
    <>
      {isPermissionInteraction && interactionPanel}
      <CurrentTodoList messages={isAgentRoomMode ? [] : messages} />
      {!isInlineEditing && (
        <QueuedMessagesCard
          mode='next'
          items={isAgentRoomMode ? [] : queuedMessages.next}
          onMove={(item, targetMode) => void handleMoveQueuedMessage(item, targetMode)}
          onDelete={(item) => void removeQueuedContent(item.id)}
          onEdit={(item) => void handleEditQueuedMessage(item)}
          onReorder={(ids) => reorderQueuedContent('next', ids)}
        />
      )}
      {!isInlineEditing && (
        <QueuedMessagesCard
          mode='steer'
          items={isAgentRoomMode ? [] : queuedMessages.steer}
          onMove={(item, targetMode) => void handleMoveQueuedMessage(item, targetMode)}
          onDelete={(item) => void removeQueuedContent(item.id)}
          onEdit={(item) => void handleEditQueuedMessage(item)}
          onReorder={(ids) => reorderQueuedContent('steer', ids)}
        />
      )}
      {!isPermissionInteraction && interactionPanel}
      {!isInlineEditing && (
        <div
          className={[
            'sender-container',
            useChatSenderSurface ? 'sender-container--chat-surface' : ''
          ].filter(Boolean).join(' ')}
        >
          <Sender
            key={isAgentRoomMode ? agentRoomComposerTarget?.requestId ?? agentRoomTranscript.room.id : undefined}
            onSend={isAgentRoomMode ? handleSendAgentRoomText : handleSend}
            onSendContent={isAgentRoomMode ? handleSendAgentRoomContent : handleSendContent}
            adapterLocked={senderAdapterLocked}
            sessionId={senderSessionId}
            sessionStatus={senderSessionStatus}
            onInterrupt={isAgentRoomMode ? () => undefined : interrupt}
            stopLoading={isStopping}
            onClear={isAgentRoomMode ? undefined : clearMessages}
            sessionInfo={senderSessionInfo}
            interactionRequest={isAgentRoomMode ? null : interactionRequest}
            onInteractionResponse={isAgentRoomMode ? undefined : onInteractionResponse}
            interactionOptionNavigation={!isAgentRoomMode && interactionRequest != null && interactionOptions.length > 0
              ? {
                optionCount: interactionOptions.length,
                activeIndex: activeInteractionOptionIndex,
                onMove: handleMoveInteractionOption,
                onSubmit: handleSubmitActiveInteractionOption
              }
              : undefined}
            initialContent={senderInitialContent}
            autoFocus={(isAgentRoomMode && agentRoomComposerTarget != null) || senderAutoFocusKey != null}
            autoFocusKey={senderAutoFocusKey}
            placeholder={senderPlaceholder}
            submitLabel={senderSubmitLabel}
            submitLoading={isAgentRoomMode ? agentRoomSubmitLoading : undefined}
            modelMenuGroups={modelMenuGroups}
            builtinPreviewModelOptions={builtinPreviewModelOptions}
            modelSearchOptions={modelSearchOptions}
            recommendedModelOptions={recommendedModelOptions}
            servicePreviewModelOptions={servicePreviewModelOptions}
            onToggleRecommendedModel={onToggleRecommendedModel}
            updatingRecommendedModelValue={updatingRecommendedModelValue}
            onConnectMoreModelServices={handleConnectMoreModelServices}
            onOpenModelServicesConfig={handleOpenModelServicesConfig}
            selectedModel={selectedModel}
            onModelChange={onModelChange}
            effort={effort}
            effortOptions={effortOptions}
            onEffortChange={onEffortChange}
            permissionMode={permissionMode}
            permissionModeOptions={permissionModeOptions}
            onPermissionModeChange={onPermissionModeChange}
            selectedAdapter={selectedAdapter}
            adapterOptions={adapterOptions}
            hiddenBuiltinAdapterOptions={hiddenBuiltinAdapterOptions}
            onAdapterChange={onAdapterChange}
            selectedAccount={selectedAccount}
            accountOptions={accountOptions}
            showAccountSelector={showAccountSelector}
            onAccountChange={onAccountChange}
            showStatusBarControlsInMore={useChatSenderSurface && statusBarCollapsed}
            statusBarGitControlsInMore={statusBarGitControlsInMore}
            modelUnavailable={modelUnavailable}
            sessionTarget={isAgentRoomMode
              ? undefined
              : {
                draft: session?.id != null ? getChatSessionTargetDraftFromSession(session) : sessionTargetDraft,
                locked: session?.id != null,
                disabled: isCreating,
                onChange: setSessionTargetDraft
              }}
            agentRoomTargetMembers={isAgentRoomMode ? agentRoomTranscript.members : undefined}
            queueMode={isAgentRoomMode ? undefined : queueMode}
            onQueueModeChange={isAgentRoomMode ? undefined : setQueueMode}
            contextReferenceRequest={contextReferenceRequest}
            enableVoiceInput={showVoiceInputInSender}
            hiddenVoiceInputActions={!showVoiceInputInSender
              ? {
                onConfigure: handleOpenVoiceConfig,
                onShow: handleShowVoiceInputInSender
              }
              : undefined}
          />
          <ChatStatusBar
            draftWorkspace={workspaceDraft}
            isCreating={!isAgentRoomMode && isCreating}
            sessionId={senderSessionId}
            adapterLocked={senderAdapterLocked}
            isThinking={senderIsThinking}
            modelUnavailable={modelUnavailable}
            selectedAdapter={selectedAdapter}
            adapterOptions={adapterOptions}
            hiddenBuiltinAdapterOptions={hiddenBuiltinAdapterOptions}
            onAdapterChange={onAdapterChange}
            selectedAccount={selectedAccount}
            accountOptions={accountOptions}
            showAccountSelector={showAccountSelector}
            collapsible={useChatSenderSurface}
            collapsed={statusBarCollapsed}
            onCollapsedChange={setStatusBarCollapsed}
            onAccountChange={onAccountChange}
            onDraftWorkspaceChange={handleDraftWorkspaceChange}
          />
        </div>
      )}
    </>
  )

  return (
    <>
      <div
        className={[
          'chat-history-view__messages-frame',
          showHistoryTimeline ? 'has-history-timeline' : ''
        ].filter(Boolean).join(' ')}
      >
        <div
          className={`chat-messages ${shouldShowMessages ? 'ready' : ''}`}
          ref={messagesContainerRef}
        >
          <div className='chat-messages-content' ref={messagesContentRef}>
            {!session?.id && isCreating && (
              <SessionCreationProgressBanner progress={creationProgress} />
            )}
            {session?.id != null && historyCreationProgress.length > 0 && (
              <SessionCreationProgressBanner progress={historyCreationProgress} collapseWhenComplete />
            )}
            {isAgentRoomMode
              ? (
                <AgentRoomTranscript
                  room={agentRoomTranscript.room}
                  onOpenHostSession={agentRoomTranscript.onOpenHostSession}
                  onOpenRun={agentRoomTranscript.onOpenRun}
                  onReplyToRun={agentRoomTranscript.onReplyToRun}
                  onRespondInteraction={agentRoomTranscript.onRespondInteraction}
                  onSelectHostTarget={handleSelectAgentRoomHostTarget}
                  onSelectMemberTarget={handleSelectAgentRoomMemberTarget}
                />
              )
              : messageTurns.map((turn) => (
                turn.isExpandable
                  ? (
                    <div key={turn.id} className={`chat-turn ${turn.isCollapsed ? 'is-collapsed' : 'is-expanded'}`}>
                      {renderTurnItem(turn.items[0]!, `${turn.id}:leading`)}
                      <div className={`chat-turn__summary-region ${turn.isCollapsed ? 'is-collapsed' : 'is-expanded'}`}>
                        {renderTurnSummary(turn)}
                        <div
                          className={`chat-turn__collapsible ${turn.isCollapsed ? 'is-collapsed' : 'is-expanded'}`}
                          aria-hidden={turn.isCollapsed}
                        >
                          <div className='chat-turn__collapsible-inner'>
                            {turn.items.slice(1, -1).map((item) => renderTurnItem(item))}
                          </div>
                        </div>
                      </div>
                      {renderTurnItem(turn.items[turn.items.length - 1]!, `${turn.id}:trailing`)}
                    </div>
                  )
                  : (
                    <React.Fragment key={turn.id}>
                      {turn.items.map((item) => renderTurnItem(item))}
                    </React.Fragment>
                  )
              ))}
            {historyStatusNotices.map(notice => (
              <MessageStatusNotice
                key={notice.id}
                notice={notice}
                onRetryConnection={onRetryConnection}
                onRetrySessionCreation={() => {
                  void retrySessionCreation()
                }}
              />
            ))}
            {showThinkingIndicator && (
              <div className='chat-thinking-indicator' role='status' aria-live='polite'>
                <span className='chat-thinking-indicator__text'>{sessionActivityLabel ?? t('chat.thinking')}</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {showScrollBottom && !showHistoryTimeline && (
            <div className='scroll-bottom-btn' onClick={() => scrollToBottom()}>
              <span className='material-symbols-rounded'>arrow_downward</span>
            </div>
          )}
        </div>

        {showHistoryTimeline && (
          <ChatHistoryTimelineView
            className='chat-history-view__timeline'
            graphExpanded={historyTimelineGraphExpanded}
            graphToggleLabels={{
              collapse: t('chat.timeline.collapseGraph'),
              expand: t('chat.timeline.expandGraph')
            }}
            nodes={historyTimeline.nodes}
            activeNodeIds={historyTimelineActiveNodeIds}
            pathNodes={historyTimelineActivePathNodes}
            selectedNodeId={historyTimelineSelectedNodeId}
            onGraphExpandedChange={setHistoryTimelineGraphExpanded}
            onSelectNode={handleSelectHistoryTimelineNode}
          />
        )}
      </div>

      {!isAgentRoomMode && shouldShowNewSessionGuide
        ? (
          <div
            className={[
              'new-session-guide-wrapper',
              isCompactLayout ? 'is-compact-layout' : ''
            ].filter(Boolean).join(' ')}
          >
            <NewSessionGuide
              announcements={announcements}
              startupPresets={startupPresets}
              builtinActions={builtinActions}
              composer={composerContent}
              onApplyStarter={handleApplyConversationStarter}
            />
          </div>
        )
        : (
          <ComposerStack className='chat-composer-stack'>
            {composerContent}
          </ComposerStack>
        )}
    </>
  )
}
