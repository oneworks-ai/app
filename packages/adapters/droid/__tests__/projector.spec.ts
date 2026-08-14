import { describe, expect, it } from 'vitest'

import type { AdapterOutputEvent } from '@oneworks/types'

import { DroidEventProjector } from '../src/runtime/projector'
import type { FactoryNotification } from '../src/runtime/protocol/types'

const hookNotification = (
  type: 'hook_execution_completed' | 'hook_execution_started',
  hookId: string
): FactoryNotification => ({
  jsonrpc: '2.0',
  type: 'notification',
  factoryApiVersion: '1.0.0',
  factoryProtocolVersion: '1.151.0',
  method: 'droid.session_notification',
  params: {
    notification: {
      type,
      hookId,
      hookEventName: 'PreToolUse'
    }
  }
})

const sessionNotification = (notification: Record<string, unknown>): FactoryNotification => ({
  jsonrpc: '2.0',
  type: 'notification',
  factoryApiVersion: '1.0.0',
  factoryProtocolVersion: '1.151.0',
  method: 'droid.session_notification',
  params: { notification }
})

describe('factory Droid event projector', () => {
  it('correlates repeated/concurrent native hooks with the official hookId field', () => {
    const events: AdapterOutputEvent[] = []
    const projector = new DroidEventProjector(event => events.push(event))
    projector.handle(hookNotification('hook_execution_started', 'hook-1'))
    projector.handle(hookNotification('hook_execution_started', 'hook-2'))
    projector.handle(hookNotification('hook_execution_completed', 'hook-1'))
    projector.handle(hookNotification('hook_execution_completed', 'hook-2'))

    expect(events.map(event => event.type === 'operation' ? event.data.operationId : undefined)).toEqual([
      'droid-hook:hook-1',
      'droid-hook:hook-2',
      'droid-hook:hook-1',
      'droid-hook:hook-2'
    ])
  })

  it('settles every accepted queued turn in protocol order and ignores duplicate native terminals', () => {
    const events: AdapterOutputEvent[] = []
    const projector = new DroidEventProjector(event => events.push(event))
    const turns = [projector.reserveTurn(), projector.reserveTurn(), projector.reserveTurn()]
    turns.forEach(turn => projector.acceptTurn(turn))
    for (const id of ['one', 'two', 'three']) {
      const terminal = sessionNotification({
        type: 'agent_turn_completed',
        turnId: id,
        reason: 'completed',
        tokenUsage: { inputTokens: 1, outputTokens: 1 }
      })
      projector.handle(terminal)
      projector.handle(terminal)
    }
    expect(events.filter(event => event.type === 'stop')).toHaveLength(3)
  })

  it('holds an early completion until ACK and preserves an in-flight reservation across interrupt drain', () => {
    const events: AdapterOutputEvent[] = []
    const projector = new DroidEventProjector(event => events.push(event))
    const first = projector.reserveTurn()
    const second = projector.reserveTurn()
    projector.acceptTurn(first)
    projector.settleAcceptedTurns()
    expect(events.filter(event => event.type === 'stop')).toHaveLength(1)

    projector.handle(sessionNotification({
      type: 'agent_turn_completed',
      turnId: 'early',
      reason: 'completed'
    }))
    expect(events.filter(event => event.type === 'stop')).toHaveLength(1)
    projector.acceptTurn(second)
    projector.settleAcceptedTurns()
    projector.settleAcceptedTurns()
    expect(events.filter(event => event.type === 'stop')).toHaveLength(2)
  })

  it('preserves finite official numeric message timestamps', () => {
    const events: AdapterOutputEvent[] = []
    const projector = new DroidEventProjector(event => events.push(event))
    projector.handle(sessionNotification({
      type: 'create_message',
      message: {
        id: 'numeric-time',
        role: 'assistant',
        content: [{ type: 'text', text: 'timestamped' }],
        createdAt: 1_786_492_801_000
      }
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'message',
      data: expect.objectContaining({ createdAt: 1_786_492_801_000 })
    }))
  })

  it('projects official text and base64 PDF documents, including document-only messages', () => {
    const events: AdapterOutputEvent[] = []
    const projector = new DroidEventProjector(event => events.push(event))
    projector.handle(sessionNotification({
      type: 'create_message',
      message: {
        id: 'official-documents',
        role: 'assistant',
        content: [
          {
            type: 'document',
            source: {
              type: 'text',
              mediaType: 'text/plain',
              data: 'Factory text document',
              name: 'notes.txt'
            }
          },
          {
            type: 'document',
            source: {
              type: 'base64',
              mediaType: 'application/pdf',
              data: 'JVBERg==',
              name: 'report.pdf'
            }
          }
        ],
        createdAt: 1_786_492_801_000
      }
    }))

    const messages = events.filter(event => event.type === 'message')
    expect(messages).toHaveLength(2)
    expect(messages[0]).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        content: [expect.objectContaining({
          type: 'file',
          name: 'notes.txt',
          mimeType: 'text/plain',
          data: 'Factory text document',
          encoding: 'utf8'
        })]
      })
    }))
    expect(messages[1]).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        content: [expect.objectContaining({
          type: 'file',
          name: 'report.pdf',
          mimeType: 'application/pdf',
          data: 'JVBERg==',
          encoding: 'base64'
        })]
      })
    }))
  })

  it('fails closed on malformed document media without projecting an attachment', () => {
    const events: AdapterOutputEvent[] = []
    const projector = new DroidEventProjector(event => events.push(event))
    projector.handle(sessionNotification({
      type: 'create_message',
      message: {
        id: 'malformed-document',
        role: 'assistant',
        content: [{
          type: 'document',
          source: { type: 'base64', mediaType: 'text/html', data: 'PHNjcmlwdD4=' }
        }]
      }
    }))
    expect(events.filter(event => event.type === 'message')).toEqual([])
    expect(events).toContainEqual(expect.objectContaining({
      type: 'error',
      data: expect.objectContaining({ fatal: false })
    }))
  })
})
