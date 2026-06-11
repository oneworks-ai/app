import './MessageItem.scss'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

import type { ChatMessage, ChatMessageContent, Session } from '@oneworks/core'
import type { SessionInfo } from '@oneworks/types'

import { MarkdownContent } from '#~/components/MarkdownContent'
import type { MarkdownImageRenderProps } from '#~/components/MarkdownContent'
import type { AgentRoomMemberView } from '#~/components/agent-room'
import { getAppBrowserLinkUrl } from '#~/components/markdown-link-context-menu-utils'
import { RoomPixelAvatar } from '#~/components/room-pixel-avatar/RoomPixelAvatar'
import { parseWorkspaceFileLinkForWorkspaceRoot } from '#~/utils/link-targets'
import type { WorkspaceFileLinkTarget } from '#~/utils/link-targets'
import { DEFAULT_MESSAGE_LINKS_CONFIG } from '#~/utils/message-links-config'
import type { ResolvedMessageLinksConfig } from '#~/utils/message-links-config'

import { Sender } from '../sender/Sender'
import { ToolRenderer } from '../tools/core/ToolRenderer'
import { AgentRoomChildRequestCard } from './AgentRoomChildRequestCard'
import { AgentRoomEnvelopeCard } from './AgentRoomEnvelopeCard'
import { MessageContextMenu } from './MessageContextMenu'
import { MessageFooter } from './MessageFooter'
import { MessageImage } from './MessageImage'
import type { MessagePreviewImage } from './MessageImage'
import { MessageImagePreviewModal } from './MessageImagePreviewModal'
import { parseAgentRoomChildRequest } from './agent-room-child-request'
import { parseAgentRoomEnvelope } from './agent-room-envelope'
import type { MessageBranchNavigation } from './message-branch-navigation'
import {
  getCopyableMessageText,
  getEditableMessageContent,
  isSameEditableMessageContent,
  normalizeEditableMessageContent
} from './message-content-utils'
import { prepareMarkdownMessageContent } from './message-display-content'

interface MessageItemProps {
  anchorId: string
  msg: ChatMessage
  isFirstInGroup: boolean
  originalMessage: ChatMessage
  isTargeted: boolean
  isAgentRoomSession?: boolean
  agentRoomSourceMembers?: AgentRoomMemberView[]
  session?: Session
  sessionId?: string
  sessionInfo?: SessionInfo | null
  isSessionBusy: boolean
  isEditing: boolean
  onEditMessage: (messageId: string, content: string | ChatMessageContent[]) => Promise<boolean>
  onRecallMessage: (messageId: string) => Promise<boolean>
  onForkMessage: (messageId: string) => Promise<boolean>
  branchNavigation?: MessageBranchNavigation
  messageLinksConfig?: ResolvedMessageLinksConfig
  onOpenUrlInAppBrowser?: (url: string, title?: string) => void
  onOpenWorkspaceFile?: (path: string) => void
  onOpenWorkspaceFileInExternalOpener?: (target: WorkspaceFileLinkTarget) => void
  workspaceRootPath?: string
  onSwitchBranchSession: (sessionId: string) => void
  onStartEditing: (messageId: string) => void
  onCancelEditing: (messageId: string) => void
}

interface AgentRoomMessageSourceView {
  kind: 'agent' | 'user'
  source: string
  label?: string
  avatarLabel?: string
  avatarSeed: string
}

const isAgentRoomChildSession = (session: Session | undefined) => (
  session?.parentSessionId != null &&
  session.parentSessionId !== '' &&
  session.id.startsWith('sess_')
)

const normalizeSourceText = (value: string | undefined) => {
  const normalized = value?.trim()
  return normalized === '' ? undefined : normalized
}

const hasLeaderCommandMetadata = (msg: ChatMessage) => (
  normalizeSourceText(msg.agentRoom?.commandId) != null ||
  normalizeSourceText(msg.agentRoom?.causedByCommandId) != null
)

const getLeaderSourceMember = (members: AgentRoomMemberView[]) => (
  members.find(member => member.kind === 'host' || member.memberKey === 'host' || member.memberKey === 'leader')
)

const getAgentSourceMember = (
  source: string,
  label: string | undefined,
  members: AgentRoomMemberView[]
) => (
  members.find(member =>
    member.memberKey === source ||
    member.label === source ||
    (label != null && (member.memberKey === label || member.label === label))
  )
)

