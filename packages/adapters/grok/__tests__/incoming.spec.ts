import { describe, expect, it } from 'vitest'

import type { AdapterOutputEvent } from '@oneworks/types'

import { handleGrokIncomingEvent } from '../src/protocol/incoming'

describe('grok streaming-messages-json protocol', () => {
  it('maps the official CLI init, assistant, and result records', () => {
    const events: AdapterOutputEvent[] = []
    const onEvent = (event: AdapterOutputEvent) => events.push(event)

    handleGrokIncomingEvent(
      {
        type: 'system',
        subtype: 'init',
        session_id: '11111111-1111-4111-8111-111111111111',
        uuid: 'system-1',
        model: 'oneworks-smoke',
        cwd: '/workspace',
        tools: ['Bash', 'Read'],
        slash_commands: ['help']
      },
      onEvent,
      'high'
    )
    handleGrokIncomingEvent({
      type: 'assistant',
      uuid: 'assistant-1',
      message: {
        id: 'msg_0',
        model: 'oneworks-smoke',
        content: [
          { type: 'text', text: 'Inspecting.' },
          { type: 'tool_use', id: 'tool-1', name: 'Read', input: { path: 'README.md' } }
        ],
        usage: { input_tokens: 11, output_tokens: 7 }
      }
    }, onEvent)
    handleGrokIncomingEvent({
      type: 'result',
      subtype: 'success',
      is_error: false,
      uuid: 'result-1',
      session_id: '11111111-1111-4111-8111-111111111111',
      result: 'GROK_SMOKE_OK',
      usage: { input_tokens: 11, output_tokens: 7 }
    }, onEvent)

    expect(events[0]).toEqual(expect.objectContaining({
      type: 'init',
      data: expect.objectContaining({
        uuid: '11111111-1111-4111-8111-111111111111',
        model: 'oneworks-smoke',
        effort: 'high',
        tools: ['Bash', 'Read']
      })
    }))
    expect(events[1]).toEqual({
      type: 'message',
      data: expect.objectContaining({
        id: 'assistant-1',
        content: [
          { type: 'text', text: 'Inspecting.' },
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'adapter:grok:Read',
            input: { path: 'README.md' }
          }
        ],
        usage: { input_tokens: 11, output_tokens: 7 }
      })
    })
    expect(events[2]).toEqual({
      type: 'stop',
      data: expect.objectContaining({ content: 'GROK_SMOKE_OK' })
    })
  })

  it('surfaces an error result before stopping', () => {
    const events: AdapterOutputEvent[] = []
    handleGrokIncomingEvent({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'Authentication failed',
      session_id: 'session-1'
    }, event => events.push(event))

    expect(events).toEqual([
      expect.objectContaining({
        type: 'error',
        data: expect.objectContaining({ message: 'Authentication failed', fatal: true })
      }),
      expect.objectContaining({ type: 'stop' })
    ])
  })
})
