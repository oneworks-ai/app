import type { AgentRoomMessageView, AgentRoomRunView } from '../@types/agent-room-view'
import { AgentRoomBubble } from './AgentRoomBubble'

const getAgentSenderKey = (message: AgentRoomMessageView) => {
  if (message.role !== 'agent') {
    return undefined
  }

  return message.member?.memberKey ?? message.memberKey ?? message.run?.memberKey ?? undefined
}

const shouldShowAgentAvatar = (messages: AgentRoomMessageView[], index: number) => {
  const message = messages[index]
  if (message == null) {
    return false
  }

  if (message.role !== 'agent') {
    return false
  }

  const senderKey = getAgentSenderKey(message)
  if (senderKey == null) {
    return true
  }

  const nextMessage = messages[index + 1]
  return nextMessage?.role !== 'agent' || getAgentSenderKey(nextMessage) !== senderKey
}

const shouldShowAgentAuthor = (messages: AgentRoomMessageView[], index: number) => {
  const message = messages[index]
  if (message == null) {
    return false
  }

  if (message.role !== 'agent') {
    return false
  }

  const senderKey = getAgentSenderKey(message)
  if (senderKey == null) {
    return true
  }

  const previousMessage = messages[index - 1]
  return previousMessage?.role !== 'agent' || getAgentSenderKey(previousMessage) !== senderKey
}

export function AgentRoomMessageList({
  messages,
  variant = 'standalone',
  onOpenHostSession,
  onOpenRun,
  onReplyToRun,
  onRespondInteraction,
  onSelectHostTarget,
  onSelectMemberTarget
}: {
  messages: AgentRoomMessageView[]
  showTimelineSeparators?: boolean
  variant?: 'standalone' | 'transcript'
  onOpenHostSession?: () => void
  onOpenRun?: (run: AgentRoomRunView) => void
  onReplyToRun?: (message: AgentRoomMessageView) => void
  onRespondInteraction?: (interactionId: string, data: string | string[]) => Promise<void> | void
  onSelectHostTarget?: () => void
  onSelectMemberTarget?: (member: NonNullable<AgentRoomMessageView['member']>) => void
}) {
  return (
    <div className={`agent-room-message-list agent-room-message-list--${variant}`}>
      {messages.map((message, index) => (
        <AgentRoomBubble
          key={message.id}
          message={message}
          showAvatar={shouldShowAgentAvatar(messages, index)}
          showAuthor={shouldShowAgentAuthor(messages, index)}
          onOpenHostSession={onOpenHostSession}
          onOpenRun={onOpenRun}
          onReplyToRun={onReplyToRun}
          onRespondInteraction={onRespondInteraction}
          onSelectHostTarget={onSelectHostTarget}
          onSelectMemberTarget={onSelectMemberTarget}
        />
      ))}
    </div>
  )
}
