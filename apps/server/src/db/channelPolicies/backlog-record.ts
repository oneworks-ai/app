import { parseJson } from './json'

export type ChannelOffhourBacklogStatus = 'pending' | 'leased' | 'processed' | 'failed'

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
  status: ChannelOffhourBacklogStatus
  attempts: number
  leaseOwner: string | null
  leaseExpiresAt: number | null
  lastError: string | null
  digestChildRunId: string | null
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
  status: ChannelOffhourBacklogStatus
  attempts: number
  leaseOwner: string | null
  leaseExpiresAt: number | null
  lastError: string | null
  digestChildRunId: string | null
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
  channelKey?: string
  channelLinkName?: string
  channelType?: string
  channelId?: string
  entity?: string
  limit?: number
  sessionType?: string
  statuses?: readonly ChannelOffhourBacklogStatus[]
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
    processedAt: row.processedAt,
    status: row.status,
    attempts: row.attempts,
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: row.leaseExpiresAt,
    lastError: row.lastError,
    digestChildRunId: row.digestChildRunId
  }
}
