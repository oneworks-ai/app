import { parseJsonRecord, parseStringArray } from './json'

export interface ChannelConversationStateDbRow {
  id: string
  channelType: string
  channelKey: string
  channelId: string
  sessionType: string
  channelLinkName: string | null
  entity: string | null
  threadKey: string
  topic: string | null
  summary: string | null
  activeParticipantsJson: string | null
  recentTurnIdsJson: string | null
  pendingIntentIdsJson: string | null
  lastChildRunId: string | null
  lastMessageId: string | null
  createdAt: number
  updatedAt: number
  expiresAt: number | null
  metadataJson: string | null
}

export interface ChannelConversationStateRow {
  id: string
  channelType: string
  channelKey: string
  channelId: string
  sessionType: string
  channelLinkName: string | null
  entity: string | null
  threadKey: string
  topic: string | null
  summary: string | null
  activeParticipants: string[]
  recentTurnIds: string[]
  pendingIntentIds: string[]
  lastChildRunId: string | null
  lastMessageId: string | null
  createdAt: number
  updatedAt: number
  expiresAt: number | null
  metadata: Record<string, unknown> | null
}

export function mapStateRow(
  row: ChannelConversationStateDbRow | undefined
): ChannelConversationStateRow | undefined {
  if (row == null) return undefined
  return {
    id: row.id,
    channelType: row.channelType,
    channelKey: row.channelKey,
    channelId: row.channelId,
    sessionType: row.sessionType,
    channelLinkName: row.channelLinkName,
    entity: row.entity,
    threadKey: row.threadKey,
    topic: row.topic,
    summary: row.summary,
    activeParticipants: parseStringArray(row.activeParticipantsJson),
    recentTurnIds: parseStringArray(row.recentTurnIdsJson),
    pendingIntentIds: parseStringArray(row.pendingIntentIdsJson),
    lastChildRunId: row.lastChildRunId,
    lastMessageId: row.lastMessageId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
    metadata: parseJsonRecord(row.metadataJson)
  }
}
