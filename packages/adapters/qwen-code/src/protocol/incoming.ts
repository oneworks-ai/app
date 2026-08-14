/* eslint-disable max-lines -- protocol variants remain colocated to preserve event ordering state. */
import type { ChatMessage } from '@oneworks/core'
import type { AdapterOutputEvent } from '@oneworks/types'

import type {
  QwenAssistantEvent,
  QwenContentBlock,
  QwenProtocolEvent,
  QwenResultEvent,
  QwenStreamEvent,
  QwenSystemInitEvent,
  QwenUserEvent
} from './types'

const asRecord = (value: unknown): Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
)

const asStrings = (value: unknown) => (
  Array.isArray(value)
    ? value.flatMap(item => typeof item === 'string' ? [item] : [])
    : []
)

const normalizeToolToken = (value: string) => (
  value
    .split(/[^a-z0-9]+/iu)
    .filter(Boolean)
    .map(token => `${token[0]?.toUpperCase() ?? ''}${token.slice(1)}`)
    .join('') || 'UnknownTool'
)

export const prefixQwenToolName = (name: string) => (
  name.startsWith('adapter:qwen-code:')
    ? name
    : `adapter:qwen-code:${normalizeToolToken(name)}`
)

const toUsageEvent = (usage: Record<string, unknown> | undefined): AdapterOutputEvent | undefined => {
  if (usage == null) return undefined
  const inputTokens = Number(usage.input_tokens ?? usage.inputTokens ?? 0)
  const outputTokens = Number(usage.output_tokens ?? usage.outputTokens ?? 0)
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return undefined
  return {
    type: 'usage',
    data: {
      inputTokens,
      outputTokens,
      cacheReadInputTokens: Number(usage.cache_read_input_tokens ?? usage.cacheReadInputTokens ?? 0) || 0,
      cacheCreationInputTokens: Number(
        usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens ?? 0
      ) || 0,
      aggregationMode: 'cumulative',
      quality: 'provider_reported'
    }
  }
}

const toTextMessage = (params: {
  id: string
  model?: string
  text: string
}): ChatMessage => ({
  id: params.id,
  role: 'assistant',
  content: params.text,
  createdAt: Date.now(),
  ...(params.model == null ? {} : { model: params.model })
})

export interface QwenProjectorResult {
  events: AdapterOutputEvent[]
  resultError?: string
  sessionId?: string
}

