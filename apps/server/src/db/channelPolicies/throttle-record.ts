import { parseJson } from './json'

export type ChannelPolicyType =
  | 'authorization_request_delivery'
  | 'off_hours_notice'
  | 'muted_mention_notice'
  | 'rate_limit_notice'

export interface ChannelReplyThrottleDbRow {
  throttleKey: string
  policyType: ChannelPolicyType
  channelType: string
  channelId: string
  channelLinkName: string | null
  actorUserId: string | null
  actorAccountId: string | null
  lastSentAt: number
  expiresAt: number | null
  metadataJson: string | null
}

export interface ChannelReplyThrottleRow {
  throttleKey: string
  policyType: ChannelPolicyType
  channelType: string
  channelId: string
  channelLinkName: string | null
  actorUserId: string | null
  actorAccountId: string | null
  lastSentAt: number
  expiresAt: number | null
  metadata: Record<string, unknown> | null
}

export interface ReplyThrottleInput {
  throttleKey: string
  policyType: ChannelPolicyType
  channelType: string
  channelId: string
  channelLinkName?: string | null
  actorUserId?: string | null
  actorAccountId?: string | null
  windowMs: number
  now?: number
  metadata?: Record<string, unknown> | null
}

export function mapThrottleRow(
  row: ChannelReplyThrottleDbRow | undefined
): ChannelReplyThrottleRow | undefined {
  if (row == null) return undefined
  const metadata = parseJson(row.metadataJson)
  return {
    throttleKey: row.throttleKey,
    policyType: row.policyType,
    channelType: row.channelType,
    channelId: row.channelId,
    channelLinkName: row.channelLinkName,
    actorUserId: row.actorUserId,
    actorAccountId: row.actorAccountId,
    lastSentAt: row.lastSentAt,
    expiresAt: row.expiresAt,
    metadata: metadata != null && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata as Record<string, unknown>
      : null
  }
}
