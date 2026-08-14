/* eslint-disable max-lines */

import type { ChannelDeliveryTarget, ChannelNavigationReference } from './channel-runtime'
import type { PermissionInteractionOptionPresentation } from './interaction'

export type AgentRoomStatus = 'active' | 'idle' | 'completed' | 'failed'
export type AgentRoomMemberKind = 'host' | 'entity' | 'task'
export type AgentRoomMemberStatus = 'idle' | 'active' | 'waiting' | 'completed' | 'failed' | 'stopped'
export type AgentRoomMessageRole = 'user' | 'agent' | 'system'
export type AgentRoomRunStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'stopped'
export type AgentRoomEventRequestKind = 'confirmation' | 'input' | 'progress'
export type AgentRoomEventResumeKind = 'message' | 'confirmation' | 'input' | 'permission_recovery'

export interface AgentRoomOwner {
  accountId?: string
  nodeId?: string
  sourceId?: string
  type: 'local'
}

export interface AgentRoom {
  id: string
  title: string
  avatar?: string
  description?: string
  owner: AgentRoomOwner
  leaderEntity?: string
  hostSessionId?: string
  status: AgentRoomStatus
  lastMessage?: string
  archivedAt?: number
  favoritedAt?: number
  createdAt: number
  updatedAt: number
}

export type AgentRoomChannelConnectionStatus = 'active' | 'removed' | 'unavailable'

/**
 * A member-scoped capability for reaching one external conversation.
 * Rooms never own channels directly: the member that contributes the
 * capability remains explicit even when several rooms observe the same chat.
 */
export interface AgentRoomChannelConnection {
  accountLabel?: string
  channelId: string
  channelKey: string
  channelLinkName: string
  channelType: string
  conversationKind: ChannelDeliveryTarget['conversationKind']
  createdAt: number
  entity: string
  label: string
  lastError?: string
  lastSeenAt?: number
  memberKey: string
  muted: boolean
  commandPrefix?: string
  requireMention: boolean
  receiveId: string
  receiveIdType: string
  roomId: string
  status: AgentRoomChannelConnectionStatus
  threadId?: string
  updatedAt: number
}

/** @deprecated Use AgentRoomChannelConnection. */
export type AgentRoomChannelLink = AgentRoomChannelConnection

export type AgentRoomSharePermission =
  | 'approve'
  | 'manage_share'
  | 'open_run'
  | 'send'
  | 'target_member'
  | 'view'

export interface AgentRoomShareGrant {
  createdAt: number
  principalId: string
  principalType: 'team' | 'user'
  permissions: AgentRoomSharePermission[]
  shareId: string
}

export interface AgentRoomShare {
  createdAt: number
  grants: AgentRoomShareGrant[]
  id: string
  publishedAt?: number
  relayRef?: string
  revokedAt?: number
  roomId: string
  status: 'active' | 'revoked'
  updatedAt: number
}

export interface AgentRoomEventMember {
  key: string
  kind: AgentRoomMemberKind
  label: string
  avatar?: string
  subtitle?: string
}

export interface AgentRoomMember extends AgentRoomEventMember {
  roomId: string
  status: AgentRoomMemberStatus
  latestSummary?: string
  activeRunCount: number
  pendingCount: number
  createdAt: number
  updatedAt: number
}

export interface AgentRoomEventRun {
  key: string
  sessionId: string
  title: string
}

export interface AgentRoomRun {
  roomId: string
  key: string
  memberKey: string
  sessionId: string
  title: string
  status: AgentRoomRunStatus
  latestSummary?: string
  interactionId?: string
  requestKind?: AgentRoomEventRequestKind
  options?: AgentRoomInteractionOption[]
  createdAt: number
  updatedAt: number
}

export interface AgentRoomInteractionOption {
  label: string
  value?: string
  description?: string
  permission?: PermissionInteractionOptionPresentation
}

export type AgentRoomInteractionRequestStatus = 'pending' | 'handled' | 'expired'

