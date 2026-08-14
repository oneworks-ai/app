/* eslint-disable max-lines -- Factory notification projection is intentionally centralized. */
import { DocumentSourceSchema } from '@factory/droid-sdk'
import type { AdapterOutputEvent, ChatMessage, ChatMessageContent } from '@oneworks/types'
import { projectEmbeddedDocument } from '@oneworks/utils/embedded-document'

import type { FactoryNotification } from './protocol/types'

const asRecord = (value: unknown): Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
)
const asString = (value: unknown) => typeof value === 'string' ? value : undefined
const asNumber = (value: unknown) => typeof value === 'number' ? value : 0

const createdAt = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e15) {
    return value
  }
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : Date.now()
}

const toolName = (value: unknown) => `adapter:droid:${asString(value) ?? 'unknown'}`

export class DroidEventProjector {
  private readonly textBuffers = new Map<string, string>()
  private readonly emittedBlocks = new Set<string>()
  private readonly terminalTurnIds = new Set<string>()
  private readonly turns: Array<{
    accepted: boolean
    completion?: Record<string, unknown>
    id: number
  }> = []
  private nextTurnId = 1

  constructor(private readonly onEvent: (event: AdapterOutputEvent) => void) {}

  reserveTurn() {
    const token = { id: this.nextTurnId++ }
    this.turns.push({ accepted: false, id: token.id })
    return token
  }

  acceptTurn(token: { id: number }) {
    const turn = this.turns.find(item => item.id === token.id)
    if (turn == null) return
    turn.accepted = true
    this.flushCompletedTurns()
  }

  rejectTurn(token: { id: number }) {
    const index = this.turns.findIndex(item => item.id === token.id)
    if (index < 0) return
    this.turns.splice(index, 1)
    this.flushCompletedTurns()
  }

  settleAcceptedTurns() {
    const pending: typeof this.turns = []
    for (const turn of this.turns) {
      if (!turn.accepted) {
        pending.push(turn)
        continue
      }
      const nativeTurnId = asString(turn.completion?.turnId)
      if (nativeTurnId != null) this.terminalTurnIds.add(nativeTurnId)
      this.onEvent({ type: 'stop' })
    }
    this.turns.splice(0, this.turns.length, ...pending)
  }

  handle(envelope: FactoryNotification) {
    if (envelope.method !== 'droid.session_notification') return
    const params = asRecord(envelope.params)
    const notification = asRecord(params.notification)
    const type = asString(notification.type)

    if (type === 'assistant_text_delta') this.handleTextDelta(notification)
    else if (type === 'assistant_text_complete') this.handleTextComplete(notification)
    else if (type === 'create_message') this.handleMessage(asRecord(notification.message))
    else if (type === 'tool_call') this.handleToolCall(asRecord(notification.toolUse))
    else if (type === 'tool_result') this.handleToolResult(notification)
    else if (type === 'tool_progress_update') this.handleToolProgress(notification)
    else if (type === 'session_title_updated') {
      this.onEvent({ type: 'session_update', data: { title: asString(notification.title) } })
    } else if (type === 'session_compacted') {
      this.onEvent({
        type: 'context_compaction',
        data: { id: asString(notification.summaryId) ?? `droid-compaction-${Date.now()}` }
      })
    } else if (type === 'session_token_usage_changed') {
      this.emitUsage(asRecord(notification.inclusiveTokenUsage ?? notification.tokenUsage), 'cumulative')
    } else if (type === 'agent_turn_completed') {
      this.handleTurnCompleted(notification)
    } else if (type === 'child_session_available') {
      const childSessionId = asString(notification.childSessionId) ?? `unknown-${Date.now()}`
      this.onEvent({
        type: 'operation',
        data: {
          type: 'operation_completed',
          adapter: 'droid',
          operationId: `droid-child:${childSessionId}`,
          status: 'child_session_available',
          title: asString(notification.subagentType) ?? 'Factory Droid subagent',
          summary: asString(notification.description),
          message: childSessionId
        }
      })
    } else if (type === 'error') {
      this.onEvent({
        type: 'error',
        data: { message: asString(notification.message) ?? 'Factory Droid reported an error.', fatal: false }
      })
      this.settleAcceptedTurns()
    } else if (type === 'hook_execution_started' || type === 'hook_execution_completed') {
      this.handleHook(notification, type === 'hook_execution_started')
    }
  }

  private handleTextDelta(notification: Record<string, unknown>) {
    const key = this.blockKey(notification)
    this.textBuffers.set(key, `${this.textBuffers.get(key) ?? ''}${asString(notification.textDelta) ?? ''}`)
  }

  private handleTextComplete(notification: Record<string, unknown>) {
    const key = this.blockKey(notification)
    if (this.emittedBlocks.has(key)) return
    const text = this.textBuffers.get(key) ?? ''
    this.textBuffers.delete(key)
    if (text === '') return
    this.emittedBlocks.add(key)
    this.emitMessage(key, [{ type: 'text', text }])
  }