export const createQwenProtocolProjector = (fallback: {
  cwd: string
  model?: string
  sessionId: string
}) => {
  let currentMessageId: string | undefined
  let currentModel = fallback.model
  let currentText = ''
  let sawPartialText = false
  let lastAssistantMessage: ChatMessage | undefined

  const projectInit = (event: QwenSystemInitEvent): QwenProjectorResult => ({
    sessionId: event.session_id,
    events: [{
      type: 'init',
      data: {
        uuid: event.session_id ?? event.uuid ?? fallback.sessionId,
        adapter: 'qwen-code',
        model: event.model ?? fallback.model ?? 'default',
        version: event.qwen_code_version ?? 'unknown',
        tools: asStrings(event.tools),
        slashCommands: asStrings(event.slash_commands),
        cwd: event.cwd ?? fallback.cwd,
        agents: asStrings(event.agents)
      }
    }]
  })

  const projectPartial = (record: QwenStreamEvent): QwenProjectorResult => {
    const event = record.event
    if (event?.type === 'message_start') {
      currentMessageId = event.message?.id ?? record.uuid ?? `qwen-${fallback.sessionId}-${Date.now()}`
      currentModel = event.message?.model ?? fallback.model
      currentText = ''
      sawPartialText = false
      return { events: [], sessionId: record.session_id }
    }
    if (event?.type !== 'content_block_delta' || event.delta?.type !== 'text_delta') {
      return { events: [], sessionId: record.session_id }
    }
    const text = event.delta.text ?? ''
    if (text === '') return { events: [], sessionId: record.session_id }
    currentMessageId ??= record.uuid ?? `qwen-${fallback.sessionId}-${Date.now()}`
    currentText += text
    sawPartialText = true
    lastAssistantMessage = toTextMessage({
      id: currentMessageId,
      model: currentModel,
      text: currentText
    })
    return {
      events: [{ type: 'message', data: lastAssistantMessage }],
      sessionId: record.session_id
    }
  }

  const projectToolUse = (block: QwenContentBlock, messageId: string): AdapterOutputEvent | undefined => {
    if (block.type !== 'tool_use') return undefined
    const id = block.id?.trim() || `${messageId}-tool-${Date.now()}`
    return {
      type: 'message',
      data: {
        id,
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id,
          name: prefixQwenToolName(block.name?.trim() || 'unknown_tool'),
          input: block.input ?? {}
        }],
        createdAt: Date.now()
      }
    }
  }

  const projectAssistant = (record: QwenAssistantEvent): QwenProjectorResult => {
    const events: AdapterOutputEvent[] = []
    const messageId = record.message?.id ?? record.uuid ?? `qwen-${fallback.sessionId}-${Date.now()}`
    const text = (record.message?.content ?? [])
      .filter(block => block.type === 'text')
      .map(block => block.text ?? '')
      .join('')
    if (text !== '' && (!sawPartialText || messageId !== currentMessageId)) {
      lastAssistantMessage = toTextMessage({
        id: messageId,
        model: record.message?.model ?? fallback.model,
        text
      })
      events.push({ type: 'message', data: lastAssistantMessage })
    }
    for (const block of record.message?.content ?? []) {
      const toolEvent = projectToolUse(block, messageId)
      if (toolEvent != null) events.push(toolEvent)
    }
    const usage = toUsageEvent(record.message?.usage)
    if (usage != null) events.push(usage)
    return { events, sessionId: record.session_id }
  }

  const projectUser = (record: QwenUserEvent): QwenProjectorResult => {
    const events: AdapterOutputEvent[] = []
    for (const block of record.message?.content ?? []) {
      if (block.type !== 'tool_result') continue
      const toolId = block.tool_use_id?.trim() || `qwen-tool-${Date.now()}`
      events.push({
        type: 'message',
        data: {
          id: record.uuid ?? `tool-result-${toolId}-${Date.now()}`,
          role: 'assistant',
          content: [{
            type: 'tool_result',
            tool_use_id: toolId,
            content: block.content ?? '[Qwen Code tool completed without output]',
            is_error: block.is_error === true
          }],
          createdAt: Date.now()
        }
      })
    }
    return { events, sessionId: record.session_id }
  }

  const projectResult = (record: QwenResultEvent): QwenProjectorResult => {
    const events: AdapterOutputEvent[] = []
    const usage = toUsageEvent(record.usage)
    if (usage != null) events.push(usage)
    const errorRecord = asRecord(record.error)
    const errorMessage = typeof errorRecord.message === 'string'
      ? errorRecord.message
      : record.is_error === true && typeof record.result === 'string'
      ? record.result
      : record.is_error === true
      ? 'Qwen Code reported a result error.'
      : undefined
    return {
      events,
      resultError: errorMessage,
      sessionId: record.session_id
    }
  }

  return {
    getLastAssistantMessage: () => lastAssistantMessage,
    project: (value: unknown): QwenProjectorResult => {
      if (value == null || typeof value !== 'object' || Array.isArray(value)) return { events: [] }
      const record = value as QwenProtocolEvent
      switch (record.type) {
        case 'system':
          return record.subtype === 'init' ? projectInit(record) : { events: [] }
        case 'stream_event':
          return projectPartial(record)
        case 'assistant':
          return projectAssistant(record)
        case 'user':
          return projectUser(record)
        case 'result':
          return projectResult(record)
        default:
          return { events: [] }
      }
    }
  }
}