export type AgentRoomEvent =
  | {
    id?: string
    type: 'member_joined'
    member: AgentRoomEventMember
  }
  | {
    id?: string
    type: 'assignment_sent'
    member: AgentRoomEventMember
    run: AgentRoomEventRun
    summary: string
  }
  | {
    id?: string
    type: 'attention_requested'
    member: AgentRoomEventMember
    run: AgentRoomEventRun
    interactionId?: string
    summary: string
    requestKind: AgentRoomEventRequestKind
    options?: AgentRoomInteractionOption[]
    multiselect?: boolean
  }
  | {
    id?: string
    type: 'run_replied'
    member: AgentRoomEventMember
    run: AgentRoomEventRun
    requestKind: AgentRoomEventRequestKind
    summary: string
  }
  | {
    id?: string
    type: 'run_resumed'
    member: AgentRoomEventMember
    run: AgentRoomEventRun
    resumeKind: AgentRoomEventResumeKind
    summary?: string
  }
  | {
    id?: string
    type: 'run_completed'
    member: AgentRoomEventMember
    run: AgentRoomEventRun
    summary?: string
  }
  | {
    id?: string
    type: 'run_failed'
    member: AgentRoomEventMember
    run: AgentRoomEventRun
    summary: string
  }
  | {
    id?: string
    type: 'run_stopped'
    member: AgentRoomEventMember
    run: AgentRoomEventRun
    summary?: string
  }

export type AgentRoomEventType = AgentRoomEvent['type']

export interface AgentRoomUserMessageTarget {
  memberKey?: string
  runKey?: string
}

export type AgentRoomMessageReactionKind = 'completed' | 'working'

export interface AgentRoomMessageReaction {
  kind: AgentRoomMessageReactionKind
  createdAt?: number
  target?: AgentRoomUserMessageTarget
}

export interface AgentRoomMessageReference {
  id: string
  role: AgentRoomMessageRole
  content: string
  authorLabel?: string
}

export type AgentRoomUserMessageDeliveryKind = 'interaction_response' | 'message'

export interface AgentRoomUserMessageDelivery {
  kind: AgentRoomUserMessageDeliveryKind
  receivedAt: number
  sessionId: string
  target?: AgentRoomUserMessageTarget
}

export interface AgentRoomUserMessagePayload {
  attemptedMemberKeys?: string[]
  delivery?: AgentRoomUserMessageDelivery
  deliveries?: AgentRoomUserMessageDelivery[]
  deliveryErrors?: Array<{ error: string; memberKey: string }>
  deliveryState?: 'delivered' | 'failed' | 'observed' | 'pending'
  replyTo?: AgentRoomMessageReference
  reactions?: AgentRoomMessageReaction[]
  target?: AgentRoomUserMessageTarget
}

export interface AgentRoomMessageOrigin {
  accountId?: string
  accountLabel?: string
  channelId: string
  channelKey: string
  channelLinkName?: string
  channelType: string
  conversationKind: string
  conversationLabel?: string
  navigation?: ChannelNavigationReference
  providerMessageId?: string
  senderDisplayName?: string
  senderId?: string
  threadId?: string
}

export type AgentRoomMessageDeliveryStatus = 'failed' | 'pending' | 'sent'

export interface AgentRoomMessageDelivery {
  error?: string
  id: string
  navigation?: ChannelNavigationReference
  providerMessageId?: string
  roomMessageId: string
  sentAt?: number
  status: AgentRoomMessageDeliveryStatus
  target: ChannelDeliveryTarget
}

export interface AgentRoomMessage {
  id: string
  roomId: string
  role: AgentRoomMessageRole
  memberKey?: string
  runKey?: string
  content: string
  sequence: number
  idempotencyKey?: string
  origin?: AgentRoomMessageOrigin
  deliveries: AgentRoomMessageDelivery[]
  eventType?: AgentRoomEventType
  payload?: AgentRoomEvent | AgentRoomUserMessagePayload | Record<string, unknown>
  createdAt: number
}

export interface AgentRoomDetail {
  room: AgentRoom
  members: AgentRoomMember[]
  runs: AgentRoomRun[]
  messages: AgentRoomMessage[]
  channelConnections: AgentRoomChannelConnection[]
  shares: AgentRoomShare[]
}