const resolveAgentRoomMessageSource = (
  msg: ChatMessage,
  session: Session | undefined,
  isAgentRoomSession: boolean | undefined,
  members: AgentRoomMemberView[] = []
): AgentRoomMessageSourceView | undefined => {
  if (msg.role !== 'user' || isAgentRoomSession !== true || !isAgentRoomChildSession(session)) {
    return undefined
  }

  const source = normalizeSourceText(msg.agentRoom?.source) ??
    (hasLeaderCommandMetadata(msg) ? 'leader' : undefined)
  if (source == null || source === 'user' || source === 'ui') {
    return undefined
  }

  const label = normalizeSourceText(msg.agentRoom?.sourceLabel) ?? source
  const sourceMember = source === 'leader'
    ? getLeaderSourceMember(members)
    : getAgentSourceMember(source, label, members)

  return {
    avatarLabel: normalizeSourceText(sourceMember?.avatarLabel),
    avatarSeed: `agent-room-session-source:${sourceMember?.memberKey ?? source}`,
    kind: 'agent',
    source,
    label
  }
}

function MessageItemComponent({
  anchorId,
  msg,
  isFirstInGroup,
  originalMessage,
  isTargeted,
  isAgentRoomSession,
  agentRoomSourceMembers,
  session,
  sessionId,
  sessionInfo,
  isSessionBusy,
  isEditing,
  onEditMessage,
  onRecallMessage,
  onForkMessage,
  branchNavigation,
  messageLinksConfig = DEFAULT_MESSAGE_LINKS_CONFIG,
  onOpenUrlInAppBrowser,
  onOpenWorkspaceFile,
  onOpenWorkspaceFileInExternalOpener,
  workspaceRootPath,
  onSwitchBranchSession,
  onStartEditing,
  onCancelEditing
}: MessageItemProps) {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const isDebugMode = searchParams.get('debug') === 'true'
  const agentRoomMessageSource = resolveAgentRoomMessageSource(
    originalMessage,
    session,
    isAgentRoomSession,
    agentRoomSourceMembers
  )
  const agentRoomMessageSourceLabel = agentRoomMessageSource == null
    ? undefined
    : agentRoomMessageSource.kind === 'user'
    ? t('chat.agentRoomSessionSource.user')
    : agentRoomMessageSource.source === 'leader'
    ? t('chat.agentRoomSessionSource.leader')
    : t('chat.agentRoomSessionSource.agent', { source: agentRoomMessageSource.label })
  const agentRoomMessageSourceSeparator = t('chat.agentRoomSessionSource.separator')
  const agentRoomChildRequest = useMemo(
    () => typeof msg.content === 'string' ? parseAgentRoomChildRequest(msg.content) : undefined,
    [msg.content]
  )
  const agentRoomEnvelope = useMemo(
    () => typeof msg.content === 'string' ? parseAgentRoomEnvelope(msg.content) : undefined,
    [msg.content]
  )
  const isAgentRoomChildRequest = agentRoomChildRequest != null
  const isUser = msg.role === 'user' && !isAgentRoomChildRequest
  const [isSubmitting, setIsSubmitting] = useState(false)
  const editableContent = useMemo(() => getEditableMessageContent(msg), [msg])
  const copyableText = useMemo(() => getCopyableMessageText(msg), [msg])
  const resolvedWorkspaceRootPath = sessionInfo?.type === 'init'
    ? sessionInfo.cwd.trim()
    : workspaceRootPath?.trim() ?? ''
  const actionMessageId = originalMessage.id
  const isPersistedMessage = sessionId != null && sessionId !== '' && !actionMessageId.startsWith('local-')
  const canEdit = isPersistedMessage && !isSessionBusy && isUser && editableContent != null
  const canRecall = isPersistedMessage && !isSessionBusy && isUser
  const canFork = isPersistedMessage && !isSessionBusy && isUser
  const [previewImage, setPreviewImage] = useState<MessagePreviewImage | null>(null)

  useEffect(() => {
    setIsSubmitting(false)
  }, [isEditing, msg.id])

  const handlePreviewImage = useCallback((image: MessagePreviewImage) => {
    setPreviewImage(image)
  }, [])

  const renderMarkdownImage = useCallback((image: MarkdownImageRenderProps) => (
    <MessageImage
      src={image.src}
      alt={image.alt}
      title={image.title}
      onPreview={handlePreviewImage}
    />
  ), [handlePreviewImage])

  const handleMarkdownLinkClick = useCallback((href: string, event: React.MouseEvent<HTMLAnchorElement>) => {
    const appBrowserUrl = getAppBrowserLinkUrl(href)
    if (appBrowserUrl !== '' && onOpenUrlInAppBrowser != null) {
      event.preventDefault()
      onOpenUrlInAppBrowser(appBrowserUrl, event.currentTarget.textContent?.trim())
      return
    }

    if (
      messageLinksConfig.workspaceFileTarget !== 'fileTab' &&
      messageLinksConfig.workspaceFileTarget !== 'externalIde'
    ) {
      return
    }

    const workspaceTarget = parseWorkspaceFileLinkForWorkspaceRoot(href, resolvedWorkspaceRootPath)
    if (workspaceTarget == null) {
      return
    }

    if (messageLinksConfig.workspaceFileTarget === 'externalIde') {
      if (onOpenWorkspaceFileInExternalOpener == null) {
        return
      }
      event.preventDefault()
      onOpenWorkspaceFileInExternalOpener(workspaceTarget)
      return
    }

    if (onOpenWorkspaceFile == null) {
      return
    }
    event.preventDefault()
    onOpenWorkspaceFile(workspaceTarget.path)
  }, [
    messageLinksConfig.workspaceFileTarget,
    onOpenUrlInAppBrowser,
    onOpenWorkspaceFile,
    onOpenWorkspaceFileInExternalOpener,
    resolvedWorkspaceRootPath
  ])

  const renderMarkdownContent = useCallback((content: string) => (
    <MarkdownContent
      content={prepareMarkdownMessageContent(content, {
        escapeLeadingUserReferenceDefinition: isUser
      })}
      enableLinkContextMenu
      linkPlainWorkspaceFiles={messageLinksConfig.plainWorkspacePathMode === 'link'}
      onLinkClick={handleMarkdownLinkClick}
      onOpenUrlInAppBrowser={onOpenUrlInAppBrowser}
      onOpenWorkspaceFileLink={onOpenWorkspaceFile == null
        ? undefined
        : (target) => {
          onOpenWorkspaceFile(target.path)
        }}
      openLinksInNewTab={messageLinksConfig.externalLinkTarget === 'newTab'}
      renderImage={renderMarkdownImage}
      renderImageLinks={messageLinksConfig.imageLinkMode === 'inlinePreview'}
      workspaceRootPath={resolvedWorkspaceRootPath}
    />
  ), [
    handleMarkdownLinkClick,
    isUser,
    messageLinksConfig.externalLinkTarget,
    messageLinksConfig.imageLinkMode,
    messageLinksConfig.plainWorkspacePathMode,
    onOpenUrlInAppBrowser,
    onOpenWorkspaceFile,
    renderMarkdownImage,
    resolvedWorkspaceRootPath
  ])

  const renderContent = () => {
    if (msg.content == null) return null

    if (agentRoomChildRequest != null) {
      return <AgentRoomChildRequestCard request={agentRoomChildRequest} />
    }

    if (agentRoomEnvelope != null) {
      return <AgentRoomEnvelopeCard envelope={agentRoomEnvelope} />
    }

    if (typeof msg.content === 'string') {
      return (
        renderMarkdownContent(msg.content)
      )
    }

    if (!Array.isArray(msg.content)) return null

    const hasContent = msg.content.some((c: ChatMessageContent) => (
      c.type === 'text' || c.type === 'image' || c.type === 'file'
    )) ||
      msg.toolCall != null
    if (!hasContent) return null

    return (
      <div className='message-contents'>
        {msg.content.map((item: ChatMessageContent, i: number) => {
          if (item.type === 'text') {
            return (
              <React.Fragment key={i}>
                {renderMarkdownContent(item.text)}
              </React.Fragment>
            )
          }
          if (item.type === 'image') {
            return (
              <MessageImage
                key={i}
                src={item.url}
                alt={item.name ?? t('chat.imagePreviewTitle')}
                title={item.name}
                onPreview={handlePreviewImage}
              />
            )
          }
          if (item.type === 'file') {
            return (
              <div key={i} className='message-context-file'>
                <span className='material-symbols-rounded message-context-file__icon'>description</span>
                <code className='message-context-file__path'>{item.path}</code>
              </div>
            )
          }
          return null
        })}
        {msg.toolCall != null && (
          <ToolRenderer
            item={{
              type: 'tool_use',
              id: msg.toolCall.id ?? 'legacy',
              name: msg.toolCall.name,
              input: msg.toolCall.args
            }}
            resultItem={msg.toolCall.output != null
              ? {
                type: 'tool_result',
                tool_use_id: msg.toolCall.id ?? 'legacy',
                content: msg.toolCall.output,
                is_error: msg.toolCall.status === 'error'
              }
              : undefined}
          />
        )}
      </div>
    )
  }

  const content = renderContent()
  if (content == null) return null

  const handleStartEdit = () => {
    if (editableContent == null) return
    onStartEditing(actionMessageId)
  }

  const submitEditedContent = async (nextContent: string | ChatMessageContent[]) => {
    const normalizedNextContent = normalizeEditableMessageContent(nextContent)
    if (normalizedNextContent == null || isSameEditableMessageContent(normalizedNextContent, editableContent)) {
      onCancelEditing(actionMessageId)
      return true
    }

    setIsSubmitting(true)
    try {
      const didCreateBranch = await onEditMessage(actionMessageId, normalizedNextContent)
      if (didCreateBranch) {
        onCancelEditing(actionMessageId)
      }
      return didCreateBranch
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmitEditText = async (nextText: string) => {
    return submitEditedContent(nextText)
  }

  const handleSubmitEditContent = async (nextContent: ChatMessageContent[]) => {
    return submitEditedContent(nextContent)
  }

  const handleRecall = async () => {
    await onRecallMessage(actionMessageId)
  }

  const handleFork = async () => {
    await onForkMessage(actionMessageId)
  }

  const branchNavigationControl = !isEditing && isUser && branchNavigation != null
    ? (
      <div className='message-branch-navigation' aria-label={t('chat.messageActions.branchNavigation')}>
        <button
          type='button'
          className='message-branch-navigation__button'
          title={t('chat.messageActions.previousBranch')}
          aria-label={t('chat.messageActions.previousBranch')}
          disabled={branchNavigation.previousSessionId == null}
          onClick={() => {
            if (branchNavigation.previousSessionId != null) {
              onSwitchBranchSession(branchNavigation.previousSessionId)
            }
          }}
        >
          <span className='material-symbols-rounded'>chevron_left</span>
        </button>
        <span className='message-branch-navigation__count'>
          {branchNavigation.current} / {branchNavigation.total}
        </span>
        <button
          type='button'
          className='message-branch-navigation__button'
          title={t('chat.messageActions.nextBranch')}
          aria-label={t('chat.messageActions.nextBranch')}
          disabled={branchNavigation.nextSessionId == null}
          onClick={() => {
            if (branchNavigation.nextSessionId != null) {
              onSwitchBranchSession(branchNavigation.nextSessionId)
            }
          }}
        >
          <span className='material-symbols-rounded'>chevron_right</span>
        </button>
      </div>
    )
    : null

  return (
    <>
      <MessageContextMenu
        anchorId={anchorId}
        canEdit={canEdit}
        canFork={canFork}
        canRecall={canRecall}
        copyableText={copyableText}
        isDebugMode={isDebugMode}
        isEditing={isEditing}
        message={originalMessage}
        sessionId={sessionId}
        onFork={handleFork}
        onRecall={handleRecall}
        onStartEditing={handleStartEdit}
      >
        <div
          id={anchorId}
          className={[
            isUser ? 'chat-message-user' : 'chat-message-assistant',
            agentRoomMessageSource != null ? 'chat-message-user--agent-room-source' : '',
            agentRoomMessageSource?.source === 'leader' ? 'chat-message-user--agent-room-leader-source' : '',
            agentRoomMessageSource?.kind === 'agent' ? 'chat-message-user--agent-room-agent-source' : '',
            isAgentRoomChildRequest ? 'chat-message-agent-room-child-request' : '',
            agentRoomEnvelope != null ? 'chat-message-user--agent-room-envelope' : '',
            isEditing ? 'is-editing' : '',
            !isFirstInGroup ? 'consecutive' : '',
            isTargeted ? 'is-targeted' : ''
          ].filter(Boolean).join(' ')}
          data-message-id={originalMessage.id}
        >
          <div className={`message-body-container ${isEditing ? 'is-editing' : ''}`}>
            <div className={`bubble ${isEditing ? 'is-editing' : ''}`}>
              {isEditing
                ? (
                  <div className='message-inline-editor'>
                    <Sender
                      variant='inline-edit'
                      sessionId={sessionId}
                      sessionInfo={sessionInfo}
                      initialContent={editableContent}
                      submitLabel={t('chat.send')}
                      submitLoading={isSubmitting}
                      autoFocus
                      onCancel={() => {
                        onCancelEditing(actionMessageId)
                      }}
                      onSend={handleSubmitEditText}
                      onSendContent={handleSubmitEditContent}
                      onInterrupt={() => {}}
                    />
                  </div>
                )
                : (
                  <>
                    {agentRoomMessageSource != null && (
                      <div
                        className={[
                          'message-source-line',
                          `message-source-line--${agentRoomMessageSource.kind}`,
                          agentRoomMessageSource.source === 'leader' ? 'message-source-line--leader' : ''
                        ].filter(Boolean).join(' ')}
                        data-agent-room-source={agentRoomMessageSource.source}
                        aria-label={`${agentRoomMessageSourceLabel}${agentRoomMessageSourceSeparator}`}
                        title={`${agentRoomMessageSourceLabel}${agentRoomMessageSourceSeparator}`}
                      >
                        {agentRoomMessageSource.avatarLabel != null
                          ? (
                            <span
                              className='message-source-line__avatar message-source-line__avatar--configured'
                              aria-hidden='true'
                            >
                              {agentRoomMessageSource.avatarLabel}
                            </span>
                          )
                          : (
                            <RoomPixelAvatar
                              className='message-source-line__avatar message-source-line__avatar--pixel'
                              seed={agentRoomMessageSource.avatarSeed}
                            />
                          )}
                        <span className='message-source-line__text'>
                          {agentRoomMessageSourceLabel}
                          {agentRoomMessageSourceSeparator}
                        </span>
                      </div>
                    )}
                    {content}
                  </>
                )}
            </div>
            {branchNavigationControl}
            {!isEditing && (
              <MessageFooter msg={originalMessage} isUser={isUser} />
            )}
          </div>
        </div>
      </MessageContextMenu>
      <MessageImagePreviewModal
        image={previewImage}
        onClose={() => setPreviewImage(null)}
      />
    </>
  )
}

const areMessageItemPropsEqual = (prev: MessageItemProps, next: MessageItemProps) => {
  return prev.anchorId === next.anchorId &&
    prev.isFirstInGroup === next.isFirstInGroup &&
    prev.isTargeted === next.isTargeted &&
    prev.isAgentRoomSession === next.isAgentRoomSession &&
    prev.session?.id === next.session?.id &&
    prev.session?.parentSessionId === next.session?.parentSessionId &&
    prev.isSessionBusy === next.isSessionBusy &&
    prev.isEditing === next.isEditing &&
    prev.sessionId === next.sessionId &&
    prev.sessionInfo === next.sessionInfo &&
    prev.branchNavigation?.current === next.branchNavigation?.current &&
    prev.branchNavigation?.total === next.branchNavigation?.total &&
    prev.branchNavigation?.previousSessionId === next.branchNavigation?.previousSessionId &&
    prev.branchNavigation?.nextSessionId === next.branchNavigation?.nextSessionId &&
    prev.messageLinksConfig === next.messageLinksConfig &&
    prev.onOpenUrlInAppBrowser === next.onOpenUrlInAppBrowser &&
    prev.onOpenWorkspaceFile === next.onOpenWorkspaceFile &&
    prev.onOpenWorkspaceFileInExternalOpener === next.onOpenWorkspaceFileInExternalOpener &&
    prev.workspaceRootPath === next.workspaceRootPath &&
    prev.onSwitchBranchSession === next.onSwitchBranchSession &&
    prev.msg.id === next.msg.id &&
    prev.msg.role === next.msg.role &&
    prev.msg.createdAt === next.msg.createdAt &&
    prev.msg.model === next.msg.model &&
    prev.msg.content === next.msg.content &&
    prev.msg.toolCall === next.msg.toolCall &&
    prev.msg.usage === next.msg.usage &&
    prev.originalMessage === next.originalMessage
}

export const MessageItem = React.memo(MessageItemComponent, areMessageItemPropsEqual)
