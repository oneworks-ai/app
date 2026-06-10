import type { ChatMessage, ChatMessageContent, SessionWorkspaceChanges } from '@oneworks/core'

import type { AgentRoomChildRequest } from './agent-room-child-request'
import type { ChatHistoryStatusNotice } from './build-chat-history-status-notices'

export interface AgentRoomChildRequestItem {
  anchorId: string
  originalMessage: ChatMessage
  type: 'agent-room-child-request'
  request: AgentRoomChildRequest
}

export interface ToolGroupItem {
  anchorId: string
  originalMessage: ChatMessage
  type: 'tool-group'
  id: string
  items: {
    item: Extract<ChatMessageContent, { type: 'tool_use' }>
    resultItem?: Extract<ChatMessageContent, { type: 'tool_result' }>
  }[]
  footer?: {
    model?: string
    usage?: ChatMessage['usage']
    createdAt: number
    originalMessage: ChatMessage
  }
}

export interface MessageRenderItem {
  anchorId: string
  originalMessage: ChatMessage
  type: 'message'
  message: ChatMessage
  isFirstInGroup: boolean
}

export interface StatusNoticeRenderItem {
  anchorId: string
  originalMessage: ChatMessage
  type: 'status-notice'
  notice: ChatHistoryStatusNotice
}

export interface WorkspaceChangesRenderItem {
  anchorId: string
  originalMessage: ChatMessage
  type: 'workspace-changes'
  changes: SessionWorkspaceChanges
}

export type ChatRenderItem =
  | AgentRoomChildRequestItem
  | MessageRenderItem
  | StatusNoticeRenderItem
  | ToolGroupItem
  | WorkspaceChangesRenderItem
