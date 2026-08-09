import { describe, expect, it, vi } from 'vitest'

import { RuntimeBroker, RuntimeBrokerError } from '#~/index.js'
import type { RuntimeBrokerDriverContext, RuntimeBrokerDriverLease } from '#~/index.js'

const createHarness = (
  options: { maxQueueSize?: number; now?: () => number; requestTimeoutMs?: number } = {}
) => {
  let context: RuntimeBrokerDriverContext | undefined
  const release = vi.fn()
  const invoke = vi.fn(async (operation: string, payload: unknown) => ({ operation, payload }))
  const driverLease: RuntimeBrokerDriverLease = { invoke, release }
  const broker = new RuntimeBroker({
    leaseTtlMs: 100,
    maxQueueSize: options.maxQueueSize,
    pollTimeoutMs: 1,
    requestTimeoutMs: options.requestTimeoutMs ?? 100,
    now: options.now
  })
  broker.registerDriver({
    id: 'fake.runtime',
    acquire: async (_payload, nextContext) => {
      context = nextContext
      return { ...driverLease, metadata: { pid: 42 } }
    },
    callback: async payload => ({ echoed: payload })
  })
  return {
    broker,
    getContext: () => {
      if (context == null) throw new Error('Driver was not acquired.')
      return context
    },
    invoke,
    release
  }
}