export interface AgentRoomListResponse {
  rooms: AgentRoom[]
}
export interface AgentRoomSummary extends AgentRoom {
  activeRunCount: number
  pendingCount: number
  sessionIds: string[]
}
export interface AgentRoomSummaryListResponse {
  rooms: AgentRoomSummary[]
}
export interface AgentRoomHostSessionResponse {
  room?: AgentRoom
}
export interface AgentRoomDetailResponse extends AgentRoomDetail {}
export interface UpdateAgentRoomMetadataRequest {
  avatar?: string | null
  description?: string | null
  isArchived?: boolean
  isFavorited?: boolean
  title?: string
}
export interface UpdateAgentRoomMetadataResponse {
  room: AgentRoom
}
export interface CreateAgentRoomRequest {
  id?: string
  title: string
  hostSessionId?: string
  leaderEntity?: string
  owner?: AgentRoomOwner
}
export interface CreateAgentRoomResponse {
  room: AgentRoom
}
export interface EnsureAgentRoomRequest {
  hostSessionId: string
  title?: string
}
export interface EnsureAgentRoomResponse {
  room: AgentRoom
}
export interface AgentRoomMessageWriteRequest {
  content: string
  idempotencyKey?: string
  origin?: AgentRoomMessageOrigin
  target?: AgentRoomUserMessageTarget
}

export interface RecordAgentRoomChannelDeliveryRequest {
  content: string
  error?: string
  memberKey?: string
  navigation?: ChannelNavigationReference
  providerMessageId?: string
  status: AgentRoomMessageDeliveryStatus
  target: ChannelDeliveryTarget
}

export interface AttachAgentRoomChannelConnectionRequest {
  channelLinkName: string
  commandPrefix?: string
  memberKey: string
  muted?: boolean
  requireMention?: boolean
}

/** @deprecated Use AttachAgentRoomChannelConnectionRequest. */
export type AttachAgentRoomChannelLinkRequest = AttachAgentRoomChannelConnectionRequest

export interface UpdateAgentRoomChannelConnectionRequest {
  channelLinkName: string
  commandPrefix?: string | null
  memberKey: string
  muted?: boolean
  requireMention?: boolean
  status?: AgentRoomChannelConnectionStatus
}

export interface CreateAgentRoomShareRequest {
  grants: Array<{
    principalId: string
    principalType: 'team' | 'user'
    permissions: AgentRoomSharePermission[]
  }>
}

export type AgentRoomCommand =
  | {
    idempotencyKey: string
    type: 'ingest_channel_message'
    message: { content: string; memberKey?: string; origin: AgentRoomMessageOrigin }
  }
  | { idempotencyKey: string; type: 'append_message'; message: AgentRoomMessageWriteRequest }
  | { idempotencyKey: string; type: 'apply_event'; event: AgentRoomEvent }
  | { idempotencyKey: string; type: 'attach_member_channel'; connection: AttachAgentRoomChannelConnectionRequest }
  | { idempotencyKey: string; type: 'update_member_channel'; connection: UpdateAgentRoomChannelConnectionRequest }
  | { idempotencyKey: string; type: 'create_share'; share: CreateAgentRoomShareRequest }
  | { idempotencyKey: string; type: 'revoke_share'; shareId: string }
  | { idempotencyKey: string; type: 'record_delivery'; delivery: AgentRoomMessageDelivery }
  | { idempotencyKey: string; type: 'record_channel_delivery'; delivery: RecordAgentRoomChannelDeliveryRequest }

export interface AgentRoomMessageWriteResponse {
  message: AgentRoomMessage
}
export interface AgentRoomInteractionResponseRequest {
  data: string | string[]
}
export interface AgentRoomInteractionResponseResponse {
  ok: true
}
export interface AgentRoomEventWriteRequest {
  event: AgentRoomEvent
}
export interface AgentRoomEventWriteResponse {
  message: AgentRoomMessage
}
export interface AgentRoomRunWriteRequest {
  run: AgentRoomEventRun & {
    memberKey: string
    status?: AgentRoomRunStatus
    latestSummary?: string
    interactionId?: string
    requestKind?: AgentRoomEventRequestKind
    options?: AgentRoomInteractionOption[]
  }
}
