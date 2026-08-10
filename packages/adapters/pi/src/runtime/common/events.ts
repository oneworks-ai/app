import type { AdapterOutputEvent, ChatMessage } from '@oneworks/types'
import { uuid } from '@oneworks/utils/uuid'

import type { PiRpcEvent } from '../protocol/types'
import {
  asRecord,
  asString,
  projectPiCompactionUsage,
  projectPiToolResult,
  projectPiToolUse,
  projectPiUsage,
  readPiAssistantText
} from './event-values'

export class PiEventProjector {
  private assistantId?: string
  private assistantStartedAt = 0
  private pendingTurnFailure?: string
  private turnInterrupted = false

  constructor(
    private model: string,
    private readonly onEvent: (event: AdapterOutputEvent) => void,
    private readonly now = () => Date.now()
  ) {}

  setModel(model: string) {
    this.model = model
  }

  interruptCurrentTurn() {
    this.turnInterrupted = true
  }

  handle(event: PiRpcEvent) {
    switch (event.type) {
      case 'agent_start':
        this.emitOperation('operation_started', 'Pi started the turn.')
        break
      case 'agent_settled':
        if (this.turnInterrupted) {
          this.emitOperation('operation_completed', 'Pi stopped the interrupted turn.')
          this.onEvent({ type: 'stop' })
        } else if (this.pendingTurnFailure == null) {
          this.emitOperation('operation_completed', 'Pi completed the turn.')
          this.onEvent({ type: 'stop' })
        } else {
          this.emitOperation('operation_failed', this.pendingTurnFailure)
          this.onEvent({ type: 'error', data: { message: this.pendingTurnFailure, fatal: true } })
        }
        this.pendingTurnFailure = undefined
        this.turnInterrupted = false
        break
      case 'message_start':
        if (asRecord(event.message).role === 'assistant') this.startAssistant()
        break
      case 'message_end':
        this.handleMessageEnd(asRecord(event.message))
        break
      case 'tool_execution_start':
        this.onEvent(projectPiToolUse(event, this.model, this.now()))
        break
      case 'tool_execution_update':
        break
      case 'tool_execution_end':
        this.onEvent(projectPiToolResult(event, this.model, this.now()))
        break
      case 'compaction_start':
        this.onEvent({
          type: 'context_compaction',
          data: { id: uuid(), createdAt: this.now(), trigger: asString(event.reason) }
        })
        this.emitOperation('operation_started', 'Pi started context compaction.', 'pi-compaction')
        break
      case 'compaction_end':
        this.emitCompactionUsage(event)
        {
          const failed = event.aborted === true || asString(event.errorMessage) != null
          const message = asString(event.errorMessage) ?? (
            event.aborted === true ? 'Pi context compaction was aborted.' : 'Pi completed context compaction.'
          )
          this.emitOperation(failed ? 'operation_failed' : 'operation_completed', message, 'pi-compaction')
        }
        break
      case 'auto_retry_start':
        this.emitOperation('operation_started', `Pi is retrying (attempt ${String(event.attempt ?? '?')}).`, 'pi-retry')
        break
      case 'auto_retry_end':
        if (event.success === false && asString(event.finalError) != null) {
          this.pendingTurnFailure = asString(event.finalError)
        }
        this.emitOperation(
          event.success === false ? 'operation_failed' : 'operation_completed',
          asString(event.finalError) ?? 'Pi retry completed.',
          'pi-retry'
        )
        break
      case 'session_info_changed':
        this.onEvent({ type: 'session_update', data: { title: asString(event.name) } })
        break
      case 'extension_error':
        this.onEvent({
          type: 'error',
          data: { message: asString(event.error) ?? asString(event.message) ?? 'Pi extension failed.', fatal: false }
        })
        break
    }
  }

  private startAssistant() {
    this.assistantId = `pi-assistant-${uuid()}`
    this.assistantStartedAt = this.now()
  }

  private handleMessageEnd(message: Record<string, unknown>) {
    if (message.role !== 'assistant') return
    if (this.assistantId == null) this.startAssistant()
    const stopReason = asString(message.stopReason)
    const errorMessage = asString(message.errorMessage)
    const failed = stopReason === 'error' || errorMessage != null
    const text = readPiAssistantText(message)
    if (!failed && text !== '') this.onEvent({ type: 'message', data: this.createMessage(text) })
    this.emitUsage(message)
    if (failed) {
      this.pendingTurnFailure = errorMessage ?? 'Pi model request failed.'
    } else {
      this.pendingTurnFailure = undefined
    }
  }

  private createMessage(text: string): ChatMessage {
    return {
      id: this.assistantId ?? `pi-assistant-${uuid()}`,
      role: 'assistant',
      content: text,
      createdAt: this.assistantStartedAt || this.now(),
      model: this.model
    }
  }

  private emitUsage(message: Record<string, unknown>) {
    const usage = asRecord(message.usage)
    if (Object.keys(usage).length === 0) return
    this.onEvent({
      type: 'usage',
      data: projectPiUsage({
        id: asString(message.responseId) ?? uuid(),
        model: `${asString(message.provider) ?? 'pi'}/${asString(message.model) ?? this.model}`,
        observedAt: this.now(),
        usage
      })
    })
  }

  private emitCompactionUsage(event: PiRpcEvent) {
    const usage = projectPiCompactionUsage({ event, id: uuid(), model: this.model, observedAt: this.now() })
    if (usage != null) this.onEvent({ type: 'usage', data: usage })
  }

  private emitOperation(
    type: 'operation_started' | 'operation_completed' | 'operation_failed',
    message: string,
    operationId = 'pi-turn'
  ) {
    this.onEvent({ type: 'operation', data: { type, operationId, message, adapter: 'pi' } })
  }
}
