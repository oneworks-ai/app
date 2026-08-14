import { describe, expect, it } from 'vitest'

import type { AdapterOutputEvent } from '@oneworks/types'

import { KiroEventProjector } from '../src/runtime/projector'

describe('kiro ACP event parser', () => {
  it('accepts Kiro PascalCase/content and ACP v1 snake_case/prompt fixtures', () => {
    const events: AdapterOutputEvent[] = []
    const projector = new KiroEventProjector('default', event => events.push(event))
    projector.handle({
      update: {
        sessionUpdate: 'AgentMessageChunk',
        messageId: 'kiro',
        content: { type: 'text', text: 'Kiro' }
      }
    })
    projector.handle({
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'acp',
        prompt: { type: 'text', text: ' ACP' }
      }
    })
    projector.finishTurn()
    expect(events).toContainEqual(expect.objectContaining({
      type: 'message',
      data: expect.objectContaining({ content: 'Kiro ACP' })
    }))
  })
})
