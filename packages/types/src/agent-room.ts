/* eslint-disable max-lines */

export type AgentRoomStatus = 'active' | 'idle' | 'completed' | 'failed'
export type AgentRoomMemberKind = 'host' | 'entity' | 'task'
export type AgentRoomMemberStatus = 'idle' | 'active' | 'waiting' | 'completed' | 'failed' | 'stopped'
export type AgentRoomMessageRole = 'user' | 'agent' | 'system'
export type AgentRoomRunStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'stopped'
export type AgentRoomEventRequestKind = 'confirmation' | 'input' | 'progress'
export type AgentRoomEventResumeKind = 'message' | 'confirmation' | 'input' | 'permission_recovery'

export interface AgentRoom {
  id: string
  title: string
  hostSessionId?: string
  status: AgentRoomStatus
  lastMessage?: string
  archivedAt?: number
  favoritedAt?: number
  createdAt: number
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
  delivery?: AgentRoomUserMessageDelivery
  replyTo?: AgentRoomMessageReference
  reactions?: AgentRoomMessageReaction[]
  target?: AgentRoomUserMessageTarget
}

export interface AgentRoomMessage {
  id: string
  roomId: string
  role: AgentRoomMessageRole
  memberKey?: string
  runKey?: string
  content: string
  eventType?: AgentRoomEventType
  payload?: AgentRoomEvent | AgentRoomUserMessagePayload | Record<string, unknown>
  createdAt: number
}

export interface AgentRoomDetail {
  room: AgentRoom
  members: AgentRoomMember[]
  runs: AgentRoomRun[]
  messages: AgentRoomMessage[]
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
  isArchived?: boolean
  isFavorited?: boolean
}
export interface UpdateAgentRoomMetadataResponse {
  room: AgentRoom
}
export interface CreateAgentRoomRequest {
  id?: string
  title: string
  hostSessionId?: string
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
  target?: AgentRoomUserMessageTarget
}
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
