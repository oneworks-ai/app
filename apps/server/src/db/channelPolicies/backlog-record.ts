import { parseJson } from './json'

export interface ChannelOffhourBacklogDbRow {
  id: string
  channelType: string
  channelKey: string
  channelId: string
  sessionType: string
  channelLinkName: string | null
  entity: string | null
  senderId: string | null
  actorUserId: string | null
  messageId: string | null
  text: string | null
  rawJson: string | null
  createdAt: number
  processedAt: number | null
}

export interface ChannelOffhourBacklogRow {
  id: string
  channelType: string
  channelKey: string
  channelId: string
  sessionType: string
  channelLinkName: string | null
  entity: string | null
  senderId: string | null
  actorUserId: string | null
  messageId: string | null
  text: string | null
  raw: unknown
  createdAt: number
  processedAt: number | null
}

export interface OffhourBacklogInput {
  id?: string | null
  channelType: string
  channelKey: string
  channelId: string
  sessionType: string
  channelLinkName?: string | null
  entity?: string | null
  senderId?: string | null
  actorUserId?: string | null
  messageId?: string | null
  text?: string | null
  raw?: unknown
  createdAt?: number
}

export interface OffhourBacklogFilter {
  channelLinkName?: string
  channelType?: string
  channelId?: string
  limit?: number
}

export function mapBacklogRow(
  row: ChannelOffhourBacklogDbRow | undefined
): ChannelOffhourBacklogRow | undefined {
  if (row == null) return undefined
  return {
    id: row.id,
    channelType: row.channelType,
    channelKey: row.channelKey,
    channelId: row.channelId,
    sessionType: row.sessionType,
    channelLinkName: row.channelLinkName,
    entity: row.entity,
    senderId: row.senderId,
    actorUserId: row.actorUserId,
    messageId: row.messageId,
    text: row.text,
    raw: parseJson(row.rawJson),
    createdAt: row.createdAt,
    processedAt: row.processedAt
  }
}
