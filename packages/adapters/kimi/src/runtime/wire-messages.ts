/* eslint-disable max-lines */

import type { ChatMessage } from '@oneworks/core'
import type { AdapterMessageContent, AdapterQueryOptions } from '@oneworks/types'
import { uuid } from '@oneworks/utils/uuid'

export type KimiWireContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; id?: string } }
  | { type: 'audio_url'; audio_url: { url: string; id?: string } }
  | { type: 'video_url'; video_url: { url: string; id?: string } }

export type KimiWireUserInput = string | KimiWireContentPart[]

type EmitEvent = AdapterQueryOptions['onEvent']

interface PendingToolCall {
  id: string
  name: string
  input: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const asRecord = (value: unknown): Record<string, unknown> => (
  isRecord(value) ? value : {}
)

const nonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value : undefined
)

const parseArguments = (value: unknown): unknown => {
  if (isRecord(value)) return value
  if (typeof value !== 'string' || value.trim() === '') return {}

  try {
    const parsed = JSON.parse(value) as unknown
    return parsed != null ? parsed : {}
  } catch {
    return { raw: value }
  }
}

const isEmptyRecord = (value: unknown) => isRecord(value) && Object.keys(value).length === 0

const preferInput = (primary: unknown, fallback: unknown) => (
  isEmptyRecord(primary) && !isEmptyRecord(fallback) ? fallback : primary
)

const mergeToolInput = (base: unknown, override: unknown) => {
  if (override == null || isEmptyRecord(override)) return base
  if (isEmptyRecord(base)) return override
  if (isRecord(base) && isRecord(override)) return { ...base, ...override }
  return override
}

const stringifyUnknown = (value: unknown) => {
  if (typeof value === 'string') return value
  if (value == null) return ''

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const contentPartsToText = (parts: unknown[]) => (
  parts
    .map(item => {
      const part = asRecord(item)
      if (part.type === 'text') return nonEmptyString(part.text)
      if (part.type === 'think') return nonEmptyString(part.think)
      if (part.type === 'image_url') return '[Image]'
      if (part.type === 'audio_url') return '[Audio]'
      if (part.type === 'video_url') return '[Video]'
      return undefined
    })
    .filter((item): item is string => item != null && item !== '')
    .join('')
)

const displayBlocksToText = (blocks: unknown[]) => (
  blocks
    .map(block => {
      const item = asRecord(block)
      if (item.type === 'brief' && typeof item.text === 'string') return item.text
      if (item.type === 'diff') {
        const path = nonEmptyString(item.path)
        const oldText = typeof item.old_text === 'string' ? item.old_text : ''
        const newText = typeof item.new_text === 'string' ? item.new_text : ''
        return [
          path != null ? `Diff: ${path}` : 'Diff',
          oldText !== '' ? `Before:\n${oldText}` : undefined,
          newText !== '' ? `After:\n${newText}` : undefined
        ].filter((value): value is string => value != null).join('\n')
      }
      if (item.type === 'todo' && Array.isArray(item.items)) {
        return item.items.map(todo => {
          const todoItem = asRecord(todo)
          const title = nonEmptyString(todoItem.title)
          if (title == null) return undefined
          const status = nonEmptyString(todoItem.status)
          return status != null ? `${status}: ${title}` : title
        }).filter((value): value is string => value != null).join('\n')
      }
      if (item.type === 'background_task') {
        return [
          nonEmptyString(item.status),
          nonEmptyString(item.task_id),
          nonEmptyString(item.description)
        ].filter((value): value is string => value != null).join(' ')
      }
      if (typeof item.text === 'string') return item.text
      if (typeof item.command === 'string') return item.command
      if (typeof item.path === 'string') return item.path
      if (Array.isArray(item.items)) return stringifyUnknown(item.items)
      return undefined
    })
    .filter((item): item is string => item != null && item !== '')
    .join('\n')
)

const normalizeToolReturnContent = (returnValue: Record<string, unknown>) => {
  const output = returnValue.output
  if (Array.isArray(output)) {
    const text = contentPartsToText(output)
    if (text !== '') return text
  } else if (output != null) {
    const text = stringifyUnknown(output)
    if (text !== '') return text
  }

  const message = nonEmptyString(returnValue.message)
  if (message != null) return message

  const display = Array.isArray(returnValue.display) ? displayBlocksToText(returnValue.display) : ''
  return display !== '' ? display : '[done]'
}

const messageBase = (model?: string) => ({
  id: uuid(),
  role: 'assistant' as const,
  createdAt: Date.now(),
  ...(model != null ? { model } : {})
})

const parseToolCallInput = (payload: Record<string, unknown>, functionPayload: Record<string, unknown>) => {
  const candidates = [
    functionPayload.arguments,
    payload.arguments,
    payload.args,
    payload.input
  ]

  return candidates.reduce<unknown>(
    (current, candidate) => preferInput(current, parseArguments(candidate)),
    {}
  )
}

const cleanRecord = (value: Record<string, unknown>) => (
  Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue != null)
  )
)

