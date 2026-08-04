import { describe, expect, it } from 'vitest'

import {
  VERCEL_DEVICE_CONTROL_MAX_DAILY_INVOCATIONS,
  VERCEL_DEVICE_CONTROL_MAX_DAILY_STORAGE_READS,
  VERCEL_DEVICE_CONTROL_MAX_STORAGE_READS_PER_POLL,
  createVercelRelayArgs,
  getVercelDeviceControlDailyBudget
} from '../api/relay.js'

describe('vercel Relay entry', () => {
  it('keeps a long-poll device online across its 300-second poll cycle', () => {
    const args = createVercelRelayArgs({
      ONEWORKS_RELAY_PUBLIC_URL: 'https://relay.example'
    })

    expect(args.deviceTransport).toEqual({
      apiBaseUrl: 'https://relay.example/',
      idleRetryMs: 250_000,
      longPollMaxWaitMs: 50_000,
      mode: 'long-poll',
      version: 2
    })
    expect(args.deviceOnlineTtlMs).toBeGreaterThanOrEqual(300_000)
  })

  it('does not fall back to a configured legacy WebSocket transport without a safe public origin', () => {
    const args = createVercelRelayArgs({
      ONEWORKS_RELAY_DEVICE_API_URL: 'https://worker.example',
      ONEWORKS_RELAY_DEVICE_CONTROL_WS_URL: 'wss://worker.example/api/relay/devices/control'
    })

    expect(args.deviceTransport).toBeUndefined()
  })

  it('keeps the default long-poll cadence within its explicit 24-hour budget gate', () => {
    expect(getVercelDeviceControlDailyBudget()).toEqual({
      functionSeconds: 14_400,
      invocations: 288,
      readsPerPoll: 11,
      storageReads: 3_168
    })
    const budget = getVercelDeviceControlDailyBudget()
    expect(budget.invocations).toBeLessThanOrEqual(VERCEL_DEVICE_CONTROL_MAX_DAILY_INVOCATIONS)
    expect(budget.readsPerPoll).toBeLessThanOrEqual(VERCEL_DEVICE_CONTROL_MAX_STORAGE_READS_PER_POLL)
    expect(budget.storageReads).toBeLessThanOrEqual(VERCEL_DEVICE_CONTROL_MAX_DAILY_STORAGE_READS)
  })

  it('uses Vercel build metadata only at the Vercel entry', () => {
    expect(createVercelRelayArgs({ VERCEL_GIT_COMMIT_SHA: 'vercel-build' }).buildSha).toBe('vercel-build')
  })
})
