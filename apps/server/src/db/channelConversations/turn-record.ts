import { parseJsonRecord } from './json'

export type ChannelConversationTurnRole = 'inbound' | 'outbound' | 'system'

export interface ChannelConversationTurnDbRow {
  id: string
  conversationStateId: string
  threadKey: string
  channelType: string
  channelKey: string
  channelId: string
  sessionType: string
  channelLinkName: string | null
  entity: string | null
  childRunId: string | null
  actorUserId: string | null
  actorAccountId: string | null
  senderId: string | null
  messageId: string | null
  role: ChannelConversationTurnRole
  text: string | null
  summary: string | null
  createdAt: number
  metadataJson: string | null
}

export interface ChannelConversationTurnRow {
  id: string
  conversationStateId: string
  threadKey: string
  channelType: string
  channelKey: string
  channelId: string
  sessionType: string
  channelLinkName: string | null
  entity: string | null
  childRunId: string | null
  actorUserId: string | null
  actorAccountId: string | null
  senderId: string | null
  messageId: string | null
  role: ChannelConversationTurnRole
  text: string | null
  summary: string | null
  createdAt: number
  metadata: Record<string, unknown> | null
}

export function mapTurnRow(
  row: ChannelConversationTurnDbRow | undefined
): ChannelConversationTurnRow | undefined {
  if (row == null) return undefined
  return {
    id: row.id,
    conversationStateId: row.conversationStateId,
    threadKey: row.threadKey,
    channelType: row.channelType,
    channelKey: row.channelKey,
    channelId: row.channelId,
    sessionType: row.sessionType,
    channelLinkName: row.channelLinkName,
    entity: row.entity,
    childRunId: row.childRunId,
    actorUserId: row.actorUserId,
    actorAccountId: row.actorAccountId,
    senderId: row.senderId,
    messageId: row.messageId,
    role: row.role,
    text: row.text,
    summary: row.summary,
    createdAt: row.createdAt,
    metadata: parseJsonRecord(row.metadataJson)
  }
}
