import type { ReactNode } from 'react'

import type {
  AgentRoomEventRequestKind,
  AgentRoomInteractionOption,
  AgentRoomInteractionRequestStatus,
  AgentRoomMemberKind
} from '@oneworks/core'

export type AgentRoomLayoutMode = 'desktop' | 'compact' | 'responsive'

export type AgentRoomStatus = 'active' | 'waiting' | 'completed' | 'failed' | 'idle'

export type AgentRoomMemberStatus = 'active' | 'waiting' | 'idle' | 'completed' | 'failed' | 'stopped'

export type AgentRoomRunStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'stopped'

export type AgentRoomMessageKind =
  | 'message'
  | 'assignment'
  | 'attention'
  | 'reply'
  | 'completion'
  | 'failure'
  | 'system'

export interface AgentRoomActionOption {
  label: string
  value?: string
  description?: string
}

export interface AgentRoomInteractionRequestView {
  sessionId: string
  interactionId: string
  requestKind: AgentRoomEventRequestKind
  status: AgentRoomInteractionRequestStatus
  options: AgentRoomInteractionOption[]
  response?: string | string[]
  subjectLabel?: string
}

export type AgentRoomMessageReactionKind = 'completed' | 'working'

export interface AgentRoomMessageReactionView {
  kind: AgentRoomMessageReactionKind
  agentLabel?: string
  isHost?: boolean
  run?: AgentRoomRunView
}

export interface AgentRoomMessageReferenceView {
  id: string
  role: 'user' | 'agent' | 'system'
  content: string
  authorLabel?: string
}

export interface AgentRoomSystemMessageView {
  kind: 'memberJoined'
  memberLabel: string
}

export interface AgentRoomApprovalBatchItemView {
  id: string
  content: string
  createdAtLabel?: string
  interactionId?: string
  status: 'pending' | 'handled'
  optionLabels: string[]
}

export interface AgentRoomApprovalBatchActionView {
  id: string
  content: string
  createdAtLabel?: string
  interactionIds: string[]
}

export interface AgentRoomApprovalBatchView {
  totalCount: number
  pendingCount: number
  handledCount: number
  actionCount: number
  memberLabel: string
  runTitle: string
  latest: AgentRoomApprovalBatchItemView
  items: AgentRoomApprovalBatchItemView[]
  actions: AgentRoomApprovalBatchActionView[]
}

export interface AgentRoomRunView {
  runKey: string
  memberKey: string
  sessionId: string
  title: string
  status: AgentRoomRunStatus
  latestSummary?: string
  interactionId?: string
  pendingCount?: number
  updatedAtLabel?: string
}

export interface AgentRoomMemberView {
  memberKey: string
  kind?: AgentRoomMemberKind
  label: string
  subtitle?: string
  avatarLabel?: string
  status: AgentRoomMemberStatus
  pendingCount: number
  activeRunCount: number
  latestSummary?: string
  runs: AgentRoomRunView[]
}

export interface AgentRoomMessageSource {
  id: string
  role: 'user' | 'agent' | 'system'
  kind: AgentRoomMessageKind
  content: ReactNode
  memberKey?: string
  runKey?: string
  createdAtLabel?: string
  replyTo?: AgentRoomMessageReferenceView
  systemMessage?: AgentRoomSystemMessageView
  targetLabel?: string
  options?: AgentRoomActionOption[]
  reactions?: AgentRoomMessageReactionView[]
  approvalBatch?: AgentRoomApprovalBatchView
  interactionRequest?: AgentRoomInteractionRequestView
}

export interface AgentRoomMessageView extends AgentRoomMessageSource {
  member?: AgentRoomMemberView
  run?: AgentRoomRunView
}

export interface AgentRoomViewModel {
  id: string
  title: string
  subtitle?: string
  status: AgentRoomStatus
  members: AgentRoomMemberView[]
  messages: AgentRoomMessageSource[]
  updatedAtLabel?: string
}

export interface AgentRoomComputedViewModel extends Omit<AgentRoomViewModel, 'messages'> {
  messages: AgentRoomMessageView[]
  attentionCount: number
  runningRunCount: number
  completedRunCount: number
  failedRunCount: number
}
