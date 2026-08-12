import process from 'node:process'

import type { ChatMessage } from '@oneworks/core'
import type { AdapterQueryOptions } from '@oneworks/types'

import { GROK_CLI_VERSION } from '../paths'
import type {
  GrokIncomingEvent,
  GrokMessageContent,
  GrokTextContent,
  GrokToolResultContent,
  GrokToolUseContent
} from './types'

const prefixToolName = (name: string) => (
  name.startsWith('adapter:grok:') ? name : `adapter:grok:${name}`
)

const isContentType = <T extends GrokMessageContent['type']>(
  content: GrokMessageContent,
  type: T
): content is Extract<GrokMessageContent, { type: T }> => content.type === type

const normalizeUsage = (
  usage: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  } | undefined
) => (
  usage == null || usage.input_tokens == null || usage.output_tokens == null
    ? undefined
    : {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      ...(usage.cache_read_input_tokens == null ? {} : { cache_read_input_tokens: usage.cache_read_input_tokens }),
      ...(usage.cache_creation_input_tokens == null
        ? {}
        : { cache_creation_input_tokens: usage.cache_creation_input_tokens })
    }
)

const mapAssistantContent = (content: GrokMessageContent[]) => {
  const mapped: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  > = []
  for (const item of content) {
    if (isContentType(item, 'text')) {
      mapped.push({ type: 'text', text: (item as GrokTextContent).text })
      continue
    }
    if (isContentType(item, 'tool_use')) {
      const tool = item as GrokToolUseContent
      mapped.push({
        type: 'tool_use',
        id: tool.id,
        name: prefixToolName(tool.name),
        input: tool.input ?? tool.args ?? {}
      })
    }
  }
  if (mapped.length === 1 && mapped[0]?.type === 'text') return mapped[0].text
  return mapped
}

export const handleGrokIncomingEvent = (
  data: GrokIncomingEvent,
  onEvent: AdapterQueryOptions['onEvent'],
  effort?: AdapterQueryOptions['effort']
) => {
  if (data.type === 'system' && data.subtype === 'init') {
    onEvent({
      type: 'init',
      data: {
        uuid: data.session_id ?? data.uuid ?? 'grok-session',
        model: data.model ?? 'default',
        effort,
        version: data.version ?? GROK_CLI_VERSION,
        tools: (data.tools ?? []).filter((item): item is string => typeof item === 'string'),
        slashCommands: (data.slash_commands ?? []).filter((item): item is string => typeof item === 'string'),
        cwd: data.cwd ?? process.cwd(),
        agents: (data.agents ?? []).filter((item): item is string => typeof item === 'string')
      }
    })
    return
  }

  if ((data.type === 'assistant' || data.type === 'user') && data.message != null) {
    const content = data.message.content
    const contentList = Array.isArray(content) ? content : []
    if (data.type === 'assistant') {
      const mappedContent = typeof content === 'string' ? content : mapAssistantContent(contentList)
      if (mappedContent === '' || (Array.isArray(mappedContent) && mappedContent.length === 0)) return
      const assistant: ChatMessage = {
        id: data.uuid ?? data.message.id ?? `grok-assistant-${Date.now()}`,
        role: 'assistant',
        content: mappedContent,
        createdAt: Date.now(),
        model: data.message.model ?? data.model,
        usage: normalizeUsage(data.message.usage)
      }
      onEvent({ type: 'message', data: assistant })
      return
    }

    for (
      const item of contentList.filter(
        (entry): entry is GrokToolResultContent => isContentType(entry, 'tool_result')
      )
    ) {
      onEvent({
        type: 'message',
        data: {
          id: data.uuid ?? `grok-tool-result-${item.tool_use_id}-${Date.now()}`,
          role: 'assistant',
          content: [{
            type: 'tool_result',
            tool_use_id: item.tool_use_id,
            content: item.content,
            is_error: item.is_error ?? false
          }],
          createdAt: Date.now()
        }
      })
    }
    return
  }

  if (data.type !== 'result') return
  if (data.subtype === 'error_during_execution' || data.is_error === true) {
    const message = data.result?.trim() || data.errors?.find(item => item.trim() !== '') || 'Grok execution failed.'
    onEvent({
      type: 'error',
      data: {
        message,
        code: 'grok_execution',
        details: {
          sessionId: data.session_id,
          errors: data.errors
        },
        fatal: true
      }
    })
  }

  const stopMessage = data.result == null || data.result === ''
    ? undefined
    : {
      id: data.uuid ?? `grok-result-${Date.now()}`,
      role: 'assistant' as const,
      content: data.result,
      createdAt: Date.now(),
      usage: normalizeUsage(data.usage)
    }
  onEvent({ type: 'stop', data: stopMessage })
}
