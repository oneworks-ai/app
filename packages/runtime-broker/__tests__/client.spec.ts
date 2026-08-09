import { describe, expect, it, vi } from 'vitest'

import { RuntimeBroker, RuntimeBrokerError, RuntimeBrokerHttpClient } from '#~/index.js'

const okResponse = (result: unknown) =>
  ({
    json: async () => ({ ok: true, result }),
    ok: true,
    status: 200
  }) as Response

const errorResponse = (code: string, message = code) =>
  ({
    json: async () => ({ ok: false, error: { code, message } }),
    ok: true,
    status: 200
  }) as Response

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

const createClient = (
  fetchMock: typeof fetch,
  errors: unknown[] = [],
  options: Partial<ConstructorParameters<typeof RuntimeBrokerHttpClient>[0]> = {}
) =>
  new RuntimeBrokerHttpClient({
    fetch: fetchMock,
    onError: error => errors.push(error),
    token: 'workspace-token',
    url: 'http://127.0.0.1:8787/api/internal/runtime-broker',
    ...options
  })

describe('runtime broker HTTP client', () => {
  it('rejects invalid timer options and derived budgets before transport starts', () => {
    const invalidOptions = [
      { acquireRequestTimeoutMs: Number.NaN },
      { callbackAttemptTimeoutMs: Number.POSITIVE_INFINITY },
      { callbackRequestTimeoutMs: 1.5 },
      { callbackAttemptTimeoutMs: 1, callbackRequestTimeoutMs: Number.NaN },
      { callbackTotalTimeoutMs: 2_147_483_647 },
      { controlRequestTimeoutMs: 0 },
      { invokeRequestTimeoutMs: -1 },
      { pollTimeoutMs: Number.NaN },
      { pollTransportGraceMs: Number.POSITIVE_INFINITY },
      { pollTimeoutMs: 2_147_483_647, pollTransportGraceMs: 1 },
      { requestHandlerTimeoutMs: 1.5 }
    ]
    for (const options of invalidOptions) {
      expect(() => createClient(vi.fn() as typeof fetch, [], options)).toThrowError(
        expect.objectContaining({ code: 'invalid_client_options' })
      )
    }
  })

  it('validates per-call timeouts and gives raw requests a default hard deadline', async () => {
    let requestSignal: AbortSignal | undefined
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal
      return await new Promise<Response>(() => undefined)
    })
    const client = createClient(fetchMock as typeof fetch, [], { controlRequestTimeoutMs: 10 })

    await expect(client.request({ action: 'raw' }, { timeoutMs: Number.NaN }))
      .rejects.toMatchObject({ code: 'invalid_client_options' })
    expect(fetchMock).not.toHaveBeenCalled()

    await expect(client.request({ action: 'raw' })).rejects.toMatchObject({
      code: 'transport_error'
    })
    expect(requestSignal?.aborted).toBe(true)
  })

  it('keeps a live lease polling after a transient transport failure', async () => {
    let pollAttempts = 0
    const errors: unknown[] = []
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { action?: string }
      if (body.action === 'acquire') return okResponse({ leaseId: 'lease-a' })
      if (body.action === 'release') return okResponse({})
      if (body.action !== 'poll') throw new Error(`Unexpected action: ${body.action}`)
      pollAttempts += 1
      if (pollAttempts === 1) throw new Error('temporary connection reset')
      return okResponse({
        events: [{ cursor: 1, kind: 'event', name: 'ready', payload: { pid: 42 } }],
        nextCursor: 1
      })
    })
    const lease = await createClient(fetchMock as typeof fetch, errors).acquire({
      driverId: 'fake.runtime',
      profileKey: 'profile-a'
    })

    const received = new Promise<unknown>((resolve) => {
      lease.onEvent('ready', (payload) => {
        lease.release()
        resolve(payload)
      })
    })

    await expect(received).resolves.toEqual({ pid: 42 })
    expect(pollAttempts).toBeGreaterThanOrEqual(2)
    expect(errors).toHaveLength(1)
  })

  it('continues polling while a long request handler is still running', async () => {
    const handlerGate = deferred<void>()
    const secondPoll = deferred<Response>()
    let pollAttempts = 0
    let lease: Awaited<ReturnType<RuntimeBrokerHttpClient['acquire']>>
    const responded = deferred<void>()
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { action?: string }
      if (body.action === 'acquire') return okResponse({ leaseId: 'lease-long' })
      if (body.action === 'respond') {
        responded.resolve()
        lease.release()
        secondPoll.resolve(okResponse({ events: [], nextCursor: 1 }))
        return okResponse({})
      }
      if (body.action === 'release') return okResponse({})
      if (body.action !== 'poll') throw new Error(`Unexpected action: ${body.action}`)
      pollAttempts += 1
      if (pollAttempts === 1) {
        return okResponse({
          events: [{ cursor: 1, kind: 'request', name: 'hook', requestId: 'request-long' }],
          nextCursor: 1
        })
      }
      return await secondPoll.promise
    })
    lease = await createClient(fetchMock as typeof fetch).acquire({
      driverId: 'fake.runtime',
      profileKey: 'profile-a'
    })
    lease.onRequest('hook', async () => {
      await handlerGate.promise
      return { continue: true }
    })

    await vi.waitFor(() => expect(pollAttempts).toBe(2))
    handlerGate.resolve()
    await responded.promise
  })

  it('retries an ambiguously delivered response without re-running the handler', async () => {
    const blockedPoll = deferred<Response>()
    let handlerCalls = 0
    let pollAttempts = 0
    let respondAttempts = 0
    let firstRespondSignal: AbortSignal | undefined
    let lease: Awaited<ReturnType<RuntimeBrokerHttpClient['acquire']>>
    const completed = deferred<void>()
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { action?: string; requestId?: string }
      if (body.action === 'acquire') return okResponse({ leaseId: 'lease-response' })
      if (body.action === 'release') return okResponse({})
      if (body.action === 'respond') {
        respondAttempts += 1
        expect(body.requestId).toBe('request-a')
        if (respondAttempts === 1) {
          firstRespondSignal = init?.signal as AbortSignal
          return await new Promise<Response>(() => undefined)
        }
        lease.release()
        blockedPoll.resolve(okResponse({ events: [], nextCursor: 1 }))
        completed.resolve()
        return okResponse({})
      }
      if (body.action !== 'poll') throw new Error(`Unexpected action: ${body.action}`)
      pollAttempts += 1
      if (pollAttempts === 1) {
        return okResponse({
          events: [{ cursor: 1, kind: 'request', name: 'hook', requestId: 'request-a' }],
          nextCursor: 1
        })
      }
      return await blockedPoll.promise
    })
    lease = await createClient(fetchMock as typeof fetch, [], {
      controlRequestTimeoutMs: 20
    }).acquire({
      driverId: 'fake.runtime',
      profileKey: 'profile-a'
    })
    lease.onRequest('hook', () => {
      handlerCalls += 1
      return { continue: true }
    })

    await completed.promise
    expect(handlerCalls).toBe(1)
    expect(respondAttempts).toBe(2)
    expect(firstRespondSignal?.aborted).toBe(true)
  })

  it('retries invocations with the same idempotency key', async () => {
    const blockedPoll = deferred<Response>()
    const invocationIds: string[] = []
    let firstInvokeSignal: AbortSignal | undefined
    let invokeAttempts = 0
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { action?: string; invocationId?: string }
      if (body.action === 'acquire') return okResponse({ leaseId: 'lease-invoke' })
      if (body.action === 'release') return okResponse({})
      if (body.action === 'poll') return await blockedPoll.promise
      if (body.action !== 'invoke') throw new Error(`Unexpected action: ${body.action}`)
      invokeAttempts += 1
      invocationIds.push(body.invocationId!)
      if (invokeAttempts === 1) {
        firstInvokeSignal = init?.signal as AbortSignal
        return await new Promise<Response>(() => undefined)
      }
      return okResponse({ pong: true })
    })
    const lease = await createClient(fetchMock as typeof fetch, [], {
      invokeRequestTimeoutMs: 20
    }).acquire({
      driverId: 'fake.runtime',
      profileKey: 'profile-a'
    })

    await expect(lease.invoke('ping')).resolves.toEqual({ pong: true })
    lease.release()
    blockedPoll.resolve(okResponse({ events: [], nextCursor: 0 }))
    expect(invocationIds).toHaveLength(2)
    expect(invocationIds[0]).toBe(invocationIds[1])
    expect(firstInvokeSignal?.aborted).toBe(true)
  })

  it('terminalizes an unrecoverable event gap and releases the lease', async () => {
    let pollAttempts = 0
    let releaseAttempts = 0
    const errors: unknown[] = []
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { action?: string }
      if (body.action === 'acquire') return okResponse({ leaseId: 'lease-gap' })
      if (body.action === 'release') {
        releaseAttempts += 1
        return okResponse({})
      }
      if (body.action === 'poll') {
        pollAttempts += 1
        return errorResponse('event_gap')
      }
      throw new Error(`Unexpected action: ${body.action}`)
    })
    const lease = await createClient(fetchMock as typeof fetch, errors).acquire({
      driverId: 'fake.runtime',
      profileKey: 'profile-a'
    })
    lease.onEvent('ready', () => undefined)

    await vi.waitFor(() => expect(releaseAttempts).toBe(1))
    expect(pollAttempts).toBe(1)
    expect(errors).toHaveLength(1)
  })

  it('retries callbacks with one stable idempotency key', async () => {
    const callbackIds: string[] = []
    let attempts = 0
    const errors: unknown[] = []
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { action?: string; callbackId?: string }
      if (body.action === 'callback_ack') return okResponse({})
      expect(body.action).toBe('callback')
      callbackIds.push(body.callbackId!)
      attempts += 1
      if (attempts === 1) throw new Error('callback response lost after acceptance')
      return okResponse({ continue: false })
    })

    await expect(
      createClient(fetchMock as typeof fetch, errors).callback(
        'fake.runtime',
        { hook: 'PreToolUse' }
      )
    ).resolves.toEqual({ continue: false })
    expect(callbackIds).toHaveLength(2)
    expect(callbackIds[0]).toBe(callbackIds[1])
    expect(errors).toHaveLength(1)
  })

  it('retries a long default-budget callback before a 720-second native hook deadline', async () => {
    vi.useFakeTimers()
    try {
      const startedAt = Date.now()
      const callbackIds: string[] = []
      let callbackAttempts = 0
      const resultReady = deferred<void>()
      setTimeout(() => resultReady.resolve(), 650_000)
      const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { action?: string; callbackId?: string }
        if (body.action === 'callback_ack') return okResponse({})
        callbackAttempts += 1
        callbackIds.push(body.callbackId!)
        if (callbackAttempts === 1) return await new Promise<Response>(() => undefined)
        await resultReady.promise
        return okResponse({ decision: 'block' })
      })
      const result = createClient(fetchMock as typeof fetch).callback('callback.runtime', {})

      await vi.advanceTimersByTimeAsync(650_000)

      await expect(result).resolves.toEqual({ decision: 'block' })
      expect(callbackAttempts).toBeGreaterThan(2)
      expect(new Set(callbackIds).size).toBe(1)
      expect(Date.now() - startedAt).toBeLessThan(720_000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts a hung long poll before the lease TTL and resumes polling', async () => {
    vi.useFakeTimers()
    try {
      let firstPollSignal: AbortSignal | undefined
      let pollAttempts = 0
      const received = deferred<void>()
      const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { action?: string }
        if (body.action === 'acquire') return okResponse({ leaseId: 'lease-poll-timeout' })
        if (body.action === 'release') return okResponse({})
        if (body.action !== 'poll') throw new Error(`Unexpected action: ${body.action}`)
        pollAttempts += 1
        if (pollAttempts === 1) {
          firstPollSignal = init?.signal as AbortSignal
          return await new Promise<Response>(() => undefined)
        }
        return okResponse({
          events: [{ cursor: 1, kind: 'event', name: 'ready' }],
          nextCursor: 1
        })
      })
      const lease = await createClient(fetchMock as typeof fetch, [], {
        pollTimeoutMs: 10,
        pollTransportGraceMs: 5
      }).acquire({ driverId: 'fake.runtime', profileKey: 'profile-a' })
      lease.onEvent('ready', () => {
        lease.release()
        received.resolve()
      })

      await vi.advanceTimersByTimeAsync(515)
      await received.promise

      expect(firstPollSignal?.aborted).toBe(true)
      expect(pollAttempts).toBeGreaterThanOrEqual(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('contains lost callback acknowledgements to one driver profile partition', async () => {
    const callback = vi.fn(async (payload: unknown) => payload)
    const broker = new RuntimeBroker({ maxCallbackEntries: 1, pollTimeoutMs: 1 })
    broker.registerDriver({
      id: 'callback.runtime',
      acquire: async () => ({ invoke: async () => ({}), release: () => undefined }),
      callback
    })
    const createCallbackClient = (profileKey: string) => {
      const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          action?: string
          callbackId?: string
          callbackRetentionMs?: number
          driverId?: string
          payload?: unknown
        }
        if (body.action === 'callback_ack') throw new Error('acknowledgement lost')
        try {
          const result = await broker.callback(body.driverId!, body.payload, {
            callbackId: body.callbackId,
            profileKey
          }, { retentionMs: body.callbackRetentionMs })
          return okResponse(result)
        } catch (error) {
          if (error instanceof RuntimeBrokerError) return errorResponse(error.code, error.message)
          throw error
        }
      })
      return createClient(fetchMock as typeof fetch)
    }
    const profileA = createCallbackClient('profile-a')
    const profileB = createCallbackClient('profile-b')

    await expect(profileA.callback('callback.runtime', { profile: 'a' })).resolves.toEqual({
      profile: 'a'
    })
    await expect(profileA.callback('callback.runtime', { profile: 'a-2' })).rejects.toMatchObject({
      code: 'callback_capacity'
    })
    await expect(profileB.callback('callback.runtime', { profile: 'b' })).resolves.toEqual({
      profile: 'b'
    })
    expect(callback).toHaveBeenCalledTimes(2)
    await broker.dispose()
  })

  it('does not re-execute an accepted callback after its first HTTP response exceeds the attempt deadline', async () => {
    const callback = vi.fn(async () => ({ decision: 'block' }))
    const broker = new RuntimeBroker({ pollTimeoutMs: 1 })
    broker.registerDriver({
      id: 'callback.runtime',
      acquire: async () => ({ invoke: async () => ({}), release: () => undefined }),
      callback
    })
    const acquired = await broker.acquire('workspace:a', {
      driverId: 'callback.runtime',
      profileKey: 'profile-a'
    })
    let callbackAttempts = 0
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        action?: string
        callbackId?: string
        driverId?: string
        payload?: unknown
      }
      const context = {
        callbackId: body.callbackId,
        leaseId: acquired.leaseId,
        profileKey: 'profile-a'
      }
      if (body.action === 'callback_ack') {
        broker.acknowledgeCallback(body.driverId!, context)
        return okResponse({})
      }
      callbackAttempts += 1
      const result = await broker.callback(body.driverId!, body.payload, context)
      if (callbackAttempts === 1) {
        await new Promise(resolve => setTimeout(resolve, 40))
      }
      return okResponse(result)
    })
    const client = new RuntimeBrokerHttpClient({
      callbackRequestTimeoutMs: 20,
      callbackTotalTimeoutMs: 500,
      fetch: fetchMock as typeof fetch,
      token: 'callback-token',
      url: 'http://127.0.0.1/runtime-broker'
    })

    await expect(client.callback('callback.runtime', { hook: 'PreToolUse' })).resolves.toEqual({
      decision: 'block'
    })
    expect(callbackAttempts).toBe(2)
    expect(callback).toHaveBeenCalledOnce()
    await broker.dispose()
  })
})