describe('runtime broker', () => {
  it('keeps driver operations and events scoped to the authenticated owner', async () => {
    const harness = createHarness()
    const acquired = await harness.broker.acquire('workspace:a', {
      driverId: 'fake.runtime',
      profileKey: 'profile-1',
      payload: { account: 'primary' }
    })

    await expect(harness.broker.invoke(
      'workspace:a',
      acquired.leaseId,
      'ping',
      { value: 1 }
    )).resolves.toEqual({ operation: 'ping', payload: { value: 1 } })
    expect(acquired.metadata).toEqual({ pid: 42 })

    harness.getContext().emit('ready', { threadId: 'thread-a' })
    await expect(harness.broker.poll('workspace:a', acquired.leaseId, 0, 1)).resolves.toEqual({
      events: [{
        cursor: 1,
        kind: 'event',
        name: 'ready',
        payload: { threadId: 'thread-a' }
      }],
      nextCursor: 1
    })

    await expect(harness.broker.invoke('workspace:b', acquired.leaseId, 'ping')).rejects.toMatchObject({
      code: 'lease_not_found'
    })
    await harness.broker.release('workspace:a', acquired.leaseId)
    expect(harness.release).toHaveBeenCalledOnce()
    await harness.broker.dispose()
  })

  it('correlates server-to-workspace requests and validates the responder owner', async () => {
    const harness = createHarness()
    const acquired = await harness.broker.acquire('workspace:a', {
      driverId: 'fake.runtime',
      profileKey: 'profile-1'
    })
    const responsePromise = harness.getContext().request('permission', { command: 'git status' })
    const polled = await harness.broker.poll('workspace:a', acquired.leaseId, 0, 1)
    const request = polled.events[0]

    expect(request).toMatchObject({ kind: 'request', name: 'permission' })
    expect(request?.requestId).toEqual(expect.any(String))
    expect(() =>
      harness.broker.respond(
        'workspace:b',
        acquired.leaseId,
        request!.requestId!,
        { decision: 'allow' }
      )
    ).toThrow(RuntimeBrokerError)

    harness.broker.respond(
      'workspace:a',
      acquired.leaseId,
      request!.requestId!,
      { decision: 'allow' }
    )
    expect(() =>
      harness.broker.respond(
        'workspace:a',
        acquired.leaseId,
        request!.requestId!,
        { decision: 'allow' }
      )
    ).not.toThrow()
    await expect(responsePromise).resolves.toEqual({ decision: 'allow' })
    await harness.broker.dispose()
  })

  it('routes driver callbacks without exposing leases', async () => {
    const harness = createHarness()
    await expect(harness.broker.callback(
      'fake.runtime',
      { hook: 'Stop' },
      { callbackId: 'callback-route-a', profileKey: 'profile-1' }
    )).resolves.toEqual({
      echoed: { hook: 'Stop' }
    })
    await harness.broker.dispose()
  })

  it('releases stale leases and rejects outstanding requests', async () => {
    let now = 1_000
    const harness = createHarness({ now: () => now })
    const acquired = await harness.broker.acquire('workspace:a', {
      driverId: 'fake.runtime',
      profileKey: 'profile-1'
    })
    const responsePromise = harness.getContext().request('hook', {})
    now += 101

    await harness.broker.sweepStaleLeases()

    await expect(responsePromise).rejects.toMatchObject({ code: 'lease_closed' })
    await expect(harness.broker.poll('workspace:a', acquired.leaseId, 0, 1)).rejects.toMatchObject({
      code: 'lease_not_found'
    })
    expect(harness.release).toHaveBeenCalledOnce()
    await harness.broker.dispose()
  })

  it('bounds unanswered server-to-workspace requests', async () => {
    const harness = createHarness({ requestTimeoutMs: 5 })
    await harness.broker.acquire('workspace:a', {
      driverId: 'fake.runtime',
      profileKey: 'profile-1'
    })

    await expect(harness.getContext().request('hook', {}, { timeoutMs: 5 })).rejects.toMatchObject({
      code: 'request_timeout'
    })
    await harness.broker.dispose()
  })

  it('rejects invalid request deadlines and bounds pending request admission', async () => {
    expect(() => new RuntimeBroker({ requestTimeoutMs: Number.NaN })).toThrowError(
      expect.objectContaining({ code: 'invalid_request_timeout' })
    )
    for (
      const options of [
        { maxQueueSize: Number.NaN },
        { maxQueueSize: Number.POSITIVE_INFINITY },
        { maxQueueSize: 4_097 },
        { maxCallbackEntries: 4_097 },
        { maxCallbackPrincipals: 4_097 },
        { maxConcurrentAcquires: 1_025 },
        { cleanupTimeoutMs: Number.NaN }
      ]
    ) {
      expect(() => new RuntimeBroker(options)).toThrowError(
        expect.objectContaining({ code: 'invalid_broker_options' })
      )
    }
    const harness = createHarness({ maxQueueSize: 1 })
    const acquired = await harness.broker.acquire('workspace:a', {
      driverId: 'fake.runtime',
      profileKey: 'profile-1'
    })

    await expect(harness.getContext().request('invalid', {}, { timeoutMs: Number.NaN }))
      .rejects.toMatchObject({ code: 'invalid_request_timeout' })
    await expect(harness.getContext().request('invalid', {}, { timeoutMs: Number.POSITIVE_INFINITY }))
      .rejects.toMatchObject({ code: 'invalid_request_timeout' })
    const pending = harness.getContext().request('first', {}, { timeoutMs: 1_000 })
    await expect(harness.getContext().request('overflow', {}, { timeoutMs: 1_000 }))
      .rejects.toMatchObject({ code: 'request_capacity' })
    const polled = await harness.broker.poll('workspace:a', acquired.leaseId, 0, 1)
    expect(polled.events).toEqual([
      expect.objectContaining({
        kind: 'request',
        name: 'first',
        requestDeadlineAt: expect.any(Number)
      })
    ])
    harness.broker.respond('workspace:a', acquired.leaseId, polled.events[0]!.requestId!, 'ok')
    await expect(pending).resolves.toBe('ok')
    await harness.broker.dispose()
  })

  it('deduplicates retried invocations by the caller-provided idempotency key', async () => {
    const harness = createHarness()
    const acquired = await harness.broker.acquire('workspace:a', {
      driverId: 'fake.runtime',
      profileKey: 'profile-1'
    })

    const first = harness.broker.invoke('workspace:a', acquired.leaseId, 'ping', { value: 1 }, 'invoke-a')
    const second = harness.broker.invoke('workspace:a', acquired.leaseId, 'ping', { value: 1 }, 'invoke-a')

    await expect(Promise.all([first, second])).resolves.toEqual([
      { operation: 'ping', payload: { value: 1 } },
      { operation: 'ping', payload: { value: 1 } }
    ])
    expect(harness.invoke).toHaveBeenCalledOnce()
    await harness.broker.dispose()
  })

  it('reports a bounded queue gap to stale consumers', async () => {
    const harness = createHarness({ maxQueueSize: 1 })
    const acquired = await harness.broker.acquire('workspace:a', {
      driverId: 'fake.runtime',
      profileKey: 'profile-1'
    })
    harness.getContext().emit('first')
    harness.getContext().emit('second')

    await expect(harness.broker.poll('workspace:a', acquired.leaseId, 0, 1)).rejects.toMatchObject({
      code: 'event_gap'
    })
    await harness.broker.dispose()
  })

  it('reports a bounded queue gap that occurs while a long poll is waiting', async () => {
    const harness = createHarness({ maxQueueSize: 1 })
    const acquired = await harness.broker.acquire('workspace:a', {
      driverId: 'fake.runtime',
      profileKey: 'profile-1'
    })
    const polling = harness.broker.poll('workspace:a', acquired.leaseId, 0, 100)

    harness.getContext().emit('first')
    harness.getContext().emit('second')

    await expect(polling).rejects.toMatchObject({ code: 'event_gap' })
    await harness.broker.dispose()
  })

  it('does not evict in-flight invocation idempotency entries', async () => {
    let finishFirst!: (value: unknown) => void
    const invoke = vi.fn(async (operation: string) => {
      if (operation !== 'first') return { operation }
      return await new Promise(resolve => {
        finishFirst = resolve
      })
    })
    const broker = new RuntimeBroker({ maxQueueSize: 1, pollTimeoutMs: 1 })
    broker.registerDriver({
      id: 'invoke.runtime',
      acquire: async () => ({ invoke, release: () => undefined })
    })
    const acquired = await broker.acquire('workspace:a', {
      driverId: 'invoke.runtime',
      profileKey: 'profile-1'
    })
    const first = broker.invoke('workspace:a', acquired.leaseId, 'first', undefined, 'invoke-first')
    await broker.invoke('workspace:a', acquired.leaseId, 'second', undefined, 'invoke-second')
    await broker.invoke('workspace:a', acquired.leaseId, 'third', undefined, 'invoke-third')
    const retriedFirst = broker.invoke(
      'workspace:a',
      acquired.leaseId,
      'first',
      undefined,
      'invoke-first'
    )

    expect(invoke.mock.calls.filter(([operation]) => operation === 'first')).toHaveLength(1)
    finishFirst({ operation: 'first' })
    await expect(Promise.all([first, retriedFirst])).resolves.toEqual([
      { operation: 'first' },
      { operation: 'first' }
    ])
    await broker.dispose()
  })

  it('deduplicates retried driver callbacks', async () => {
    const callback = vi.fn(async (payload: unknown) => ({ echoed: payload }))
    const broker = new RuntimeBroker({ maxQueueSize: 1, pollTimeoutMs: 1 })
    broker.registerDriver({
      id: 'callback.runtime',
      acquire: async () => ({ invoke: async () => ({}), release: () => undefined }),
      callback
    })
    const acquired = await broker.acquire('workspace:a', {
      driverId: 'callback.runtime',
      profileKey: 'profile-a'
    })
    const context = {
      callbackId: 'callback-a',
      leaseId: acquired.leaseId,
      profileKey: 'profile-a'
    }

    await expect(Promise.all([
      broker.callback('callback.runtime', { hook: 'Stop' }, context),
      broker.callback('callback.runtime', { hook: 'Stop' }, context)
    ])).resolves.toEqual([
      { echoed: { hook: 'Stop' } },
      { echoed: { hook: 'Stop' } }
    ])
    expect(callback).toHaveBeenCalledOnce()

    await broker.callback('callback.runtime', { hook: 'Stop', sequence: 2 }, {
      ...context,
      callbackId: 'callback-b'
    })
    await expect(
      broker.callback('callback.runtime', { hook: 'Stop' }, context)
    ).resolves.toEqual({ echoed: { hook: 'Stop' } })
    expect(callback).toHaveBeenCalledTimes(2)
    await broker.dispose()
  })

  it('backpressures new callbacks without evicting acknowledged or in-flight idempotency records', async () => {
    let finishFirst!: (value: unknown) => void
    const callback = vi.fn(async (payload: unknown) => {
      if ((payload as { sequence?: unknown }).sequence !== 1) return payload
      return await new Promise(resolve => {
        finishFirst = resolve
      })
    })
    const broker = new RuntimeBroker({ maxCallbackEntries: 2, pollTimeoutMs: 1 })
    broker.registerDriver({
      id: 'bounded-callback.runtime',
      acquire: async () => ({ invoke: async () => ({}), release: () => undefined }),
      callback
    })
    const acquired = await broker.acquire('workspace:a', {
      driverId: 'bounded-callback.runtime',
      profileKey: 'profile-a'
    })
    const context = { leaseId: acquired.leaseId, profileKey: 'profile-a' }
    const firstContext = { ...context, callbackId: 'callback-a' }
    const first = broker.callback('bounded-callback.runtime', { sequence: 1 }, firstContext)
    await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce())
    await broker.callback('bounded-callback.runtime', { sequence: 2 }, {
      ...context,
      callbackId: 'callback-b'
    })

    await expect(broker.callback('bounded-callback.runtime', { sequence: 3 }, {
      ...context,
      callbackId: 'callback-c'
    })).rejects.toMatchObject({ code: 'callback_capacity' })
    expect(() => broker.acknowledgeCallback('bounded-callback.runtime', firstContext)).toThrowError(
      expect.objectContaining({ code: 'callback_in_flight' })
    )

    finishFirst({ sequence: 1 })
    await first
    broker.acknowledgeCallback('bounded-callback.runtime', firstContext)
    await expect(broker.callback('bounded-callback.runtime', { sequence: 3 }, {
      ...context,
      callbackId: 'callback-c'
    })).resolves.toEqual({ sequence: 3 })
    expect(callback).toHaveBeenCalledTimes(3)
    await broker.dispose()
  })

  it('partitions callback admission and recovers unacknowledged records after retention', async () => {
    const callback = vi.fn(async (payload: unknown) => payload)
    const broker = new RuntimeBroker({
      maxCallbackEntries: 1,
      maxCallbackPrincipals: 2,
      maxCallbackRetentionMs: 100,
      pollTimeoutMs: 1
    })
    broker.registerDriver({
      id: 'partitioned-callback.runtime',
      acquire: async () => ({ invoke: async () => ({}), release: () => undefined }),
      callback
    })
    const profileA = { callbackId: 'callback-a', profileKey: 'profile-a' }
    const profileB = { callbackId: 'callback-b', profileKey: 'profile-b' }

    await broker.callback('partitioned-callback.runtime', { profile: 'a' }, profileA, {
      retentionMs: 20
    })
    await expect(broker.callback(
      'partitioned-callback.runtime',
      { profile: 'a-2' },
      { ...profileA, callbackId: 'callback-a-2' },
      { retentionMs: 20 }
    )).rejects.toMatchObject({ code: 'callback_capacity' })
    await expect(broker.callback(
      'partitioned-callback.runtime',
      { profile: 'b' },
      profileB,
      { retentionMs: 20 }
    )).resolves.toEqual({ profile: 'b' })
    await expect(broker.callback(
      'partitioned-callback.runtime',
      { profile: 'c' },
      { callbackId: 'callback-c', profileKey: 'profile-c' },
      { retentionMs: 20 }
    )).rejects.toMatchObject({ code: 'callback_principal_capacity' })

    await new Promise(resolve => setTimeout(resolve, 25))

    await expect(broker.callback(
      'partitioned-callback.runtime',
      { profile: 'a-2' },
      { ...profileA, callbackId: 'callback-a-2' },
      { retentionMs: 20 }
    )).resolves.toEqual({ profile: 'a-2' })
    await expect(broker.callback(
      'partitioned-callback.runtime',
      { profile: 'c' },
      { callbackId: 'callback-c', profileKey: 'profile-c' },
      { retentionMs: 20 }
    )).resolves.toEqual({ profile: 'c' })
    await broker.dispose()
  })

  it('reclaims lease-scoped callback records and rejects stale callbacks on release', async () => {
    const callback = vi.fn(async (payload: unknown) => payload)
    const broker = new RuntimeBroker({ maxCallbackEntries: 1, pollTimeoutMs: 1 })
    broker.registerDriver({
      id: 'lease-callback.runtime',
      acquire: async () => ({ invoke: async () => ({}), release: () => undefined }),
      callback
    })
    const acquired = await broker.acquire('workspace:a', {
      driverId: 'lease-callback.runtime',
      profileKey: 'profile-a'
    })
    const context = {
      callbackId: 'callback-a',
      leaseId: acquired.leaseId,
      profileKey: 'profile-a'
    }
    await broker.callback('lease-callback.runtime', { sequence: 1 }, context)

    await broker.release('workspace:a', acquired.leaseId)

    await expect(broker.callback(
      'lease-callback.runtime',
      { sequence: 1 },
      context
    )).rejects.toMatchObject({ code: 'lease_not_found' })
    expect(() => broker.acknowledgeCallback('lease-callback.runtime', context)).not.toThrow()
    expect(callback).toHaveBeenCalledOnce()
    await broker.dispose()
  })
})
