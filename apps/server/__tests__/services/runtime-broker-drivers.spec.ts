import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  disposeRuntimeBrokerDrivers,
  initializeRuntimeBrokerDrivers
} from '#~/services/runtime-broker/drivers/index.js'
import { disposeRuntimeBroker, getRuntimeBroker } from '#~/services/runtime-broker/index.js'

describe('runtime broker built-in drivers', () => {
  afterEach(async () => {
    disposeRuntimeBrokerDrivers()
    await disposeRuntimeBroker()
  })

  it('loads the Codex driver through its package boundary', async () => {
    await initializeRuntimeBrokerDrivers()

    await expect(
      getRuntimeBroker().acquire('workspace:a', {
        driverId: 'codex.app-server',
        profileKey: 'profile-a',
        payload: {}
      })
    ).rejects.toMatchObject({ code: 'invalid_driver_payload' })
  })

  it('swaps in a fresh broker before awaiting old driver disposal', async () => {
    let finishDisposal!: () => void
    const disposalGate = new Promise<void>(resolve => {
      finishDisposal = resolve
    })
    const oldBroker = getRuntimeBroker()
    oldBroker.registerDriver({
      id: 'slow-dispose.runtime',
      acquire: async () => ({ invoke: async () => ({}), release: () => undefined }),
      dispose: vi.fn(async () => await disposalGate)
    })

    const disposing = disposeRuntimeBroker()
    const nextBroker = getRuntimeBroker()
    expect(nextBroker).not.toBe(oldBroker)
    expect(() =>
      nextBroker.registerDriver({
        id: 'next.runtime',
        acquire: async () => ({ invoke: async () => ({}), release: () => undefined })
      })
    ).not.toThrow()

    finishDisposal()
    await disposing
    await expect(nextBroker.acquire('workspace:a', {
      driverId: 'next.runtime',
      profileKey: 'profile-a'
    })).resolves.toMatchObject({ leaseId: expect.any(String) })
  })
})
