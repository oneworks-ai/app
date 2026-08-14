import type { AdapterOutputEvent, ChatMessage } from '@oneworks/types'
import { uuid } from '@oneworks/utils/uuid'

import type { AcpSessionUpdateParams } from '../protocol/types'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const asString = (value: unknown) => typeof value === 'string' && value !== '' ? value : undefined

const normalizeUpdateKind = (value: unknown) => (
  typeof value === 'string' ? value.replaceAll(/[_\s-]/gu, '').toLowerCase() : ''
)

const readContentText = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (!isRecord(value)) return ''
  if (value.type === 'text' && typeof value.text === 'string') return value.text
  if (typeof value.text === 'string') return value.text
  if (Array.isArray(value.content)) return value.content.map(readContentText).join('')
  return ''
}

const readToolOutput = (update: Record<string, unknown>) => {
  if (update.rawOutput != null) return update.rawOutput
  if (update.output != null) return update.output
  if (update.result != null) return update.result
  if (Array.isArray(update.content)) {
    const text = update.content.map(readContentText).join('')
    return text || update.content
  }
  return ''
}

export class KiroEventProjector {
  private readonly assistantChunks = new Map<string, string>()
  private readonly toolCalls = new Set<string>()
  private readonly completedTools = new Set<string>()

  constructor(
    private model: string,
    private readonly onEvent: (event: AdapterOutputEvent) => void
  ) {}

  setModel(model: string) {
    this.model = model
  }

  handle(params: unknown) {
    if (!isRecord(params)) return
    const typed = params as AcpSessionUpdateParams
    const update = isRecord(typed.update) ? typed.update : isRecord(params.notification)
      ? params.notification as Record<string, unknown>
      : params
    const kind = normalizeUpdateKind(
      update.sessionUpdate ?? update.type ?? update.updateType ?? params.updateType
    )
    if (kind === 'agentmessagechunk') {
      const messageId = asString(update.messageId) ?? 'current'
      const text = readContentText(update.content ?? update.prompt ?? update.message)
      if (text !== '') this.assistantChunks.set(messageId, `${this.assistantChunks.get(messageId) ?? ''}${text}`)
      return
    }
    if (kind === 'toolcall') {
      this.emitToolStart(update)
      return
    }
    if (kind === 'toolcallupdate') {
      this.emitToolUpdate(update)
      return
    }
    if (kind === 'sessioninfoupdate') {
      const title = asString(update.title)
      if (title != null) this.onEvent({ type: 'session_update', data: { title } })
      return
    }
    if (kind === 'usageupdate') this.emitUsage(update)
  }

  finishTurn(): ChatMessage | undefined {
    const content = [...this.assistantChunks.values()].join('').trim()
    this.assistantChunks.clear()
    if (content === '') return undefined
    const message: ChatMessage = {
      id: uuid(),
      role: 'assistant',
      content,
      model: this.model,
      createdAt: Date.now()
    }
    this.onEvent({ type: 'message', data: message })
    return message
  }

  interruptCurrentTurn() {
    this.assistantChunks.clear()
  }

  private emitToolStart(update: Record<string, unknown>) {
    const toolCallId = asString(update.toolCallId) ?? asString(update.id) ?? uuid()
    if (this.toolCalls.has(toolCallId)) return
    this.toolCalls.add(toolCallId)
    const title = asString(update.title) ?? asString(update.name) ?? asString(update.kind) ?? 'tool'
    const input = isRecord(update.rawInput) ? update.rawInput : isRecord(update.input) ? update.input : {}
    this.onEvent({
      type: 'message',
      data: {
        id: toolCallId,
        role: 'assistant',
        content: [{ type: 'tool_use', id: toolCallId, name: `adapter:kiro:${title}`, input }],
        createdAt: Date.now()
      }
    })
    this.onEvent({
      type: 'operation',
      data: {
        type: 'operation_started',
        operationId: toolCallId,
        adapter: 'kiro',
        title,
        status: asString(update.status)
      }
    })
  }

  private emitToolUpdate(update: Record<string, unknown>) {
    const toolCallId = asString(update.toolCallId) ?? asString(update.id)
    if (toolCallId == null) return
    if (!this.toolCalls.has(toolCallId)) this.emitToolStart(update)
    const status = asString(update.status)?.toLowerCase()
    if (status !== 'completed' && status !== 'failed' && status !== 'error') return
    if (this.completedTools.has(toolCallId)) return
    this.completedTools.add(toolCallId)
    const isError = status === 'failed' || status === 'error'
    this.onEvent({
      type: 'message',
      data: {
        id: `${toolCallId}:result`,
        role: 'assistant',
        content: [{
          type: 'tool_result',
          tool_use_id: toolCallId,
          content: readToolOutput(update),
          ...(isError ? { is_error: true } : {})
        }],
        createdAt: Date.now()
      }
    })
    this.onEvent({
      type: 'operation',
      data: {
        type: isError ? 'operation_failed' : 'operation_completed',
        operationId: toolCallId,
        adapter: 'kiro',
        status,
        ...(isError ? { error: asString(update.error) ?? 'Kiro tool call failed.' } : {})
      }
    })
  }

  private emitUsage(update: Record<string, unknown>) {
    const inputTokens = Number(update.inputTokens ?? update.input_tokens)
    const outputTokens = Number(update.outputTokens ?? update.output_tokens)
    if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return
    this.onEvent({
      type: 'usage',
      data: {
        inputTokens,
        outputTokens,
        model: asString(update.model) ?? this.model,
        quality: 'provider_reported'
      }
    })
  }
}
