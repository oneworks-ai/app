import { describe, expect, it } from 'vitest'

import { normalizeRelayDeviceTransport } from '../src/server/controller.js'

describe('relay device transport discovery', () => {
  const valid = {
    apiBaseUrl: 'https://worker.example/',
    controlWebSocketUrl: 'wss://worker.example/api/relay/devices/control',
    version: 1
  }

  it('accepts a versioned same-origin TLS transport', () => {
    expect(normalizeRelayDeviceTransport(valid)).toEqual(valid)
  })

  it('accepts a bounded v2 long-poll transport without a WebSocket URL', () => {
    expect(normalizeRelayDeviceTransport({
      apiBaseUrl: 'https://worker.example/',
      idleRetryMs: 250_000,
      longPollMaxWaitMs: 50_000,
      mode: 'long-poll',
      version: 2
    })).toEqual({
      apiBaseUrl: 'https://worker.example/',
      idleRetryMs: 250_000,
      longPollMaxWaitMs: 50_000,
      mode: 'long-poll',
      version: 2
    })
  })

  it.each([
    undefined,
    { ...valid, version: 2 },
    { ...valid, apiBaseUrl: 'http://worker.example/' },
    { ...valid, controlWebSocketUrl: 'ws://worker.example/api/relay/devices/control' },
    { ...valid, controlWebSocketUrl: 'wss://other.example/api/relay/devices/control' },
    { ...valid, controlWebSocketUrl: 'wss://worker.example/api/relay/devices/control?token=secret' },
    { ...valid, apiBaseUrl: 'https://worker.example/api' },
    { ...valid, apiBaseUrl: 'https://user:secret@worker.example/' },
    {
      apiBaseUrl: 'https://worker.example/',
      idleRetryMs: 250_000,
      longPollMaxWaitMs: 50_000,
      mode: 'other',
      version: 2
    },
    {
      apiBaseUrl: 'https://user:secret@worker.example/',
      idleRetryMs: 250_000,
      longPollMaxWaitMs: 50_000,
      mode: 'long-poll',
      version: 2
    },
    {
      apiBaseUrl: 'https://worker.example/',
      idleRetryMs: 59_999,
      longPollMaxWaitMs: 50_000,
      mode: 'long-poll',
      version: 2
    },
    {
      apiBaseUrl: 'https://worker.example/',
      idleRetryMs: 250_000,
      longPollMaxWaitMs: 55_001,
      mode: 'long-poll',
      version: 2
    }
  ])('rejects invalid or unsafe transports %#', value => {
    expect(normalizeRelayDeviceTransport(value)).toBeUndefined()
  })

  it('allows insecure loopback development only', () => {
    expect(normalizeRelayDeviceTransport({
      apiBaseUrl: 'http://127.0.0.1:8787/',
      controlWebSocketUrl: 'ws://127.0.0.1:8787/api/relay/devices/control',
      version: 1
    })).toBeDefined()
  })
})
