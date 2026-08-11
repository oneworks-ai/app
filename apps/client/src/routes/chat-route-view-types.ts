import type {
  AgentRoomMemberView,
  AgentRoomMessageView,
  AgentRoomRunView,
  AgentRoomSenderSubmit,
  AgentRoomViewModel
} from '#~/components/agent-room'
import type { ChatHeaderRoomIconStatus } from '#~/components/chat/ChatHeader'
import type { ChannelNavigationPreferences } from '@oneworks/types'

export interface ChatRouteAgentRoomTranscript {
  room: AgentRoomViewModel
  roomIconStatus?: ChatHeaderRoomIconStatus
  members: AgentRoomMemberView[]
  navigationPreferences?: ChannelNavigationPreferences
  workspaceSessionId?: string
  onOpenHostSession?: () => void
  onOpenRun?: (run: AgentRoomRunView) => void
  onReplyToRun?: (message: AgentRoomMessageView) => void
  onRespondInteraction?: (interactionId: string, data: string | string[]) => Promise<void> | void
  onSubmitMessage: (request: AgentRoomSenderSubmit) => Promise<void> | void
}
