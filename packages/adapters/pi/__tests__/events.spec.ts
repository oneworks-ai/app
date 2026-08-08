import { describe, expect, it } from 'vitest'

import type { AdapterOutputEvent } from '@oneworks/types'

import { PiEventProjector } from '#~/runtime/common/events.js'

describe('pi event projector', () => {
  it('streams one assistant message id and projects tools, usage, compaction, and settle', () => {
    const events: AdapterOutputEvent[] = []
    const projector = new PiEventProjector('default', event => events.push(event), () => 1234)
    projector.setModel('openai/gpt-test')
    projector.handle({ type: 'agent_start' })
    projector.handle({ type: 'message_start', message: { role: 'assistant', content: [] } })
    projector.handle({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello' }
    })
    projector.handle({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: ' world' }
    })
    projector.handle({
      type: 'tool_execution_start',
      toolCallId: 'call-1',
      toolName: 'read',
      args: { path: 'README.md' }
    })
    projector.handle({
      type: 'tool_execution_update',
      toolCallId: 'call-1',
      toolName: 'read',
      partialResult: { content: [{ type: 'text', text: 'partial' }] }
    })
    projector.handle({
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      toolName: 'read',
      result: { content: [{ type: 'text', text: 'ok' }] },
      isError: false
    })
    projector.handle({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello world' }],
        provider: 'openai',
        model: 'gpt-test',
        responseId: 'response-1',
        stopReason: 'stop',
        usage: {
          input: 10,
          output: 5,
          cacheRead: 2,
          cacheWrite: 1,
          reasoning: 3,
          cost: { total: 0.01 }
        }
      }
    })
    projector.handle({ type: 'compaction_start', reason: 'threshold' })
    projector.handle({
      type: 'compaction_end',
      reason: 'threshold',
      result: { usage: { input: 4, output: 2, cacheRead: 1, cacheWrite: 0, cost: { total: 0.004 } } },
      aborted: false,
      willRetry: false
    })
    projector.handle({ type: 'agent_settled' })

    const assistantMessages = events.filter(event => event.type === 'message' && typeof event.data.content === 'string')
    expect(new Set(assistantMessages.map(event => event.type === 'message' ? event.data.id : ''))).toHaveLength(1)
    expect(assistantMessages.at(-1)).toMatchObject({ type: 'message', data: { content: 'Hello world' } })
    expect(events.filter(event => (
      event.type === 'message' &&
      Array.isArray(event.data.content) &&
      event.data.content.some(content => content.type === 'tool_result')
    ))).toHaveLength(1)
    expect(events.filter(event => event.type === 'message').every(event => event.data.model === 'openai/gpt-test'))
      .toBe(
        true
      )
    expect(events).toContainEqual(expect.objectContaining({
      type: 'usage',
      data: expect.objectContaining({
        inputTokens: 10,
        outputTokens: 5,
        reasoningOutputTokens: 3,
        costUsd: 0.01
      })
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'usage',
      data: expect.objectContaining({
        inputTokens: 4,
        outputTokens: 2,
        costUsd: 0.004,
        model: 'openai/gpt-test'
      })
    }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'context_compaction' }))
    expect(events).toContainEqual({ type: 'stop' })
  })

  it('projects a terminal model failure without later completing the failed turn', () => {
    const events: AdapterOutputEvent[] = []
    const projector = new PiEventProjector('openai/gpt-test', event => events.push(event), () => 1234)

    projector.handle({ type: 'agent_start' })
    projector.handle({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        errorMessage: 'authentication failed'
      }
    })
    projector.handle({ type: 'agent_settled' })

    expect(events).toContainEqual(expect.objectContaining({
      type: 'operation',
      data: expect.objectContaining({ type: 'operation_failed', message: 'authentication failed' })
    }))
    expect(events).toContainEqual({
      type: 'error',
      data: { message: 'authentication failed', fatal: true }
    })
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'operation',
      data: expect.objectContaining({ type: 'operation_completed' })
    }))
    expect(events).not.toContainEqual({ type: 'stop' })
  })

  it('waits through Pi auto-retry before deciding whether the turn failed', () => {
    const events: AdapterOutputEvent[] = []
    const projector = new PiEventProjector('openai/gpt-test', event => events.push(event), () => 1234)

    projector.handle({ type: 'agent_start' })
    projector.handle({
      type: 'message_end',
      message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'rate limited' }
    })
    expect(events.some(event => event.type === 'error')).toBe(false)
    projector.handle({
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 10,
      errorMessage: 'rate limited'
    })
    projector.handle({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Recovered' }],
        stopReason: 'stop'
      }
    })
    projector.handle({ type: 'auto_retry_end', success: true, attempt: 1 })
    projector.handle({ type: 'agent_settled' })

    expect(events.some(event => event.type === 'error')).toBe(false)
    expect(events).toContainEqual({ type: 'stop' })
    expect(events).toContainEqual(expect.objectContaining({
      type: 'operation',
      data: expect.objectContaining({ type: 'operation_completed', operationId: 'pi-turn' })
    }))
  })

  it('settles a user-interrupted retry without making the session fatal', () => {
    const events: AdapterOutputEvent[] = []
    const projector = new PiEventProjector('openai/gpt-test', event => events.push(event), () => 1234)

    projector.handle({ type: 'agent_start' })
    projector.handle({
      type: 'message_end',
      message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'rate limited' }
    })
    projector.handle({
      type: 'auto_retry_start',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 10,
      errorMessage: 'rate limited'
    })
    projector.interruptCurrentTurn()
    projector.handle({ type: 'auto_retry_end', success: false, attempt: 1, finalError: 'Retry cancelled' })
    projector.handle({ type: 'agent_settled' })

    expect(events.some(event => event.type === 'error')).toBe(false)
    expect(events).toContainEqual({ type: 'stop' })
    expect(events).toContainEqual(expect.objectContaining({
      type: 'operation',
      data: expect.objectContaining({ message: 'Pi stopped the interrupted turn.', operationId: 'pi-turn' })
    }))
  })
})
