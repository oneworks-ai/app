import { describe, expect, it } from 'vitest'

import { createCloudflareRelayArgs } from '../cloudflare/worker.js'

const deviceTransportEnv = {
  ONEWORKS_RELAY_DEVICE_API_URL: 'https://worker.example',
  ONEWORKS_RELAY_DEVICE_CONTROL_WS_URL: 'wss://worker.example/api/relay/devices/control',
  RELAY_OBJECT: {} as never
}

describe('cloudflare Relay configuration', () => {
  it('fails closed when its native WebSocket pair is absent or invalid', () => {
    expect(() => createCloudflareRelayArgs({ RELAY_OBJECT: {} as never })).toThrow(/requires valid/u)
    expect(() =>
      createCloudflareRelayArgs({
        ...deviceTransportEnv,
        ONEWORKS_RELAY_DEVICE_CONTROL_WS_URL: 'wss://different.example/api/relay/devices/control'
      })
    ).toThrow(/requires valid/u)
  })

  it('advertises websocket control at its low-write cadence and 15-minute TTL by default', () => {
    const args = createCloudflareRelayArgs(deviceTransportEnv)
    expect(args.deviceTransport).toMatchObject({ heartbeatIntervalMs: 30_000, version: 1 })
    expect(args.deviceOnlineTtlMs).toBe(900_000)
  })

  it('uses parsed safe fallback for an explicit invalid TTL rather than producing NaN', () => {
    const args = createCloudflareRelayArgs({
      ...deviceTransportEnv,
      ONEWORKS_RELAY_DEVICE_ONLINE_TTL_SECONDS: 'not-a-number'
    })
    expect(args.deviceOnlineTtlMs).toBe(60_000)
    expect(Number.isFinite(args.deviceOnlineTtlMs)).toBe(true)
  })

  it('honors explicit Cloudflare cadence and TTL overrides', () => {
    const args = createCloudflareRelayArgs({
      ...deviceTransportEnv,
      ONEWORKS_RELAY_DEVICE_CONTROL_HEARTBEAT_SECONDS: '600',
      ONEWORKS_RELAY_DEVICE_ONLINE_TTL_SECONDS: '900'
    })
    expect(args.deviceTransport).toMatchObject({ heartbeatIntervalMs: 600_000, version: 1 })
    expect(args.deviceOnlineTtlMs).toBe(900_000)
  })

  it('fails closed for an invalid Cloudflare heartbeat cadence', () => {
    expect(() =>
      createCloudflareRelayArgs({
        ...deviceTransportEnv,
        ONEWORKS_RELAY_DEVICE_CONTROL_HEARTBEAT_SECONDS: 'not-a-number'
      })
    ).toThrow(/requires valid/u)
  })
})
