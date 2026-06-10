/* eslint-disable max-lines */

import type { TFunction } from 'i18next'
import type { CSSProperties } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { MarkdownContent } from '#~/components/MarkdownContent'
import { RoomPixelAvatar } from '#~/components/room-pixel-avatar/RoomPixelAvatar'

import type { AgentRoomMessageView, AgentRoomRunView } from '../@types/agent-room-view'
import { AgentRoomApprovalBatchCard } from './AgentRoomApprovalBatchCard'
import { AgentRoomInteractionRequestCard } from './AgentRoomInteractionRequestCard'

const COLLAPSED_CONTENT_HEIGHT = 240

const messageIconByKind: Record<AgentRoomMessageView['kind'], string> = {
  assignment: 'assignment_ind',
  attention: 'help',
  reply: 'reply',
  completion: 'task_alt',
  failure: 'error',
  system: 'info',
  message: 'smart_toy'
}

type AgentRoomMessageStatus = 'waiting' | 'completed' | 'failed'

const messageStatusByKind: Partial<Record<AgentRoomMessageView['kind'], AgentRoomMessageStatus>> = {
  attention: 'waiting',
  completion: 'completed',
  failure: 'failed'
}

const getMessageIcon = (message: AgentRoomMessageView) => messageIconByKind[message.kind]

const getDisplayAgentLabel = (label: string | undefined) => label == null ? '' : label.trim().replace(/^@+/, '')

const getConfiguredAvatarLabel = (message: AgentRoomMessageView) => {
  const avatarLabel = message.member?.avatarLabel?.trim()
  return avatarLabel === '' ? undefined : avatarLabel
}

const getAvatarSeed = (message: AgentRoomMessageView) => (
  `agent-room:${message.member?.memberKey ?? message.memberKey ?? message.run?.memberKey ?? message.id}`
)

const getMessageStatus = (message: AgentRoomMessageView) => {
  if (message.interactionRequest?.status === 'handled') {
    return 'completed'
  }
  if (message.interactionRequest?.status === 'expired') {
    return 'failed'
  }
  return messageStatusByKind[message.kind]
}

const getReactionLabel = (reaction: NonNullable<AgentRoomMessageView['reactions']>[number], t: TFunction) => (
  t(`agentRoom.reaction.${reaction.kind}By`, { agent: getReactionAgentLabel(reaction, t) })
)

const getReactionEmoji = (reaction: NonNullable<AgentRoomMessageView['reactions']>[number]) => (
  reaction.kind === 'completed' ? '✅' : '👀'
)

const getReactionAgentLabel = (
  reaction: NonNullable<AgentRoomMessageView['reactions']>[number],
  t: TFunction
) => {
  const label = reaction.agentLabel?.trim()
  if (label == null || label === '') {
    return t('agentRoom.message.agent')
  }
  if (reaction.isHost === true) {
    return label.replace(/^@+/, '')
  }

  return getMentionLabel(label) ?? label
}

const getMentionLabel = (label: string | undefined) => {
  const normalized = label?.trim().replace(/^@+/, '')
  return normalized == null || normalized === '' ? undefined : `@${normalized}`
}

const getReplyToAuthorLabel = (
  replyTo: NonNullable<AgentRoomMessageView['replyTo']>,
  t: TFunction
) => {
  const label = replyTo.authorLabel?.trim()
  if (label != null && label !== '') {
    return replyTo.role === 'user' ? label : getDisplayAgentLabel(label) || label
  }

  if (replyTo.role === 'user') {
    return t('agentRoom.message.you')
  }
  if (replyTo.role === 'system') {
    return t('agentRoom.message.system')
  }
  return t('agentRoom.message.agent')
}

