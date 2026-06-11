import type {
  AgentRoomEventMember,
  AgentRoomInteractionOption,
  AgentRoomMemberKind,
  ChatMessageContent
} from '@oneworks/core'
import type {
  RuntimeContentItem,
  RuntimeEventType,
  RuntimeInteractionKind,
  RuntimeMeta,
  RuntimeRequestKind,
  RuntimeRole,
  RuntimeStatus,
  RuntimeVisibility
} from '@oneworks/runtime-protocol'
import type { PermissionInteractionContext } from '@oneworks/types'

export type RuntimeEventVisibility = RuntimeVisibility

export type RuntimeSessionMetadata = Partial<RuntimeMeta> & Pick<RuntimeMeta, 'sessionId'> & {
  memberKind?: AgentRoomMemberKind
}

export interface RuntimeSessionState extends Record<string, unknown> {
  sessionId: string
  status?: RuntimeStatus
  title?: string
  lastSeq?: number
  lastMessage?: string
  updatedAt?: number
}

export interface RuntimeEvent extends Record<string, unknown> {
  protocolVersion?: string
  supportedProtocolRange?: string
  id: string
  seq?: number
  ts?: number
  sessionId: string
  type: RuntimeEventType
  visibility?: RuntimeVisibility
  title?: string
  parentSessionId?: string
  status?: RuntimeStatus
  role?: Exclude<RuntimeRole, 'tool'>
  content?: string | RuntimeContentItem[] | ChatMessageContent[]
  summary?: string
  publicSummary?: string
  question?: string
  requestId?: string
  requestKind?: RuntimeRequestKind
  kind?: RuntimeInteractionKind
  options?: AgentRoomInteractionOption[]
  multiselect?: boolean
  permissionContext?: PermissionInteractionContext
  commandId?: string
  causedByCommandId?: string
  source?: string
  sourceLabel?: string
  error?: string
  message?: string
  fatal?: boolean
  adapter?: string
  model?: string
  operationId?: string
  roomId?: string
  roomTitle?: string
  hostSessionId?: string
  memberKey?: string
  memberKind?: AgentRoomMemberKind
  memberLabel?: string
  memberAvatar?: string
  memberSubtitle?: string
  runId?: string
  runTitle?: string
  member?: AgentRoomEventMember
}

export interface RuntimeStoreIndexSession {
  storePath: string
  cwd?: string
  status?: string
  updatedAt?: number
}

export interface RuntimeStoreIndex {
  protocolVersion?: string
  sessions?: Record<string, RuntimeStoreIndexSession>
}

export interface RuntimeSessionStore {
  sessionId: string
  root: string
  storePath: string
  commandsPath: string
  eventsPath: string
  metaPath: string
  statePath: string
}

export interface RuntimeEventCheckpoint {
  offset: number
  lastSeq?: number
}

export interface RuntimeEventReplayResult {
  checkpoint: RuntimeEventCheckpoint
  events: RuntimeEvent[]
}
