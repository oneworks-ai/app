import { describe, expect, it } from 'vitest'

import type { ChannelWebhookRequest } from '../src/channel'

describe('channel webhook contract', () => {
  it('accepts parsed body plus raw string bodies', () => {
    const request: ChannelWebhookRequest = {
      method: 'POST',
      headers: {},
      query: {},
      body: { event: 'message' },
      rawBody: '{"event":"message"}'
    }

    expect(request.rawBody).toBe('{"event":"message"}')
  })

  it('accepts raw binary bodies for signed platform callbacks', () => {
    const rawBody = new Uint8Array([123, 125])
    const request: ChannelWebhookRequest = {
      method: 'POST',
      headers: {},
      query: {},
      body: {},
      rawBody
    }

    expect(request.rawBody).toBe(rawBody)
  })
})