const renderMessageContent = (
  message: AgentRoomMessageView,
  onRespondInteraction?: (interactionId: string, data: string | string[]) => Promise<void> | void
) => (
  message.interactionRequest != null && typeof message.content === 'string'
    ? (
      <AgentRoomInteractionRequestCard
        content={message.content}
        request={message.interactionRequest}
        onRespondInteraction={onRespondInteraction}
      />
    )
    : message.approvalBatch != null
    ? <AgentRoomApprovalBatchCard batch={message.approvalBatch} />
    : typeof message.content === 'string'
    ? <MarkdownContent content={message.content} />
    : message.content
)

const renderSystemMessageContent = (message: AgentRoomMessageView, t: TFunction) => {
  if (message.systemMessage?.kind === 'memberJoined') {
    return t('agentRoom.system.memberJoined', { member: message.systemMessage.memberLabel })
  }

  return message.content
}

const shouldUseWideSurface = (
  message: AgentRoomMessageView,
  isUserMessage: boolean,
  isApprovalBatch: boolean,
  isContentOverflowing: boolean
) => {
  if (isUserMessage || isApprovalBatch) return false
  if (message.kind === 'completion') return false
  if (isContentOverflowing) return true
  if (typeof message.content !== 'string') return false

  const content = message.content.trim()

  return content.length >= 120 || content.includes('\n')
}

