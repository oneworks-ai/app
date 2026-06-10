import { describe, expect, it } from 'vitest'

import { TaskRuntimeEngine } from '@oneworks/task-runtime'
import type { RuntimeCommand, RuntimeCommandDispatchResult, RuntimeEvent, RuntimeStatus } from '@oneworks/task-runtime'

interface FakeState {
  pendingInput?: string
  status: RuntimeStatus
}

class FakeTaskRuntimeEngine extends TaskRuntimeEngine<FakeState> {
  public handledCommands: string[] = []
  private states = new Map<string, FakeState>()

  public setState(sessionId: string, state: FakeState) {
    this.states.set(sessionId, state)
  }

  protected async dispatchRuntimeCommand(command: RuntimeCommand): Promise<RuntimeCommandDispatchResult> {
    this.handledCommands.push(command.id)
    const state = this.states.get(command.sessionId) ?? { status: 'pending' }

    if (command.type === 'send_message') {
      state.status = state.status === 'completed' || state.status === 'failed'
        ? 'running'
        : state.status
      this.states.set(command.sessionId, state)
      return {
        status: state.status,
        events: [{
          sessionId: command.sessionId,
          type: 'message',
          role: 'user',
          content: command.message,
          causedByCommandId: command.id,
          visibility: 'room'
        }]
      }
    }

    if (command.type === 'stop') {
      state.status = 'stopped'
      this.states.set(command.sessionId, state)
      return {
        status: 'stopped',
        events: [{
          sessionId: command.sessionId,
          type: 'status_changed',
          status: 'stopped',
          visibility: 'room'
        }]
      }
    }

    if (command.type === 'submit_input') {
      state.pendingInput = undefined
      state.status = 'running'
      this.states.set(command.sessionId, state)
      return {
        status: 'running',
        events: [{
          sessionId: command.sessionId,
          type: 'input_submitted',
          status: 'running',
          visibility: 'audit'
        }]
      }
    }

    state.status = 'running'
    this.states.set(command.sessionId, state)
    return { status: 'running' }
  }

  protected getRuntimeState(sessionId: string) {
    return this.states.get(sessionId)
  }
}

const command = (partial: Record<string, unknown>): RuntimeCommand => ({
  sessionId: 'sess-1',
  source: 'test',
  ...partial
} as RuntimeCommand)

const collectEvents = (engine: FakeTaskRuntimeEngine) => {
  const events: RuntimeEvent[] = []
  engine.onEvent(event => events.push(event))
  return events
}

describe('task runtime engine', () => {
  it('acks send_message and emits a correlated user message event', async () => {
    const engine = new FakeTaskRuntimeEngine()
    const events = collectEvents(engine)

    await engine.applyCommand(command({
      id: 'cmd-send',
      type: 'send_message',
      message: 'continue'
    }))

    expect(events).toEqual([
      expect.objectContaining({
        type: 'command_ack',
        commandId: 'cmd-send',
        sessionId: 'sess-1'
      }),
      expect.objectContaining({
        type: 'message',
        commandId: 'cmd-send',
        causedByCommandId: 'cmd-send',
        content: 'continue',
        role: 'user',
        visibility: 'room'
      })
    ])
  })

  it('handles stop as P0 and cancels lower-priority pending commands in the same batch', async () => {
    const engine = new FakeTaskRuntimeEngine()
    const events = collectEvents(engine)

    await engine.applyCommands([
      command({
        id: 'cmd-message',
        type: 'send_message',
        message: 'this should not dispatch',
        ts: 1
      }),
      command({
        id: 'cmd-stop',
        type: 'stop',
        ts: 2
      })
    ])

    expect(engine.handledCommands).toEqual(['cmd-stop'])
    expect(events).toEqual([
      expect.objectContaining({ type: 'command_ack', commandId: 'cmd-stop' }),
      expect.objectContaining({ type: 'status_changed', commandId: 'cmd-stop', status: 'stopped' }),
      expect.objectContaining({ type: 'command_cancelled', commandId: 'cmd-message' })
    ])
  })

  it('keeps completed or failed send_message resume semantics at command level', async () => {
    const engine = new FakeTaskRuntimeEngine()
    engine.setState('sess-1', { status: 'completed' })

    await engine.applyCommand(command({
      id: 'cmd-resume-message',
      type: 'send_message',
      message: 'resume from summary'
    }))

    expect(engine.getState('sess-1')).toEqual({ status: 'running' })
  })

  it('submits pending input and clears waiting state', async () => {
    const engine = new FakeTaskRuntimeEngine()
    const events = collectEvents(engine)
    engine.setState('sess-1', {
      pendingInput: 'interaction-1',
      status: 'waiting_input'
    })

    await engine.applyCommand(command({
      data: 'allow_once',
      id: 'cmd-submit',
      interactionId: 'interaction-1',
      type: 'submit_input'
    }))

    expect(engine.getState('sess-1')).toEqual({ status: 'running' })
    expect(events).toContainEqual(expect.objectContaining({
      commandId: 'cmd-submit',
      status: 'running',
      type: 'input_submitted'
    }))
  })
})
