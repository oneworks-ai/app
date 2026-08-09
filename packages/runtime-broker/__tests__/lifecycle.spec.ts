import { describe, expect, it, vi } from 'vitest'

import { RuntimeBroker, RuntimeBrokerError } from '#~/index.js'
import type { RuntimeBrokerDriverLease } from '#~/index.js'

describe('runtime broker lifecycle limits', () => {
  it('times out non-settling callbacks, retains a terminal tombstone, and recovers admission', async () => {
    let callbackSignal: AbortSignal | undefined
    const callback = vi.fn(async (payload: unknown, context) => {
      if ((payload as { sequence?: number }).sequence !== 1) return payload
      callbackSignal = context.signal
      return await new Promise<never>(() => undefined)
    })
    const broker = new RuntimeBroker({
      maxCallbackEntries: 1,
      maxCallbackPrincipals: 1,
      maxCallbackRetentionMs: 20,
      pollTimeoutMs: 1
    })
    broker.registerDriver({
      id: 'callback-timeout.runtime',
      acquire: async () => ({ invoke: async () => ({}), release: () => undefined }),
      callback
    })
    const context = { callbackId: 'callback-a', profileKey: 'profile-a' }

    await expect(broker.callback(
      'callback-timeout.runtime',
      { sequence: 1 },
      context,
      { executionTimeoutMs: 5, retentionMs: 10 }
    )).rejects.toMatchObject({ code: 'callback_timeout' })
    expect(callbackSignal?.aborted).toBe(true)
    broker.acknowledgeCallback('callback-timeout.runtime', context)
    await expect(broker.callback(
      'callback-timeout.runtime',
      { sequence: 2 },
      { ...context, callbackId: 'callback-b' },
      { executionTimeoutMs: 5, retentionMs: 10 }
    )).rejects.toMatchObject({ code: 'callback_capacity' })

    await new Promise(resolve => setTimeout(resolve, 7))

    await expect(broker.callback(
      'callback-timeout.runtime',
      { sequence: 2 },
      { ...context, callbackId: 'callback-b' },
      { executionTimeoutMs: 5, retentionMs: 10 }
    )).resolves.toEqual({ sequence: 2 })
    await expect(broker.dispose()).resolves.toBeUndefined()
  })

  it('cancels a non-settling callback before disposal invokes the driver cleanup', async () => {
    let signal: AbortSignal | undefined
    const driverDispose = vi.fn()
    const callbackStarted = vi.fn()
    const broker = new RuntimeBroker({ maxCallbackRetentionMs: 10_000, pollTimeoutMs: 1 })
    broker.registerDriver({
      id: 'cancel-callback.runtime',
      acquire: async () => ({ invoke: async () => ({}), release: () => undefined }),
      callback: async (_payload, context) => {
        signal = context.signal
        callbackStarted()
        return await new Promise<never>(() => undefined)
      },
      dispose: driverDispose
    })
    const callback = broker.callback(
      'cancel-callback.runtime',
      {},
      { callbackId: 'callback-a', profileKey: 'profile-a' },
      { executionTimeoutMs: 9_000, retentionMs: 10_000 }
    )
    await vi.waitFor(() => expect(callbackStarted).toHaveBeenCalledOnce())

    const disposing = broker.dispose()

    await expect(callback).rejects.toMatchObject({ code: 'broker_disposed' })
    await expect(disposing).resolves.toBeUndefined()
    expect(signal?.aborted).toBe(true)
    expect(driverDispose).toHaveBeenCalledOnce()
  })

  it('cancels and reclaims a non-settling lease callback before lease release completes', async () => {
    let signal: AbortSignal | undefined
    const callbackStarted = vi.fn()
    const broker = new RuntimeBroker({ maxCallbackRetentionMs: 10_000, pollTimeoutMs: 1 })
    broker.registerDriver({
      id: 'release-callback.runtime',
      acquire: async () => ({ invoke: async () => ({}), release: () => undefined }),
      callback: async (_payload, context) => {
        signal = context.signal
        callbackStarted()
        return await new Promise<never>(() => undefined)
      }
    })
    const acquired = await broker.acquire('workspace:a', {
      driverId: 'release-callback.runtime',
      profileKey: 'profile-a'
    })
    const callback = broker.callback(
      'release-callback.runtime',
      {},
      { callbackId: 'callback-a', leaseId: acquired.leaseId, profileKey: 'profile-a' },
      { executionTimeoutMs: 9_000, retentionMs: 10_000 }
    )
    await vi.waitFor(() => expect(callbackStarted).toHaveBeenCalledOnce())

    await broker.release('workspace:a', acquired.leaseId)

    await expect(callback).rejects.toMatchObject({ code: 'lease_closed' })
    expect(signal?.aborted).toBe(true)
    await expect(broker.dispose()).resolves.toBeUndefined()
  })

  it('rejects driver requests during acquisition instead of deadlocking', async () => {
    const broker = new RuntimeBroker({ pollTimeoutMs: 1 })
    broker.registerDriver({
      id: 'acquire-request.runtime',
      acquire: async (_payload, context) => {
        await expect(context.request('not-ready')).rejects.toMatchObject({ code: 'lease_not_ready' })
        return { invoke: async () => ({}), release: () => undefined }
      }
    })

    await expect(broker.acquire('workspace:a', {
      driverId: 'acquire-request.runtime',
      profileKey: 'profile-1'
    })).resolves.toMatchObject({ leaseId: expect.any(String) })
    await broker.dispose()
  })

  it('waits for in-flight acquisition and releases it when disposal wins the race', async () => {
    let finishAcquire!: (lease: RuntimeBrokerDriverLease) => void
    const driverRelease = vi.fn()
    const driverDispose = vi.fn()
    const broker = new RuntimeBroker({ pollTimeoutMs: 1 })
    broker.registerDriver({
      id: 'slow.runtime',
      acquire: async () =>
        await new Promise<RuntimeBrokerDriverLease>((resolve) => {
          finishAcquire = resolve
        }),
      dispose: driverDispose
    })
    const acquiring = broker.acquire('workspace:a', {
      driverId: 'slow.runtime',
      profileKey: 'profile-1'
    })
    const disposing = broker.dispose()

    finishAcquire({ invoke: async () => ({}), release: driverRelease })

    await expect(acquiring).rejects.toMatchObject({ code: 'broker_disposed' })
    await disposing
    expect(driverRelease).toHaveBeenCalledOnce()
    expect(driverDispose).toHaveBeenCalledOnce()
    expect(() =>
      broker.registerDriver({
        id: 'late.runtime',
        acquire: async () => ({ invoke: async () => ({}), release: () => undefined })
      })
    ).toThrow(RuntimeBrokerError)
  })

  it('times out a non-settling acquisition and permits a later retry', async () => {
    let firstSignal: AbortSignal | undefined
    let attempts = 0
    const release = vi.fn()
    const broker = new RuntimeBroker({ acquireTimeoutMs: 5, maxConcurrentAcquires: 1, pollTimeoutMs: 1 })
    broker.registerDriver({
      id: 'acquire-timeout.runtime',
      acquire: async (_payload, context) => {
        attempts += 1
        if (attempts !== 1) return { invoke: async () => ({}), release }
        firstSignal = context.signal
        return await new Promise<RuntimeBrokerDriverLease>(() => undefined)
      }
    })
    const first = broker.acquire('workspace:a', {
      driverId: 'acquire-timeout.runtime',
      profileKey: 'profile-a'
    })
    await expect(broker.acquire('workspace:b', {
      driverId: 'acquire-timeout.runtime',
      profileKey: 'profile-b'
    })).rejects.toMatchObject({ code: 'acquire_capacity' })

    await expect(first).rejects.toMatchObject({ code: 'acquire_timeout' })
    expect(firstSignal?.aborted).toBe(true)
    const acquired = await broker.acquire('workspace:b', {
      driverId: 'acquire-timeout.runtime',
      profileKey: 'profile-b'
    })
    await broker.release('workspace:b', acquired.leaseId)
    expect(release).toHaveBeenCalledOnce()
    await broker.dispose()
  })

  it('cancels a non-settling acquisition before disposal waits for drivers', async () => {
    let signal: AbortSignal | undefined
    const driverDispose = vi.fn()
    const broker = new RuntimeBroker({ acquireTimeoutMs: 10_000, pollTimeoutMs: 1 })
    broker.registerDriver({
      id: 'cancel-acquire.runtime',
      acquire: async (_payload, context) => {
        signal = context.signal
        return await new Promise<RuntimeBrokerDriverLease>(() => undefined)
      },
      dispose: driverDispose
    })
    const acquiring = broker.acquire('workspace:a', {
      driverId: 'cancel-acquire.runtime',
      profileKey: 'profile-a'
    })

    const disposing = broker.dispose()

    await expect(acquiring).rejects.toMatchObject({ code: 'broker_disposed' })
    await expect(disposing).resolves.toBeUndefined()
    expect(signal?.aborted).toBe(true)
    expect(driverDispose).toHaveBeenCalledOnce()
  })

  it('publishes a slow successful acquisition with a fresh lease heartbeat', async () => {
    let now = 1_000
    let finishAcquire!: (lease: RuntimeBrokerDriverLease) => void
    const release = vi.fn()
    const broker = new RuntimeBroker({
      acquireTimeoutMs: 200,
      leaseTtlMs: 100,
      now: () => now,
      pollTimeoutMs: 1
    })
    broker.registerDriver({
      id: 'slow-success.runtime',
      acquire: async () =>
        await new Promise<RuntimeBrokerDriverLease>((resolve) => {
          finishAcquire = resolve
        })
    })
    const acquiring = broker.acquire('workspace:a', {
      driverId: 'slow-success.runtime',
      profileKey: 'profile-a'
    })
    now += 101
    finishAcquire({ invoke: async () => ({}), release })
    const acquired = await acquiring

    await broker.sweepStaleLeases()

    await expect(broker.poll('workspace:a', acquired.leaseId, 0, 1)).resolves.toEqual({
      events: [],
      nextCursor: 0
    })
    await broker.release('workspace:a', acquired.leaseId)
    expect(release).toHaveBeenCalledOnce()
    await broker.dispose()
  })

  it('bounds non-settling lease and driver cleanup during disposal', async () => {
    const errors: unknown[] = []
    const leaseRelease = vi.fn(async () => await new Promise<never>(() => undefined))
    const driverDispose = vi.fn(async () => await new Promise<never>(() => undefined))
    const broker = new RuntimeBroker({
      cleanupTimeoutMs: 10,
      onError: error => errors.push(error),
      pollTimeoutMs: 1
    })
    broker.registerDriver({
      id: 'non-settling-cleanup.runtime',
      acquire: async () => ({ invoke: async () => ({}), release: leaseRelease }),
      dispose: driverDispose
    })
    await broker.acquire('workspace:a', {
      driverId: 'non-settling-cleanup.runtime',
      profileKey: 'profile-a'
    })

    await expect(broker.dispose()).resolves.toBeUndefined()

    expect(leaseRelease).toHaveBeenCalledOnce()
    expect(driverDispose).toHaveBeenCalledOnce()
    expect(errors).toEqual([
      expect.objectContaining({ code: 'cleanup_timeout' }),
      expect.objectContaining({ code: 'cleanup_timeout' })
    ])
  })
})
