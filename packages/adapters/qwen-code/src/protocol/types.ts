export interface QwenSystemInitEvent {
  type: 'system'
  subtype: 'init'
  uuid?: string
  session_id?: string
  cwd?: string
  tools?: unknown[]
  mcp_servers?: unknown[]
  model?: string
  permission_mode?: string
  slash_commands?: unknown[]
  qwen_code_version?: string
  agents?: unknown[]
}

export interface QwenContentBlock {
  type?: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  is_error?: boolean
  content?: unknown
}

export interface QwenAssistantEvent {
  type: 'assistant'
  uuid?: string
  session_id?: string
  parent_tool_use_id?: string | null
  message?: {
    id?: string
    model?: string
    content?: QwenContentBlock[]
    usage?: Record<string, unknown>
  }
}

export interface QwenUserEvent {
  type: 'user'
  uuid?: string
  session_id?: string
  parent_tool_use_id?: string | null
  message?: {
    content?: QwenContentBlock[]
  }
}

export interface QwenStreamEvent {
  type: 'stream_event'
  uuid?: string
  session_id?: string
  parent_tool_use_id?: string | null
  event?: {
    type?: string
    index?: number
    content_block?: QwenContentBlock
    delta?: {
      type?: string
      text?: string
      thinking?: string
      partial_json?: string
    }
    message?: {
      id?: string
      model?: string
      usage?: Record<string, unknown>
    }
  }
}

export interface QwenResultEvent {
  type: 'result'
  subtype?: string
  uuid?: string
  session_id?: string
  is_error?: boolean
  result?: unknown
  error?: {
    message?: string
  }
  usage?: Record<string, unknown>
}

export type QwenProtocolEvent =
  | QwenAssistantEvent
  | QwenResultEvent
  | QwenStreamEvent
  | QwenSystemInitEvent
  | QwenUserEvent