  private handleMessage(message: Record<string, unknown>) {
    if (message.role !== 'assistant') return
    const messageId = asString(message.id) ?? `droid-message-${Date.now()}`
    const blocks = Array.isArray(message.content) ? message.content.map(asRecord) : []
    blocks.forEach((block, index) => {
      const type = asString(block.type)
      if (type === 'text') {
        const key = `${messageId}:text:${index}`
        if (this.emittedBlocks.has(key)) return
        this.emittedBlocks.add(key)
        this.emitMessage(key, [{ type: 'text', text: asString(block.text) ?? '' }], message)
      } else if (type === 'tool_use') {
        this.handleToolCall(block, message)
      } else if (type === 'tool_result') {
        this.handleToolResult(block, message)
      } else if (type === 'image') {
        const source = asRecord(block.source)
        const mediaType = asString(source.mediaType) ?? 'image/png'
        const data = asString(source.data)
        if (data != null) {
          this.emitUniqueBlock(`${messageId}:image:${index}`, [{
            type: 'image',
            url: `data:${mediaType};base64,${data}`
          }], message)
        }
      } else if (type === 'document') {
        const source = asRecord(block.source)
        const parsed = DocumentSourceSchema.safeParse(source)
        const document = parsed.success
          ? projectEmbeddedDocument({
            data: parsed.data.data,
            encoding: parsed.data.type === 'base64' ? 'base64' : 'utf8',
            mimeType: parsed.data.mediaType,
            name: parsed.data.name
          })
          : undefined
        if (document != null) {
          this.emitUniqueBlock(`${messageId}:document:${index}`, [document], message)
        } else {
          this.onEvent({
            type: 'error',
            data: { message: 'Factory Droid emitted a malformed or oversized document block.', fatal: false }
          })
        }
      }
    })
  }

  private handleToolCall(toolUse: Record<string, unknown>, message?: Record<string, unknown>) {
    const id = asString(toolUse.id) ?? `droid-tool-${Date.now()}`
    const key = `tool-use:${id}`
    this.emitUniqueBlock(key, [{
      type: 'tool_use',
      id,
      name: toolName(toolUse.name),
      input: asRecord(toolUse.input)
    }], message)
  }

  private handleToolResult(result: Record<string, unknown>, message?: Record<string, unknown>) {
    const id = asString(result.toolUseId) ?? 'unknown'
    this.emitUniqueBlock(`tool-result:${id}`, [{
      type: 'tool_result',
      tool_use_id: id,
      content: result.content,
      is_error: result.isError === true
    }], message)
  }

  private handleToolProgress(notification: Record<string, unknown>) {
    const update = asRecord(notification.update)
    const kind = asString(update.type)
    const operationId = `droid-tool:${asString(notification.toolUseId) ?? 'unknown'}`
    this.onEvent({
      type: 'operation',
      data: {
        type: kind === 'error'
          ? 'operation_failed'
          : kind === 'tool_result'
          ? 'operation_completed'
          : 'operation_started',
        adapter: 'droid',
        operationId,
        title: asString(notification.toolName),
        status: asString(update.status) ?? kind,
        message: asString(update.text) ?? asString(update.details) ?? asString(update.error),
        error: asString(update.error)
      }
    })
  }

  private handleTurnCompleted(notification: Record<string, unknown>) {
    const nativeTurnId = asString(notification.turnId)
    if (nativeTurnId != null && this.terminalTurnIds.has(nativeTurnId)) return
    const turn = this.turns.find(item => item.completion == null)
    if (turn == null) return
    turn.completion = notification
    if (nativeTurnId != null) this.terminalTurnIds.add(nativeTurnId)
    this.flushCompletedTurns()
  }

  private flushCompletedTurns() {
    while (this.turns[0]?.accepted === true && this.turns[0].completion != null) {
      const turn = this.turns.shift()!
      const notification = turn.completion!
      this.emitTurnCompleted(notification)
    }
  }

  private emitTurnCompleted(notification: Record<string, unknown>) {
    this.emitUsage(
      asRecord(notification.cumulativeTokenUsage ?? notification.tokenUsage),
      notification.cumulativeTokenUsage == null ? 'delta' : 'cumulative'
    )
    const reason = asString(notification.reason)
    if (reason != null && !['completed', 'interrupted', 'cancelled', 'stop'].includes(reason)) {
      this.onEvent({
        type: 'error',
        data: { message: `Factory Droid turn ended with reason: ${reason}.`, fatal: false }
      })
    }
    this.onEvent({ type: 'stop' })
  }

  private handleHook(notification: Record<string, unknown>, started: boolean) {
    const hookName = asString(notification.hookEventName) ?? asString(notification.hookName) ?? 'hook'
    this.onEvent({
      type: 'operation',
      data: {
        type: started ? 'operation_started' : 'operation_completed',
        adapter: 'droid',
        operationId: `droid-hook:${asString(notification.hookId) ?? hookName}`,
        title: hookName,
        status: started ? 'running' : 'completed'
      }
    })
  }

  private emitUsage(usage: Record<string, unknown>, aggregationMode: 'cumulative' | 'delta') {
    this.onEvent({
      type: 'usage',
      data: {
        aggregationMode,
        inputTokens: asNumber(usage.inputTokens),
        outputTokens: asNumber(usage.outputTokens),
        cacheCreationInputTokens: asNumber(usage.cacheCreationTokens),
        cacheReadInputTokens: asNumber(usage.cacheReadTokens),
        reasoningOutputTokens: asNumber(usage.thinkingTokens),
        quality: 'provider_reported'
      }
    })
  }

  private blockKey(notification: Record<string, unknown>) {
    return `${asString(notification.messageId) ?? 'unknown'}:text:${asNumber(notification.blockIndex)}`
  }

  private emitUniqueBlock(
    key: string,
    content: ChatMessageContent[],
    source?: Record<string, unknown>
  ) {
    if (this.emittedBlocks.has(key)) return
    this.emittedBlocks.add(key)
    this.emitMessage(key, content, source)
  }

  private emitMessage(
    id: string,
    content: ChatMessageContent[],
    source?: Record<string, unknown>
  ) {
    if (content.length === 1 && content[0]?.type === 'text' && content[0].text === '') return
    const message: ChatMessage = {
      id,
      role: 'assistant',
      content,
      createdAt: createdAt(source?.createdAt)
    }
    this.onEvent({ type: 'message', data: message })
  }
}
