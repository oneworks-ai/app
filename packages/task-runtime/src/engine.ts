import {
  TASK_RUNTIME_PROTOCOL_VERSION,
  TASK_RUNTIME_SUPPORTED_PROTOCOL_RANGE,
  isLifecycleRuntimeCommand,
  normalizeRuntimeCommand,
  sortRuntimeCommands
} from './protocol'
import type { RuntimeCommand, RuntimeEvent, RuntimeEventDraft, RuntimeStatus } from './protocol'

export interface RuntimeCommandDispatchResult {
  events?: RuntimeEventDraft[]
  status?: RuntimeStatus
}

export type RuntimeEventListener = (event: RuntimeEvent) => void

const isRuntimeEventVisibility = (value: unknown): value is RuntimeEvent['visibility'] =>
  value === 'audit' || value === 'private' || value === 'room' || value === 'system'

export abstract class TaskRuntimeEngine<State = unknown> {
  private eventListeners = new Set<RuntimeEventListener>()
  private eventSeq = 0
  private events: RuntimeEvent[] = []

  public onEvent(listener: RuntimeEventListener) {
    this.eventListeners.add(listener)
    return () => {
      this.eventListeners.delete(listener)
    }
  }

  public getEvents() {
    return [...this.events]
  }

  public getState(sessionId: string): State | undefined {
    return this.getRuntimeState(sessionId)
  }

  public async applyCommand(command: RuntimeCommand) {
    const normalizedCommand = normalizeRuntimeCommand(command)
    try {
      const result = await this.dispatchRuntimeCommand(normalizedCommand)
      this.emitRuntimeEvent({
        sessionId: normalizedCommand.sessionId,
        type: 'command_ack',
        commandId: normalizedCommand.id,
        status: result.status
      })
      for (const event of result.events ?? []) {
        this.emitRuntimeEvent({
          ...event,
          commandId: event.commandId ?? normalizedCommand.id,
          sessionId: event.sessionId ?? normalizedCommand.sessionId
        })
      }
      return result
    } catch (error) {
      this.emitRuntimeEvent({
        sessionId: normalizedCommand.sessionId,
        type: 'command_failed',
        commandId: normalizedCommand.id,
        error: error instanceof Error ? error.message : String(error),
        status: 'failed'
      })
      throw error
    }
  }

  public async applyCommands(commands: RuntimeCommand[]) {
    const normalizedCommands = commands.map(command => normalizeRuntimeCommand(command))
    const lifecycleSessions = new Set(
      normalizedCommands
        .filter(isLifecycleRuntimeCommand)
        .map(command => command.sessionId)
    )
    const results: RuntimeCommandDispatchResult[] = []

    for (const command of sortRuntimeCommands(normalizedCommands)) {
      if (!isLifecycleRuntimeCommand(command) && lifecycleSessions.has(command.sessionId)) {
        this.emitRuntimeEvent({
          sessionId: command.sessionId,
          type: 'command_cancelled',
          commandId: command.id,
          reason: 'superseded_by_lifecycle_command',
          status: 'stopped'
        })
        continue
      }
      results.push(await this.applyCommand(command))
    }

    return results
  }

  protected abstract dispatchRuntimeCommand(
    command: RuntimeCommand
  ): Promise<RuntimeCommandDispatchResult>

  protected abstract getRuntimeState(sessionId: string): State | undefined

  protected emitRuntimeEvent(event: RuntimeEventDraft) {
    const nextEvent: RuntimeEvent = {
      ...event,
      protocolVersion: TASK_RUNTIME_PROTOCOL_VERSION,
      supportedProtocolRange: TASK_RUNTIME_SUPPORTED_PROTOCOL_RANGE,
      id: `evt_${this.eventSeq + 1}`,
      seq: ++this.eventSeq,
      ts: Date.now(),
      visibility: isRuntimeEventVisibility(event.visibility) ? event.visibility : 'audit'
    }
    this.events.push(nextEvent)
    for (const listener of this.eventListeners) {
      listener(nextEvent)
    }
    return nextEvent
  }
}
