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

  it.each([
    undefined,
    { ...valid, version: 2 },
    { ...valid, apiBaseUrl: 'http://worker.example/' },
    { ...valid, controlWebSocketUrl: 'ws://worker.example/api/relay/devices/control' },
    { ...valid, controlWebSocketUrl: 'wss://other.example/api/relay/devices/control' },
    { ...valid, controlWebSocketUrl: 'wss://worker.example/api/relay/devices/control?token=secret' },
    { ...valid, apiBaseUrl: 'https://worker.example/api' },
    { ...valid, apiBaseUrl: 'https://user:secret@worker.example/' }
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
