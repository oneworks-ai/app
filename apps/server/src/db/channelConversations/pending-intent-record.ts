import { parseJsonRecord, parseStringArray } from './json'

export type ChannelPendingIntentKind = 'need_user_input' | 'need_approval' | 'deferred_work' | 'tool_wait'
export type ChannelPendingIntentStatus = 'open' | 'resolved' | 'cancelled' | 'expired'
export type ChannelPendingIntentDelivery = 'dm' | 'ephemeral' | 'public_hint' | 'external_link'

export interface ChannelPendingIntentDbRow {
  id: string
  conversationStateId: string | null
  threadKey: string
  channelType: string
  channelKey: string | null
  channelId: string | null
  sessionType: string | null
  channelLinkName: string | null
  entity: string | null
  ownerUserId: string | null
  ownerAccountId: string | null
  approverUserIdsJson: string | null
  createdByChildRunId: string | null
  authorizationRequestId: string | null
  kind: ChannelPendingIntentKind
  status: ChannelPendingIntentStatus
  requiredAction: string | null
  delivery: ChannelPendingIntentDelivery | null
  deliveryMessageId: string | null
  payloadJson: string | null
  createdAt: number
  updatedAt: number
  expiresAt: number | null
  resolvedAt: number | null
  metadataJson: string | null
}

export interface ChannelPendingIntentRow {
  id: string
  conversationStateId: string | null
  threadKey: string
  channelType: string
  channelKey: string | null
  channelId: string | null
  sessionType: string | null
  channelLinkName: string | null
  entity: string | null
  ownerUserId: string | null
  ownerAccountId: string | null
  approverUserIds: string[]
  createdByChildRunId: string | null
  authorizationRequestId: string | null
  kind: ChannelPendingIntentKind
  status: ChannelPendingIntentStatus
  requiredAction: string | null
  delivery: ChannelPendingIntentDelivery | null
  deliveryMessageId: string | null
  payload: Record<string, unknown> | null
  createdAt: number
  updatedAt: number
  expiresAt: number | null
  resolvedAt: number | null
  metadata: Record<string, unknown> | null
}

export interface PendingIntentInput {
  id?: string | null
  conversationStateId?: string | null
  threadKey: string
  channelType: string
  channelKey?: string | null
  channelId?: string | null
  sessionType?: string | null
  channelLinkName?: string | null
  entity?: string | null
  ownerUserId?: string | null
  ownerAccountId?: string | null
  approverUserIds?: string[] | null
  createdByChildRunId?: string | null
  authorizationRequestId?: string | null
  kind: ChannelPendingIntentKind
  status?: ChannelPendingIntentStatus
  requiredAction?: string | null
  delivery?: ChannelPendingIntentDelivery | null
  deliveryMessageId?: string | null
  payload?: Record<string, unknown> | null
  expiresAt?: number | null
  resolvedAt?: number | null
  metadata?: Record<string, unknown> | null
}

export interface PendingIntentUpdates {
  status?: ChannelPendingIntentStatus
  delivery?: ChannelPendingIntentDelivery | null
  deliveryMessageId?: string | null
  payload?: Record<string, unknown> | null
  expiresAt?: number | null
  resolvedAt?: number | null
  metadata?: Record<string, unknown> | null
}

export interface PendingIntentFilter {
  authorizationRequestId?: string
  channelKey?: string
  channelType?: string
  conversationStateId?: string
  ownerAccountId?: string
  ownerUserId?: string
  threadKey?: string
}

export const PENDING_INTENT_SELECT_FIELDS = `
  id, conversationStateId, threadKey, channelType, channelKey, channelId,
  sessionType, channelLinkName, entity, ownerUserId, ownerAccountId,
  approverUserIdsJson, createdByChildRunId, authorizationRequestId, kind, status,
  requiredAction, delivery, deliveryMessageId, payloadJson, createdAt, updatedAt,
  expiresAt, resolvedAt, metadataJson
`

export function mapPendingIntentRow(
  row: ChannelPendingIntentDbRow | undefined
): ChannelPendingIntentRow | undefined {
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
    ownerUserId: row.ownerUserId,
    ownerAccountId: row.ownerAccountId,
    approverUserIds: parseStringArray(row.approverUserIdsJson),
    createdByChildRunId: row.createdByChildRunId,
    authorizationRequestId: row.authorizationRequestId,
    kind: row.kind,
    status: row.status,
    requiredAction: row.requiredAction,
    delivery: row.delivery,
    deliveryMessageId: row.deliveryMessageId,
    payload: parseJsonRecord(row.payloadJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
    resolvedAt: row.resolvedAt,
    metadata: parseJsonRecord(row.metadataJson)
  }
}
