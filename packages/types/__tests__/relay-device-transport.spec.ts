import { describe, expect, it } from 'vitest'

import { normalizeRelayDeviceTransport } from '../src/relay-device-transport.js'

describe('relay device transport contract', () => {
  it('normalizes same-origin v1 WebSocket and v2 long-poll capabilities', () => {
    expect(normalizeRelayDeviceTransport({
      apiBaseUrl: 'https://relay.example',
      controlWebSocketUrl: 'wss://relay.example/api/relay/devices/control',
      heartbeatIntervalMs: 600_000,
      version: 1
    })).toMatchObject({ apiBaseUrl: 'https://relay.example/', heartbeatIntervalMs: 600_000, version: 1 })
    expect(normalizeRelayDeviceTransport({
      apiBaseUrl: 'https://relay.example',
      idleRetryMs: 250_000,
      longPollMaxWaitMs: 50_000,
      mode: 'long-poll',
      version: 2
    })).toEqual({
      apiBaseUrl: 'https://relay.example/',
      idleRetryMs: 250_000,
      longPollMaxWaitMs: 50_000,
      mode: 'long-poll',
      version: 2
    })
  })

  it('rejects cross-origin, credential-bearing, and unbounded capabilities', () => {
    expect(normalizeRelayDeviceTransport({
      apiBaseUrl: 'https://relay.example',
      controlWebSocketUrl: 'wss://other.example/api/relay/devices/control',
      version: 1
    })).toBeUndefined()
    expect(normalizeRelayDeviceTransport({
      apiBaseUrl: 'https://token@relay.example',
      idleRetryMs: 250_000,
      longPollMaxWaitMs: 50_000,
      mode: 'long-poll',
      version: 2
    })).toBeUndefined()
    expect(normalizeRelayDeviceTransport({
      apiBaseUrl: 'https://relay.example',
      idleRetryMs: 250_000,
      longPollMaxWaitMs: 55_001,
      mode: 'long-poll',
      version: 2
    })).toBeUndefined()
  })
})
