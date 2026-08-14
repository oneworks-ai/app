export type ChatMessageContent =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; path?: string; name?: string; size?: number; mimeType?: string }
  | {
    type: 'file'
    path: string
    name?: string
    size?: number
    mimeType?: string
    data?: string
    encoding?: 'base64' | 'utf8'
  }
  | { type: 'tool_use'; id: string; name: string; input: any }
  | { type: 'tool_result'; tool_use_id: string; content: any; is_error?: boolean }

export type RoomEventMemberKind = 'host' | 'entity' | 'task'

export interface RoomEventMember {
  key: string
  kind: RoomEventMemberKind
  label: string
}

export interface RoomEventRun {
  key: string
  sessionId: string
  title: string
}

export type RoomEventRequestKind = 'confirmation' | 'input' | 'progress'
export type RoomEventResumeKind = 'message' | 'confirmation' | 'input' | 'permission_recovery'

export interface RoomEventInteractionOption {
  label: string
  value?: string
  description?: string
}

export type RoomEventMessage =
  | {
    type: 'member_joined'
    member: RoomEventMember
  }
  | {
    type: 'assignment_sent'
    member: RoomEventMember
    run: RoomEventRun
    summary: string
  }
  | {
    type: 'attention_requested'
    member: RoomEventMember
    run: RoomEventRun
    interactionId?: string
    summary: string
    requestKind: RoomEventRequestKind
    options?: RoomEventInteractionOption[]
    multiselect?: boolean
  }
  | {
    type: 'run_replied'
    member: RoomEventMember
    run: RoomEventRun
    requestKind: RoomEventRequestKind
    summary: string
  }
  | {
    type: 'run_resumed'
    member: RoomEventMember
    run: RoomEventRun
    resumeKind: RoomEventResumeKind
    summary?: string
  }
  | {
    type: 'run_completed'
    member: RoomEventMember
    run: RoomEventRun
    summary?: string
  }
  | {
    type: 'run_failed'
    member: RoomEventMember
    run: RoomEventRun
    summary: string
  }

export interface MessageTokenUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  reasoning_output_tokens?: number
  total_cost_usd?: number
  aggregation_mode?: 'cumulative' | 'delta'
  quality?: 'estimated' | 'provider_reported' | 'reported'
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string | ChatMessageContent[]
  roomEvent?: RoomEventMessage
  agentRoom?: {
    source?: string
    sourceLabel?: string
    roomId?: string
    hostSessionId?: string
    memberKey?: string
    runKey?: string
    commandId?: string
    causedByCommandId?: string
  }
  model?: string
  usage?: MessageTokenUsage
  toolCall?: {
    id?: string
    name: string
    args: Record<string, unknown>
    status?: 'pending' | 'success' | 'error'
    output?: unknown
  }
  createdAt: number
}
