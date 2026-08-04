import { describe, expect, it } from 'vitest'

import { classifyRateLimitedRequest } from '../src/security/rate-limit-classifier.js'

const request = (method: string, token = 'device-token') => ({
  headers: {
    authorization: `Bearer ${token}`,
    'x-forwarded-for': '203.0.113.10'
  },
  method,
  socket: { remoteAddress: '127.0.0.1' }
})

describe('relay rate-limit classifier', () => {
  it('keeps GET device session claims scoped by device and token', () => {
    expect(classifyRateLimitedRequest(
      request('GET') as never,
      new URL('https://relay.example/api/relay/devices/device-1/session-jobs')
    )).toMatchObject({ category: 'device-session-claim' })
    expect(classifyRateLimitedRequest(
      request('GET', 'another-token') as never,
      new URL('https://relay.example/api/relay/devices/device-2/session-jobs')
    )).not.toEqual(classifyRateLimitedRequest(
      request('GET') as never,
      new URL('https://relay.example/api/relay/devices/device-1/session-jobs')
    ))
  })

  it('puts random POST claim paths and tokens into one IP-scoped bucket', () => {
    expect(classifyRateLimitedRequest(
      request('POST', 'random-token-a') as never,
      new URL('https://relay.example/api/relay/devices/random-device-a/session-jobs')
    )).toEqual(classifyRateLimitedRequest(
      request('POST', 'random-token-b') as never,
      new URL('https://relay.example/api/relay/devices/random-device-b/session-jobs')
    ))
    expect(classifyRateLimitedRequest(
      request('POST') as never,
      new URL('https://relay.example/api/relay/devices/device-1/session-jobs')
    )).toEqual({ category: 'device-session-claim', key: '203.0.113.10:claim-post' })
  })
})
