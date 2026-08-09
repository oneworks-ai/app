import { describe, expect, it, vi } from 'vitest'

import { RuntimeBrokerHttpClient } from '#~/index.js'

const okResponse = (result: unknown) =>
  ({
    json: async () => ({ ok: true, result }),
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

const createClient = (fetchMock: typeof fetch) =>
  new RuntimeBrokerHttpClient({
    fetch: fetchMock,
    token: 'workspace-token',
    url: 'http://127.0.0.1:8787/api/internal/runtime-broker'
  })

describe('runtime broker remote lease lifecycle', () => {
  it('rejects remote admission settings that exceed the fixed hard limit', () => {
    for (const maxPendingRequests of [Number.NaN, Number.POSITIVE_INFINITY, 0, 4_097]) {
      expect(() =>
        new RuntimeBrokerHttpClient({
          fetch: vi.fn() as typeof fetch,
          maxPendingRequests,
          token: 'workspace-token',
          url: 'http://127.0.0.1:8787/api/internal/runtime-broker'
        })
      ).toThrowError(expect.objectContaining({ code: 'invalid_client_options' }))
    }
  })

  it('delivers lifecycle events while a workspace request handler is non-settling', async () => {
    const handlerStarted = deferred<void>()
    const blockedPoll = deferred<Response>()
    let handlerCalls = 0
    let handlerSignal: AbortSignal | undefined
    let pollAttempts = 0
    let releaseAttempts = 0
    const exited = deferred<void>()
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { action?: string }
      if (body.action === 'acquire') return okResponse({ leaseId: 'lease-exit' })
      if (body.action === 'release') {
        releaseAttempts += 1
        blockedPoll.resolve(okResponse({ events: [], nextCursor: 2 }))
        return okResponse({})
      }
      if (body.action !== 'poll') throw new Error(`Unexpected action: ${body.action}`)
      pollAttempts += 1
      if (pollAttempts === 1) {
        return okResponse({
          events: [{
            cursor: 1,
            kind: 'request',
            name: 'hook',
            requestDeadlineAt: Date.now() + 10_000,
            requestId: 'request-never'
          }],
          nextCursor: 1
        })
      }
      if (pollAttempts === 2) {
        await handlerStarted.promise
        return okResponse({
          events: [{ cursor: 2, kind: 'event', name: 'exit', payload: { code: 1 } }],
          nextCursor: 2
        })
      }
      return await blockedPoll.promise
    })
    const lease = await createClient(fetchMock as typeof fetch).acquire({
      driverId: 'fake.runtime',
      profileKey: 'profile-a'
    })
    lease.onRequest('hook', async (_payload, context) => {
      handlerCalls += 1
      handlerSignal = context.signal
      handlerStarted.resolve()
      return await new Promise<never>(() => undefined)
    })
    lease.onEvent('exit', () => {
      lease.release()
      exited.resolve()
    })

    await exited.promise
    await vi.waitFor(() => expect(releaseAttempts).toBe(1))

    expect(handlerCalls).toBe(1)
    expect(handlerSignal?.aborted).toBe(true)
    expect(pollAttempts).toBeGreaterThanOrEqual(2)
  })

  it('aborts a non-settling request handler at the broker-provided deadline', async () => {
    const blockedPoll = deferred<Response>()
    let handlerSignal: AbortSignal | undefined
    let pollAttempts = 0
    const responded = deferred<unknown>()
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { action?: string; payload?: unknown }
      if (body.action === 'acquire') return okResponse({ leaseId: 'lease-request-timeout' })
      if (body.action === 'release') {
        blockedPoll.resolve(okResponse({ events: [], nextCursor: 1 }))
        return okResponse({})
      }
      if (body.action === 'respond') {
        responded.resolve(body.payload)
        return okResponse({})
      }
      if (body.action !== 'poll') throw new Error(`Unexpected action: ${body.action}`)
      pollAttempts += 1
      if (pollAttempts > 1) return await blockedPoll.promise
      return okResponse({
        events: [{
          cursor: 1,
          kind: 'request',
          name: 'hook',
          requestDeadlineAt: Date.now() + 10,
          requestId: 'request-timeout'
        }],
        nextCursor: 1
      })
    })
    const lease = await createClient(fetchMock as typeof fetch).acquire({
      driverId: 'fake.runtime',
      profileKey: 'profile-a'
    })
    lease.onRequest('hook', async (_payload, context) => {
      handlerSignal = context.signal
      return await new Promise<never>(() => undefined)
    })

    await expect(responded.promise).resolves.toMatchObject({
      error: expect.stringContaining('Runtime broker request deadline expired at')
    })
    expect(handlerSignal?.aborted).toBe(true)
    lease.release()
  })

  it('does not execute a queued request after its end-to-end deadline expires', async () => {
    const blockedPoll = deferred<Response>()
    let pollAttempts = 0
    const responses = new Map<string, unknown>()
    const allResponded = deferred<void>()
    const staleHandler = vi.fn()
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        action?: string
        payload?: unknown
        requestId?: string
      }
      if (body.action === 'acquire') return okResponse({ leaseId: 'lease-queued-deadline' })
      if (body.action === 'release') {
        blockedPoll.resolve(okResponse({ events: [], nextCursor: 2 }))
        return okResponse({})
      }
      if (body.action === 'respond') {
        responses.set(body.requestId!, body.payload)
        if (responses.size === 2) allResponded.resolve()
        return okResponse({})
      }
      if (body.action !== 'poll') throw new Error(`Unexpected action: ${body.action}`)
      pollAttempts += 1
      if (pollAttempts > 1) return await blockedPoll.promise
      const now = Date.now()
      return okResponse({
        events: [
          {
            cursor: 1,
            kind: 'request',
            name: 'slow',
            requestDeadlineAt: now + 1_000,
            requestId: 'request-slow'
          },
          {
            cursor: 2,
            kind: 'request',
            name: 'stale',
            requestDeadlineAt: now + 10,
            requestId: 'request-stale'
          }
        ],
        nextCursor: 2
      })
    })
    const lease = await createClient(fetchMock as typeof fetch).acquire({
      driverId: 'fake.runtime',
      profileKey: 'profile-a'
    })
    lease.onRequest('slow', async () => {
      await new Promise(resolve => setTimeout(resolve, 30))
      return 'slow-ok'
    })
    lease.onRequest('stale', staleHandler)

    await allResponded.promise

    expect(staleHandler).not.toHaveBeenCalled()
    expect(responses.get('request-stale')).toMatchObject({
      error: expect.stringContaining('Runtime broker request deadline expired at')
    })
    lease.release()
  })

  it('bounds remote request admission without executing overflow handlers', async () => {
    const blockedPoll = deferred<Response>()
    const errors: unknown[] = []
    let pollAttempts = 0
    const firstResponseBatch = deferred<void>()
    const overflowResponses = new Map<string, unknown>()
    const allOverflowResponded = deferred<void>()
    const overflowHandler = vi.fn()
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        action?: string
        payload?: unknown
        requestId?: string
      }
      if (body.action === 'acquire') return okResponse({ leaseId: 'lease-capacity' })
      if (body.action === 'release') {
        blockedPoll.resolve(okResponse({ events: [], nextCursor: 11 }))
        return okResponse({})
      }
      if (body.action === 'respond') {
        if (body.requestId?.startsWith('request-overflow') === true) {
          overflowResponses.set(body.requestId, body.payload)
          if (overflowResponses.size === 8) firstResponseBatch.resolve()
          await firstResponseBatch.promise
          if (overflowResponses.size === 10) allOverflowResponded.resolve()
        }
        return okResponse({})
      }
      if (body.action !== 'poll') throw new Error(`Unexpected action: ${body.action}`)
      pollAttempts += 1
      if (pollAttempts > 1) return await blockedPoll.promise
      const requestDeadlineAt = Date.now() + 10_000
      return okResponse({
        events: [
          { cursor: 1, kind: 'request', name: 'blocked', requestDeadlineAt, requestId: 'request-blocked' },
          ...Array.from({ length: 10 }, (_, index) => ({
            cursor: index + 2,
            kind: 'request' as const,
            name: 'overflow',
            requestDeadlineAt,
            requestId: `request-overflow-${index + 1}`
          }))
        ],
        nextCursor: 11
      })
    })
    const lease = await new RuntimeBrokerHttpClient({
      fetch: fetchMock as typeof fetch,
      maxPendingRequests: 1,
      onError: error => errors.push(error),
      token: 'workspace-token',
      url: 'http://127.0.0.1:8787/api/internal/runtime-broker'
    }).acquire({ driverId: 'fake.runtime', profileKey: 'profile-a' })
    lease.onRequest('blocked', async () => await new Promise<never>(() => undefined))
    lease.onRequest('overflow', overflowHandler)

    await allOverflowResponded.promise

    expect(overflowHandler).not.toHaveBeenCalled()
    expect([...overflowResponses.values()]).toEqual(Array.from({ length: 10 }, () => ({
      error: 'Runtime broker remote request capacity is exhausted; the handler was not executed.'
    })))
    expect(errors).toEqual(Array.from({ length: 10 }, () => expect.objectContaining({ code: 'request_capacity' })))
    lease.release()
  })

  it('continues polling lifecycle events while rejection responses are saturated', async () => {
    const blockedPoll = deferred<Response>()
    const exited = deferred<void>()
    const overflowHandler = vi.fn()
    let activeResponses = 0
    let maxActiveResponses = 0
    let pollAttempts = 0
    let releaseAttempts = 0
    let respondAttempts = 0
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { action?: string }
      if (body.action === 'acquire') return okResponse({ leaseId: 'lease-capacity-exit' })
      if (body.action === 'release') {
        releaseAttempts += 1
        blockedPoll.resolve(okResponse({ events: [], nextCursor: 11 }))
        return okResponse({})
      }
      if (body.action === 'respond') {
        respondAttempts += 1
        activeResponses += 1
        maxActiveResponses = Math.max(maxActiveResponses, activeResponses)
        const signal = init?.signal as AbortSignal
        try {
          return await new Promise<Response>((_resolve, reject) => {
            const abort = () => reject(signal.reason)
            if (signal.aborted) return abort()
            signal.addEventListener('abort', abort, { once: true })
          })
        } finally {
          activeResponses -= 1
        }
      }
      if (body.action !== 'poll') throw new Error(`Unexpected action: ${body.action}`)
      pollAttempts += 1
      const requestDeadlineAt = Date.now() + 1_000
      if (pollAttempts === 1) {
        return okResponse({
          events: [
            { cursor: 1, kind: 'request', name: 'blocked', requestDeadlineAt, requestId: 'blocked' },
            ...Array.from({ length: 8 }, (_, index) => ({
              cursor: index + 2,
              kind: 'request' as const,
              name: 'overflow',
              requestDeadlineAt,
              requestId: `overflow-${index + 1}`
            }))
          ],
          nextCursor: 9
        })
      }
      if (pollAttempts === 2) {
        return okResponse({
          events: [{ cursor: 10, kind: 'request', name: 'overflow', requestDeadlineAt, requestId: 'overflow-9' }],
          nextCursor: 10
        })
      }
      if (pollAttempts === 3) {
        return okResponse({
          events: [{ cursor: 11, kind: 'event', name: 'exit' }],
          nextCursor: 11
        })
      }
      return await blockedPoll.promise
    })
    const lease = await new RuntimeBrokerHttpClient({
      controlRequestTimeoutMs: 20,
      fetch: fetchMock as typeof fetch,
      maxPendingRequests: 1,
      token: 'workspace-token',
      url: 'http://127.0.0.1:8787/api/internal/runtime-broker'
    }).acquire({ driverId: 'fake.runtime', profileKey: 'profile-a' })
    lease.onRequest('blocked', async () => await new Promise<never>(() => undefined))
    lease.onRequest('overflow', overflowHandler)
    lease.onEvent('exit', () => {
      lease.release()
      exited.resolve()
    })

    await exited.promise
    await vi.waitFor(() => expect(releaseAttempts).toBe(1))

    expect(pollAttempts).toBeGreaterThanOrEqual(3)
    expect(respondAttempts).toBe(8)
    expect(maxActiveResponses).toBe(8)
    expect(overflowHandler).not.toHaveBeenCalled()
  })
})
