import type { SessionUpdate, ToolCall, ToolCallUpdate } from '@agentclientprotocol/sdk'

import type { AdapterOutputEvent, ChatMessageContent } from '@oneworks/types'
import { uuid } from '@oneworks/utils/uuid'

interface ProjectedToolCall {
  emittedResult: boolean
  input: unknown
  name: string
}

const asRecord = (value: unknown): Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
)

const stringify = (value: unknown) => {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const renderToolContent = (content: ToolCallUpdate['content']) => (
  (content ?? []).map((item) => {
    if (item.type === 'content') {
      if (item.content.type === 'text') return item.content.text
      if (item.content.type === 'resource') return item.content.resource
      return item.content
    }
    if (item.type === 'diff') return { path: item.path, oldText: item.oldText, newText: item.newText }
    return item
  })
)

export class GooseEventProjector {
  private readonly assistantText = new Map<string, string>()
  private readonly toolCalls = new Map<string, ProjectedToolCall>()

  constructor(
    private readonly model: string,
    private readonly onEvent: (event: AdapterOutputEvent) => void,
    private readonly now = () => Date.now()
  ) {}

  handle(update: SessionUpdate) {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        this.handleAssistantChunk(update)
        break
      case 'tool_call':
        this.handleToolCall(update)
        break
      case 'tool_call_update':
        this.handleToolUpdate(update)
        break
      case 'session_info_update':
        if (update.title !== undefined) {
          this.onEvent({ type: 'session_update', data: { title: update.title ?? undefined } })
        }
        break
      default:
        break
    }
  }

  private handleAssistantChunk(update: Extract<SessionUpdate, { sessionUpdate: 'agent_message_chunk' }>) {
    const messageId = update.messageId ?? `goose-assistant-${uuid()}`
    let content: ChatMessageContent[] | string | undefined
    if (update.content.type === 'text') {
      const text = `${this.assistantText.get(messageId) ?? ''}${update.content.text}`
      this.assistantText.set(messageId, text)
      content = text
    } else if (update.content.type === 'image') {
      content = [{
        type: 'image',
        url: `data:${update.content.mimeType};base64,${update.content.data}`,
        mimeType: update.content.mimeType
      }]
    } else if (update.content.type === 'resource_link') {
      content = [{ type: 'file', path: update.content.uri, name: update.content.name }]
    }
    if (content == null || content === '') return
    this.onEvent({
      type: 'message',
      data: { id: messageId, role: 'assistant', content, createdAt: this.now(), model: this.model }
    })
  }

  private handleToolCall(update: ToolCall) {
    const name = update.name?.trim() || update.kind || update.title || 'tool'
    this.toolCalls.set(update.toolCallId, {
      emittedResult: false,
      input: update.rawInput ?? {},
      name
    })
    this.onEvent({
      type: 'message',
      data: {
        id: `goose-tool-use-${update.toolCallId}`,
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: update.toolCallId,
          name,
          input: asRecord(update.rawInput)
        }],
        createdAt: this.now(),
        model: this.model
      }
    })
    if (update.status === 'completed' || update.status === 'failed') this.emitToolResult(update)
  }

  private handleToolUpdate(update: ToolCallUpdate) {
    const current = this.toolCalls.get(update.toolCallId) ?? {
      emittedResult: false,
      input: update.rawInput ?? {},
      name: update.name?.trim() || update.kind || update.title || 'tool'
    }
    if (update.name?.trim()) current.name = update.name.trim()
    if (update.rawInput !== undefined) current.input = update.rawInput
    this.toolCalls.set(update.toolCallId, current)
    if (update.status === 'completed' || update.status === 'failed') this.emitToolResult(update)
  }

  private emitToolResult(update: ToolCallUpdate) {
    const current = this.toolCalls.get(update.toolCallId)
    if (current?.emittedResult === true) return
    if (current != null) current.emittedResult = true
    const renderedContent = update.rawOutput ?? renderToolContent(update.content)
    this.onEvent({
      type: 'message',
      data: {
        id: `goose-tool-result-${update.toolCallId}`,
        role: 'assistant',
        content: [{
          type: 'tool_result',
          tool_use_id: update.toolCallId,
          content: stringify(renderedContent),
          ...(update.status === 'failed' ? { is_error: true } : {})
        }],
        createdAt: this.now(),
        model: this.model
      }
    })
  }
}