const displayBlockToInput = (item: Record<string, unknown>) => {
  if (item.type === 'shell' && typeof item.command === 'string') {
    return cleanRecord({
      command: item.command,
      language: nonEmptyString(item.language)
    })
  }

  if (item.type === 'diff') {
    return cleanRecord({
      path: nonEmptyString(item.path),
      old_text: typeof item.old_text === 'string' ? item.old_text : undefined,
      new_text: typeof item.new_text === 'string' ? item.new_text : undefined,
      old_start: typeof item.old_start === 'number' ? item.old_start : undefined,
      new_start: typeof item.new_start === 'number' ? item.new_start : undefined,
      is_summary: typeof item.is_summary === 'boolean' ? item.is_summary : undefined
    })
  }

  if (item.type === 'todo' && Array.isArray(item.items)) {
    return {
      items: item.items
        .map(todo => cleanRecord(asRecord(todo)))
        .filter(todo => Object.keys(todo).length > 0)
    }
  }

  if (item.type === 'background_task') {
    return cleanRecord({
      task_id: nonEmptyString(item.task_id),
      kind: nonEmptyString(item.kind),
      status: nonEmptyString(item.status),
      description: nonEmptyString(item.description)
    })
  }

  if (item.type === 'brief' && typeof item.text === 'string') {
    return { brief: item.text }
  }

  return cleanRecord(item)
}

