import type { AdapterOutputEvent, AdapterUsageData, ChatMessageContent } from '@oneworks/types'
import { uuid } from '@oneworks/utils/uuid'

import type { PiRpcEvent } from '../protocol/types'

export const asRecord = (value: unknown): Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
)

export const asNumber = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
)

export const asString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value : undefined
)

export const stringifyPiToolResult = (value: unknown): unknown => {
  const record = asRecord(value)
  const content = Array.isArray(record.content) ? record.content : undefined
  if (content != null) {
    const text = content
      .map(item => asString(asRecord(item).text))
      .filter((item): item is string => item != null)
      .join('\n')
    return text || content
  }
  return value ?? '[Pi tool completed without output]'
}

export const readPiAssistantText = (message: Record<string, unknown>) => (
  (Array.isArray(message.content) ? message.content : [])
    .map(item => asRecord(item))
    .filter(item => item.type === 'text' && typeof item.text === 'string')
    .map(item => item.text as string)
    .join('')
)

export const projectPiUsage = (params: {
  id: string
  model: string
  observedAt: number
  usage: Record<string, unknown>
}): AdapterUsageData => {
  const cost = asRecord(params.usage.cost)
  return {
    id: params.id,
    inputTokens: asNumber(params.usage.input),
    outputTokens: asNumber(params.usage.output),
    cacheReadInputTokens: asNumber(params.usage.cacheRead),
    cacheCreationInputTokens: asNumber(params.usage.cacheWrite),
    reasoningOutputTokens: asNumber(params.usage.reasoning),
    costUsd: asNumber(cost.total),
    aggregationMode: 'delta',
    model: params.model,
    observedAt: params.observedAt,
    quality: 'provider_reported'
  }
}

export const projectPiCompactionUsage = (params: {
  event: PiRpcEvent
  id: string
  model: string
  observedAt: number
}): AdapterUsageData | undefined => {
  const usage = asRecord(asRecord(params.event.result).usage)
  if (Object.keys(usage).length === 0) return undefined
  return projectPiUsage({ id: params.id, model: params.model, observedAt: params.observedAt, usage })
}

export const projectPiToolUse = (event: PiRpcEvent, model: string, createdAt: number): AdapterOutputEvent => {
  const toolCallId = asString(event.toolCallId) ?? uuid()
  const content: ChatMessageContent[] = [{
    type: 'tool_use',
    id: toolCallId,
    name: asString(event.toolName) ?? 'tool',
    input: event.args ?? {}
  }]
  return {
    type: 'message',
    data: { id: `pi-tool-use-${toolCallId}`, role: 'assistant', content, createdAt, model }
  }
}

export const projectPiToolResult = (
  event: PiRpcEvent & { result?: unknown },
  model: string,
  createdAt: number
): AdapterOutputEvent => {
  const toolCallId = asString(event.toolCallId) ?? uuid()
  return {
    type: 'message',
    data: {
      id: `pi-tool-result-${toolCallId}`,
      role: 'assistant',
      content: [{
        type: 'tool_result',
        tool_use_id: toolCallId,
        content: stringifyPiToolResult(event.result),
        is_error: event.isError === true
      }],
      createdAt,
      model
    }
  }
}
