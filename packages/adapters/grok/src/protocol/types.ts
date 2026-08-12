export interface GrokTextContent {
  type: 'text'
  text: string
}

export interface GrokToolUseContent {
  type: 'tool_use'
  id: string
  name: string
  input?: Record<string, unknown>
  args?: Record<string, unknown>
}

export interface GrokToolResultContent {
  type: 'tool_result'
  tool_use_id: string
  content: unknown
  is_error?: boolean
}

export type GrokMessageContent = GrokTextContent | GrokToolUseContent | GrokToolResultContent

export interface GrokSystemInitEvent {
  type: 'system'
  subtype: 'init'
  session_id?: string
  uuid?: string
  model?: string
  version?: string
  cwd?: string
  tools?: unknown[]
  slash_commands?: unknown[]
  agents?: unknown[]
}

export interface GrokMessageEvent {
  type: 'assistant' | 'user'
  uuid?: string
  model?: string
  message?: {
    id?: string
    model?: string
    content?: GrokMessageContent[] | string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }
}

export interface GrokResultEvent {
  type: 'result'
  subtype?: string
  uuid?: string
  session_id?: string
  is_error?: boolean
  result?: string
  errors?: string[]
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
}

export type GrokIncomingEvent = GrokSystemInitEvent | GrokMessageEvent | GrokResultEvent