const extractBacktickedText = (value: unknown) => {
  const text = nonEmptyString(value)
  const match = text?.match(/`([^`]+)`/u)
  return match?.[1] == null || match[1] === '' ? undefined : match[1]
}

const extractDiffToolInput = (
  display: Array<Record<string, unknown>>,
  payload: Record<string, unknown>
) => {
  const diffs = display
    .filter(item => item.type === 'diff')
    .map(displayBlockToInput)
    .filter(diff => Object.keys(diff).length > 0)
  if (diffs.length === 0) return undefined

  const firstDiff = diffs[0]
  const path = nonEmptyString(firstDiff?.path) ?? extractBacktickedText(payload.description)
  return cleanRecord({
    path,
    ...(diffs.length === 1 ? firstDiff : {}),
    diffs
  })
}

const extractTodoToolInput = (display: Array<Record<string, unknown>>) => {
  const todoDisplay = display.find(item => item.type === 'todo' && Array.isArray(item.items))
  if (todoDisplay == null) return undefined
  return displayBlockToInput(todoDisplay)
}

const extractBackgroundToolInput = (display: Array<Record<string, unknown>>) => {
  const backgroundDisplay = display.find(item => item.type === 'background_task')
  if (backgroundDisplay == null) return undefined
  return displayBlockToInput(backgroundDisplay)
}

export const extractKimiWireApprovalToolInput = (payload: Record<string, unknown>) => {
  const display = Array.isArray(payload.display) ? payload.display.map(asRecord) : []
  const shellDisplay = display.find(item => item.type === 'shell' && typeof item.command === 'string')
  if (shellDisplay != null) {
    return displayBlockToInput(shellDisplay)
  }

  const description = nonEmptyString(payload.description)
  const command = extractBacktickedText(description)
  if (payload.sender === 'Shell' && command != null) {
    return { command }
  }

  const diffInput = extractDiffToolInput(display, payload)
  if (diffInput != null) return diffInput

  const todoInput = extractTodoToolInput(display)
  if (todoInput != null) return todoInput

  const backgroundInput = extractBackgroundToolInput(display)
  if (backgroundInput != null) return backgroundInput

  const path = extractBacktickedText(description)
  if (
    path != null &&
    (payload.sender === 'ReadFile' ||
      payload.sender === 'ReadMediaFile' ||
      payload.sender === 'WriteFile' ||
      payload.sender === 'StrReplaceFile')
  ) {
    return { path }
  }

  if (display.length > 0) {
    return {
      display: display.map(displayBlockToInput)
    }
  }

  return {}
}

export class KimiWireMessageState {
  private textBuffer = ''
  private lastMessage: ChatMessage | undefined
  private pendingToolCalls = new Map<string, PendingToolCall>()

  appendText(text: string): void {
    this.textBuffer += text
  }

  flushText(model: string | undefined, onEvent: EmitEvent): ChatMessage | undefined {
    if (this.textBuffer.trim() === '') {
      this.textBuffer = ''
      return undefined
    }

    const message: ChatMessage = {
      ...messageBase(model),
      content: this.textBuffer
    }
    this.textBuffer = ''
    this.lastMessage = message
    onEvent({ type: 'message', data: message })
    return message
  }

  remember(message: ChatMessage): void {
    this.lastMessage = message
  }

  queueToolCall(toolCall: PendingToolCall): void {
    this.pendingToolCalls.set(toolCall.id, toolCall)
  }

  flushToolCall(
    toolCallId: string,
    model: string | undefined,
    onEvent: EmitEvent,
    inputOverride?: unknown
  ): ChatMessage | undefined {
    const pending = this.pendingToolCalls.get(toolCallId)
    if (pending == null) return undefined

    this.pendingToolCalls.delete(toolCallId)
    const message: ChatMessage = {
      ...messageBase(model),
      id: pending.id,
      content: [{
        type: 'tool_use',
        id: pending.id,
        name: pending.name,
        input: inputOverride == null ? pending.input : mergeToolInput(pending.input, inputOverride)
      }]
    }
    this.remember(message)
    onEvent({ type: 'message', data: message })
    return message
  }

  flushPendingToolCalls(model: string | undefined, onEvent: EmitEvent): void {
    for (const toolCallId of [...this.pendingToolCalls.keys()]) {
      this.flushToolCall(toolCallId, model, onEvent)
    }
  }

  getLastMessage(): ChatMessage | undefined {
    return this.lastMessage
  }
}

export const mapContentToKimiWireInput = (content: AdapterMessageContent[]): KimiWireUserInput | undefined => {
  const parts = content.flatMap((item): KimiWireContentPart[] => {
    if (item.type === 'text') {
      return item.text.trim() === '' ? [] : [{ type: 'text', text: item.text }]
    }
    if (item.type === 'image') {
      return item.url.trim() === ''
        ? []
        : [{
          type: 'image_url',
          image_url: {
            url: item.url,
            ...(item.name?.trim() ? { id: item.name.trim() } : {})
          }
        }]
    }
    if (item.type === 'file') {
      const path = item.path.trim()
      if (path === '') return []
      return [{
        type: 'text',
        text: item.name?.trim()
          ? `Context file: ${item.name.trim()} (${path})`
          : `Context file: ${path}`
      }]
    }
    return []
  })

  if (parts.length === 0) return undefined
  if (parts.length === 1 && parts[0]?.type === 'text') return parts[0].text
  return parts
}

export const handleKimiWireEvent = (
  envelope: Record<string, unknown>,
  state: KimiWireMessageState,
  model: string | undefined,
  onEvent: EmitEvent
): boolean => {
  const type = nonEmptyString(envelope.type)
  const payload = asRecord(envelope.payload)

  if (type === 'ContentPart') {
    if (payload.type === 'text') {
      const text = nonEmptyString(payload.text)
      if (text != null) state.appendText(text)
    }
    return true
  }

  if (type === 'ToolCall') {
    state.flushText(model, onEvent)
    const functionPayload = asRecord(payload.function)
    const toolCallId = nonEmptyString(payload.id)
    const toolName = nonEmptyString(functionPayload.name)
    if (toolCallId == null || toolName == null) return true

    state.queueToolCall({
      id: toolCallId,
      name: toolName,
      input: parseToolCallInput(payload, functionPayload)
    })
    return true
  }

  if (type === 'ToolResult') {
    state.flushText(model, onEvent)
    const toolCallId = nonEmptyString(payload.tool_call_id)
    if (toolCallId == null) return true

    state.flushToolCall(toolCallId, model, onEvent)
    const returnValue = asRecord(payload.return_value)
    const message: ChatMessage = {
      ...messageBase(model),
      content: [{
        type: 'tool_result',
        tool_use_id: toolCallId,
        content: normalizeToolReturnContent(returnValue),
        ...(returnValue.is_error === true ? { is_error: true } : {})
      }]
    }
    state.remember(message)
    onEvent({ type: 'message', data: message })
    return true
  }

  if (type === 'PlanDisplay') {
    state.flushText(model, onEvent)
    const content = nonEmptyString(payload.content)
    if (content == null) return true

    const message: ChatMessage = {
      ...messageBase(model),
      content
    }
    state.remember(message)
    onEvent({ type: 'message', data: message })
    return true
  }

  if (type === 'BtwEnd') {
    const response = nonEmptyString(payload.response)
    const error = nonEmptyString(payload.error)
    const text = response ?? error
    if (text == null) return true
    state.appendText(text)
    return true
  }

  if (type === 'SubagentEvent') {
    const nested = asRecord(payload.event)
    if (Object.keys(nested).length > 0) {
      return handleKimiWireEvent(nested, state, model, onEvent)
    }
    return true
  }

  if (
    type === 'TurnEnd' ||
    type === 'StepBegin' ||
    type === 'StepEnd' ||
    type === 'TokenUsage' ||
    type === 'ToolCallPart' ||
    type === 'ApprovalResponse' ||
    type === 'SteerInput' ||
    type === 'HookTriggered' ||
    type === 'HookResolved' ||
    type === 'Notification' ||
    type === 'MCPLoadingBegin' ||
    type === 'MCPLoadingEnd'
  ) {
    return true
  }

  return false
}
