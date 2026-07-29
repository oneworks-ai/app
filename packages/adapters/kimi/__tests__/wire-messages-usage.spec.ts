import { describe, expect, it, vi } from 'vitest'

import type { AdapterOutputEvent } from '@oneworks/types'

import { KimiWireMessageState, handleKimiWireEvent } from '../src/runtime/wire-messages'

describe('kimi wire token usage', () => {
  it('maps status update token_usage into a normalized adapter usage event', () => {
    const events: AdapterOutputEvent[] = []
    const handled = handleKimiWireEvent(
      {
        type: 'StatusUpdate',
        payload: {
          message_id: 'kimi-step-1',
          token_usage: {
            input_other: 120,
            output: 30,
            input_cache_read: 50,
            input_cache_creation: 10
          }
        }
      },
      new KimiWireMessageState(),
      'kimi-api,kimi-k2.5',
      vi.fn(event => events.push(event))
    )

    expect(handled).toBe(true)
    expect(events).toEqual([{
      type: 'usage',
      data: expect.objectContaining({
        id: 'kimi-step-1',
        inputTokens: 120,
        outputTokens: 30,
        cacheReadInputTokens: 50,
        cacheCreationInputTokens: 10,
        aggregationMode: 'delta',
        model: 'kimi-api,kimi-k2.5',
        quality: 'provider_reported'
      })
    }])
  })
})