export function AgentRoomBubble({
  message,
  showAvatar = true,
  showAuthor = true,
  onOpenHostSession,
  onOpenRun,
  onReplyToRun,
  onRespondInteraction,
  onSelectHostTarget,
  onSelectMemberTarget
}: {
  message: AgentRoomMessageView
  showAvatar?: boolean
  showAuthor?: boolean
  onOpenHostSession?: () => void
  onOpenRun?: (run: AgentRoomRunView) => void
  onReplyToRun?: (message: AgentRoomMessageView) => void
  onRespondInteraction?: (interactionId: string, data: string | string[]) => Promise<void> | void
  onSelectHostTarget?: () => void
  onSelectMemberTarget?: (member: NonNullable<AgentRoomMessageView['member']>) => void
}) {
  const { t } = useTranslation()
  const contentRef = useRef<HTMLDivElement>(null)
  const [isContentExpanded, setIsContentExpanded] = useState(false)
  const [contentExpandedHeight, setContentExpandedHeight] = useState(COLLAPSED_CONTENT_HEIGHT)
  const [isContentOverflowing, setIsContentOverflowing] = useState(false)
  const isApprovalBatch = message.approvalBatch != null
  const isInteractionRequest = message.interactionRequest != null
  const canCollapseContent = !isApprovalBatch && !isInteractionRequest
  const shouldRenderContentToggle = canCollapseContent && isContentOverflowing
  const isContentCollapsed = shouldRenderContentToggle && !isContentExpanded
  const isWideSurface = shouldUseWideSurface(message, message.role === 'user', isApprovalBatch, isContentOverflowing)

  useEffect(() => {
    setIsContentExpanded(false)
  }, [message.id])

  useEffect(() => {
    const node = contentRef.current
    if (node == null) return undefined

    const updateOverflowState = () => {
      const scrollHeight = node.scrollHeight
      setContentExpandedHeight(Math.max(scrollHeight, COLLAPSED_CONTENT_HEIGHT))
      setIsContentOverflowing(scrollHeight > COLLAPSED_CONTENT_HEIGHT + 1)
    }

    updateOverflowState()

    const ResizeObserverCtor = globalThis.ResizeObserver
    if (ResizeObserverCtor == null) return undefined

    const observer = new ResizeObserverCtor(updateOverflowState)
    observer.observe(node)

    return () => observer.disconnect()
  }, [message.content, message.id])

  if (message.role === 'system') {
    return (
      <div
        id={`message-${message.id}`}
        className='agent-room-bubble agent-room-bubble--system'
        data-message-id={message.id}
      >
        <span className='agent-room-bubble__system-surface'>
          <span className='material-symbols-rounded' aria-hidden='true'>{getMessageIcon(message)}</span>
          <span>{renderSystemMessageContent(message, t)}</span>
        </span>
      </div>
    )
  }

  const isUserMessage = message.role === 'user'
  const agentDisplayLabel = getDisplayAgentLabel(message.member?.label)
  const isLeaderMessage = !isUserMessage &&
    (message.member?.kind === 'host' || agentDisplayLabel.toLowerCase() === 'leader')
  const authorLabel = message.member == null
    ? t('agentRoom.message.agent')
    : agentDisplayLabel === ''
    ? t('agentRoom.message.agent')
    : agentDisplayLabel
  const subtitle = isUserMessage ? undefined : message.member?.subtitle
  const run = message.run
  const canOpenRun = run != null && run.sessionId !== '' && onOpenRun != null
  const canOpenHostSession = isLeaderMessage && onOpenHostSession != null
  const canOpenSenderSession = canOpenHostSession || canOpenRun
  const canSelectHostTarget = isLeaderMessage && onSelectHostTarget != null
  const canSelectMemberTarget = !isLeaderMessage && message.member != null && onSelectMemberTarget != null
  const canSelectReplyTarget = !isLeaderMessage && !canSelectMemberTarget && run != null && onReplyToRun != null
  const targetMentionLabel = getMentionLabel(message.targetLabel)
  const canOpenTargetMention = targetMentionLabel != null && canOpenRun
  const avatarLabel = getConfiguredAvatarLabel(message)
  const avatarSeed = getAvatarSeed(message)
  const openRunLabel = t('agentRoom.actions.openRun')
  const openHostSessionLabel = t('agentRoom.actions.openHostSession')
  const openRunTitle = run?.title == null || run.title === ''
    ? openRunLabel
    : `${openRunLabel}: ${run.title}`
  const openSenderTitle = canOpenHostSession ? openHostSessionLabel : openRunTitle
  const replyTargetTitle = t('agentRoom.actions.messageRun', { target: authorLabel })
  const status = getMessageStatus(message)
  const statusLabel = status == null ? undefined : t(`agentRoom.status.run.${status}`)
  const statusId = statusLabel == null ? undefined : `message-${message.id}-status`
  const reactions = message.reactions ?? []
  const reactionsId = reactions.length > 0 ? `reaction-${message.id}` : undefined
  const replyTo = message.replyTo
  const replyToAuthorLabel = replyTo == null ? undefined : getReplyToAuthorLabel(replyTo, t)
  const replyToLabel = replyTo == null || replyToAuthorLabel == null
    ? undefined
    : t('agentRoom.message.replyingTo', { author: replyToAuthorLabel, content: replyTo.content })
  const expandToggleLabel = isContentExpanded ? t('agentRoom.message.collapseLong') : t('agentRoom.message.expandLong')
  const describedByIds = [statusId, reactionsId].filter((id): id is string => id != null).join(' ')
  const shouldRenderAvatar = !isUserMessage && showAvatar
  const shouldReserveAvatarSpace = !isUserMessage && !showAvatar
  const shouldRenderAuthor = !isUserMessage && showAuthor
  const isMarkdownContent = typeof message.content === 'string' &&
    message.approvalBatch == null &&
    message.interactionRequest == null
  const contentStyle = shouldRenderContentToggle
    ? ({
      '--agent-room-bubble-content-max-height': `${contentExpandedHeight}px`
    } as CSSProperties)
    : undefined
  const handleOpenRun = () => {
    if (run == null) return
    onOpenRun?.(run)
  }
  const handleOpenSenderSession = () => {
    if (canOpenHostSession) {
      onOpenHostSession?.()
      return
    }

    handleOpenRun()
  }
  const handleSelectReplyTarget = () => {
    onReplyToRun?.(message)
  }
  const handleSelectMemberTarget = () => {
    if (message.member == null) return
    onSelectMemberTarget?.(message.member)
  }
  const handleSelectHostTarget = () => {
    onSelectHostTarget?.()
  }

  return (
    <article
      id={`message-${message.id}`}
      className={[
        'agent-room-bubble',
        `agent-room-bubble--${message.role}`,
        `agent-room-bubble--${message.kind}`,
        isLeaderMessage ? 'agent-room-bubble--leader' : '',
        shouldReserveAvatarSpace ? 'agent-room-bubble--avatar-hidden' : '',
        isApprovalBatch ? 'agent-room-bubble--approval-batch' : '',
        isInteractionRequest ? 'agent-room-bubble--interaction-request' : '',
        shouldRenderContentToggle ? 'agent-room-bubble--content-overflowing' : '',
        isWideSurface ? 'agent-room-bubble--wide-content' : '',
        replyTo != null ? 'agent-room-bubble--has-quote' : '',
        reactions.length > 0 ? 'agent-room-bubble--has-reactions' : '',
        status == null ? '' : `agent-room-bubble--status-${status}`
      ].filter(Boolean).join(' ')}
      data-message-id={message.id}
      data-status={status}
      title={statusLabel}
      aria-describedby={describedByIds === '' ? undefined : describedByIds}
    >
      {shouldRenderAvatar && (
        canOpenSenderSession
          ? (
            <button
              type='button'
              className={[
                'agent-room-bubble__avatar',
                avatarLabel == null ? 'agent-room-bubble__avatar--pixel' : '',
                'agent-room-bubble__avatar-button'
              ].filter(Boolean).join(' ')}
              aria-label={openSenderTitle}
              title={openSenderTitle}
              onClick={handleOpenSenderSession}
            >
              {avatarLabel ?? <RoomPixelAvatar className='agent-room-bubble__avatar-pixel' seed={avatarSeed} />}
            </button>
          )
          : (
            <div
              className={[
                'agent-room-bubble__avatar',
                avatarLabel == null ? 'agent-room-bubble__avatar--pixel' : ''
              ].filter(Boolean).join(' ')}
              aria-hidden='true'
            >
              {avatarLabel ?? <RoomPixelAvatar className='agent-room-bubble__avatar-pixel' seed={avatarSeed} />}
            </div>
          )
      )}
      {shouldReserveAvatarSpace && (
        <span className='agent-room-bubble__avatar-spacer' aria-hidden='true' />
      )}
      <div className='agent-room-bubble__stack'>
        {shouldRenderAuthor && (
          <div className='agent-room-bubble__meta'>
            {canSelectReplyTarget
              ? (
                <button
                  type='button'
                  className='agent-room-bubble__author agent-room-bubble__author-button'
                  aria-label={replyTargetTitle}
                  title={replyTargetTitle}
                  onClick={handleSelectReplyTarget}
                >
                  {authorLabel}
                </button>
              )
              : canSelectMemberTarget
              ? (
                <button
                  type='button'
                  className='agent-room-bubble__author agent-room-bubble__author-button'
                  aria-label={authorLabel}
                  onClick={handleSelectMemberTarget}
                >
                  {authorLabel}
                </button>
              )
              : canSelectHostTarget
              ? (
                <button
                  type='button'
                  className='agent-room-bubble__author agent-room-bubble__author-button'
                  aria-label={authorLabel}
                  onClick={handleSelectHostTarget}
                >
                  {authorLabel}
                </button>
              )
              : canOpenSenderSession
              ? (
                <button
                  type='button'
                  className='agent-room-bubble__author agent-room-bubble__author-button'
                  aria-label={openSenderTitle}
                  title={openSenderTitle}
                  onClick={handleOpenSenderSession}
                >
                  {authorLabel}
                </button>
              )
              : <span className='agent-room-bubble__author'>{authorLabel}</span>}
            {subtitle != null && subtitle !== '' && (
              <span className='agent-room-bubble__subtitle'>{subtitle}</span>
            )}
          </div>
        )}
        <div className='agent-room-bubble__message-row'>
          <div className='agent-room-bubble__surface'>
            {statusLabel != null && (
              <span id={statusId} className='agent-room-bubble__status-text'>
                {statusLabel}
              </span>
            )}
            {replyTo != null && replyToAuthorLabel != null && (
              <a
                className='agent-room-bubble__quote'
                href={`#message-${replyTo.id}`}
                aria-label={replyToLabel}
                title={replyToLabel}
              >
                <span className='agent-room-bubble__quote-author'>{replyToAuthorLabel}</span>
                <span className='agent-room-bubble__quote-text'>{replyTo.content}</span>
              </a>
            )}
            <div className='agent-room-bubble__content-shell'>
              <div
                ref={contentRef}
                style={contentStyle}
                className={[
                  'agent-room-bubble__content',
                  isContentCollapsed ? 'agent-room-bubble__content--collapsed' : 'agent-room-bubble__content--expanded',
                  targetMentionLabel == null ? '' : 'agent-room-bubble__content--targeted'
                ].filter(Boolean).join(' ')}
              >
                {targetMentionLabel != null && (
                  canOpenTargetMention
                    ? (
                      <button
                        type='button'
                        className='agent-room-bubble__mention agent-room-bubble__mention-button'
                        aria-label={openRunTitle}
                        title={openRunTitle}
                        onClick={handleOpenRun}
                      >
                        {targetMentionLabel}
                      </button>
                    )
                    : <span className='agent-room-bubble__mention'>{targetMentionLabel}</span>
                )}
                <div
                  className={[
                    'agent-room-bubble__content-text',
                    isMarkdownContent
                      ? 'agent-room-bubble__content-text--markdown'
                      : 'agent-room-bubble__content-text--plain'
                  ].join(' ')}
                >
                  {renderMessageContent(message, onRespondInteraction)}
                </div>
              </div>
            </div>
            {shouldRenderContentToggle && (
              <button
                type='button'
                className='agent-room-bubble__expand'
                aria-label={expandToggleLabel}
                title={expandToggleLabel}
                aria-expanded={isContentExpanded}
                onClick={() => setIsContentExpanded(value => !value)}
              >
                <span className='material-symbols-rounded' aria-hidden='true'>
                  {isContentExpanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
                </span>
              </button>
            )}
            {reactions.length > 0 && (
              <div id={reactionsId} className='agent-room-bubble__reactions'>
                {reactions.map((reaction, index) => {
                  const reactionAgentLabel = getReactionAgentLabel(reaction, t)
                  const canOpenReactionRun = reaction.run != null && onOpenRun != null
                  const canOpenReactionHost = reaction.isHost === true && onOpenHostSession != null
                  const canOpenReactionTarget = canOpenReactionRun || canOpenReactionHost
                  const openReactionTitle = t('agentRoom.reaction.openTarget', { agent: reactionAgentLabel })
                  const handleOpenReactionTarget = () => {
                    if (canOpenReactionHost) {
                      onOpenHostSession?.()
                      return
                    }
                    if (reaction.run != null) {
                      onOpenRun?.(reaction.run)
                    }
                  }

                  return (
                    <span
                      key={`${reaction.kind}:${reactionAgentLabel}:${index}`}
                      className={`agent-room-bubble__reaction agent-room-bubble__reaction--${reaction.kind}`}
                      aria-label={getReactionLabel(reaction, t)}
                    >
                      <span className='agent-room-bubble__reaction-emoji' aria-hidden='true'>
                        {getReactionEmoji(reaction)}
                      </span>
                      {canOpenReactionTarget
                        ? (
                          <button
                            type='button'
                            className='agent-room-bubble__reaction-agent agent-room-bubble__reaction-agent-button'
                            aria-label={openReactionTitle}
                            title={openReactionTitle}
                            onClick={handleOpenReactionTarget}
                          >
                            {reactionAgentLabel}
                          </button>
                        )
                        : <span className='agent-room-bubble__reaction-agent'>{reactionAgentLabel}</span>}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}
