import { Buffer } from 'node:buffer'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { submitLocalRelaySessionMessage } from '../src/server/session-adapter.js'
import { createRelaySessionWorker } from '../src/server/session-worker.js'
import { RELAY_WORKSPACE_HTTP_MODE } from '../src/server/workspace-http-forwarder.js'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const waitFor = async (predicate: () => boolean, timeoutMs = 500) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  expect(predicate()).toBe(true)
}

describe('relay plugin session worker', () => {
  it('pushes snapshots, polls queued jobs, and posts job results', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/relay/devices/device-1/sessions/snapshot')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      if (url.endsWith('/api/relay/devices/device-1/session-jobs?status=queued&limit=50&waitMs=10000')) {
        return new Response(
          JSON.stringify({
            jobs: [
              {
                id: 'job-1',
                deviceId: 'device-1',
                sessionId: 'session-1',
                status: 'queued',
                payload: {
                  message: 'hello'
                }
              }
            ]
          }),
          { status: 200 }
        )
      }
      if (url.endsWith('/api/relay/session-jobs/job-1/status')) {
        return new Response(
          JSON.stringify({
            ok: true,
            body: init?.body == null ? undefined : JSON.parse(String(init.body))
          }),
          { status: 200 }
        )
      }
      return new Response(JSON.stringify({ error: 'unexpected request' }), { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const worker = createRelaySessionWorker({
      auth: {
        deviceId: 'device-1',
        deviceToken: 'device-token',
        remoteBaseUrl: 'https://relay.example'
      },
      adapter: {
        listSessions: () => [{ id: 'session-1', title: 'Office chat' }],
        submitMessage: input => ({ echoed: input.message })
      }
    })

    await worker.runOnce()
    worker.stop()

    await waitFor(() => fetchMock.mock.calls.length >= 4)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://relay.example/api/relay/devices/device-1/sessions/snapshot'
    )
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      deviceId: 'device-1',
      sessions: [
        {
          id: 'session-1'
        }
      ]
    })
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({ status: 'running' })
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toEqual({
      result: {
        echoed: 'hello'
      },
      status: 'succeeded'
    })
  })

  it('forwards workspace HTTP jobs without a local session adapter', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/relay/devices/device-1/session-jobs?status=queued&limit=50&waitMs=10000')) {
        return new Response(
          JSON.stringify({
            jobs: [
              {
                id: 'job-1',
                deviceId: 'device-1',
                sessionId: 'workspace-request-1',
                status: 'queued',
                mode: RELAY_WORKSPACE_HTTP_MODE,
                payload: {
                  message: JSON.stringify({
                    method: 'GET',
                    path: '/ping',
                    serverBaseUrl: 'http://127.0.0.1:54321'
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
      }
      if (url.endsWith('/api/relay/session-jobs/job-1/status')) {
        return new Response(
          JSON.stringify({
            ok: true,
            body: init?.body == null ? undefined : JSON.parse(String(init.body))
          }),
          { status: 200 }
        )
      }
      if (url === 'http://127.0.0.1:54321/ping') {
        return new Response('pong', {
          headers: {
            'content-type': 'text/plain'
          },
          status: 200
        })
      }
      return new Response(JSON.stringify({ error: 'unexpected request' }), { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const worker = createRelaySessionWorker({
      auth: {
        deviceId: 'device-1',
        deviceToken: 'device-token',
        remoteBaseUrl: 'https://relay.example'
      }
    })

    await worker.runOnce()
    worker.stop()

    await waitFor(() => fetchMock.mock.calls.length >= 4)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://relay.example/api/relay/devices/device-1/session-jobs?status=queued&limit=50&waitMs=10000'
    )
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ status: 'running' })
    expect(String(fetchMock.mock.calls[2][0])).toBe('http://127.0.0.1:54321/ping')
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toMatchObject({
      result: {
        bodyBase64: Buffer.from('pong').toString('base64'),
        status: 200
      },
      status: 'succeeded'
    })
  })

  it('skips unchanged snapshots between refresh windows', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/relay/devices/device-1/sessions/snapshot')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      if (url.endsWith('/api/relay/devices/device-1/session-jobs?status=queued&limit=50&waitMs=10000')) {
        return new Response(JSON.stringify({ jobs: [] }), { status: 200 })
      }
      return new Response(JSON.stringify({ error: 'unexpected request' }), { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const worker = createRelaySessionWorker({
      auth: {
        deviceId: 'device-1',
        deviceToken: 'device-token',
        remoteBaseUrl: 'https://relay.example'
      },
      adapter: {
        listSessions: () => [{ id: 'session-1', title: 'Office chat' }],
        submitMessage: input => ({ echoed: input.message })
      }
    })

    await worker.runOnce()
    await worker.runOnce()
    worker.stop()

    expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
      'https://relay.example/api/relay/devices/device-1/sessions/snapshot',
      'https://relay.example/api/relay/devices/device-1/session-jobs?status=queued&limit=50&waitMs=10000',
      'https://relay.example/api/relay/devices/device-1/session-jobs?status=queued&limit=50&waitMs=10000'
    ])
  })

  it('backs off when a due snapshot fails instead of retrying immediately', async () => {
    vi.useFakeTimers()
    let snapshotCalls = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/relay/devices/device-1/sessions/snapshot')) {
        snapshotCalls += 1
        if (snapshotCalls > 1) throw new Error('relay offline')
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      if (url.endsWith('/api/relay/devices/device-1/session-jobs?status=queued&limit=50&waitMs=10000')) {
        return new Response(JSON.stringify({ jobs: [] }), { status: 200 })
      }
      return new Response(JSON.stringify({ error: 'unexpected request' }), { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const logger = {
      warn: vi.fn()
    }
    const worker = createRelaySessionWorker({
      auth: {
        deviceId: 'device-1',
        deviceToken: 'device-token',
        remoteBaseUrl: 'https://relay.example'
      },
      adapter: {
        listSessions: () => [{ id: 'session-1', title: 'Office chat' }],
        submitMessage: input => ({ echoed: input.message })
      },
      errorLogIntervalMs: 5000,
      intervalMs: 1000,
      logger,
      maxErrorIntervalMs: 8000,
      maxIdleIntervalMs: 1000,
      snapshotRefreshMs: 1000
    })

    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(logger.warn).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1999)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(logger.warn).toHaveBeenCalledTimes(1)

    worker.stop()
  })

  it('turns local adapter failures into failed job updates', async () => {
    const update = await submitLocalRelaySessionMessage({
      submitMessage: () => {
        throw Object.assign(new Error('local error text is not relayed'), { code: 'adapter_offline' })
      }
    }, {
      id: 'job-1',
      deviceId: 'device-1',
      sessionId: 'session-1',
      status: 'queued',
      payload: {
        message: 'hello'
      }
    })

    expect(update).toEqual({
      errorCode: 'adapter_offline',
      status: 'failed'
    })
  })

  it('keeps workspace forwarding responsive while a session job is still running', async () => {
    const statusBodies: unknown[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/relay/devices/device-1/sessions/snapshot')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      if (url.endsWith('/api/relay/devices/device-1/session-jobs?status=queued&limit=50&waitMs=10000')) {
        return new Response(
          JSON.stringify({
            jobs: [
              {
                id: 'session-job',
                deviceId: 'device-1',
                sessionId: 'session-1',
                status: 'queued',
                payload: {
                  message: 'keep running'
                }
              },
              {
                id: 'workspace-job',
                deviceId: 'device-1',
                sessionId: 'workspace-request-1',
                status: 'queued',
                mode: RELAY_WORKSPACE_HTTP_MODE,
                payload: {
                  message: JSON.stringify({
                    method: 'GET',
                    path: '/config',
                    serverBaseUrl: 'http://127.0.0.1:54321'
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
      }
      if (
        url.endsWith('/api/relay/session-jobs/session-job/status') ||
        url.endsWith('/api/relay/session-jobs/workspace-job/status')
      ) {
        statusBodies.push(init?.body == null ? undefined : JSON.parse(String(init.body)))
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      if (url === 'http://127.0.0.1:54321/config') {
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            'content-type': 'application/json'
          },
          status: 200
        })
      }
      return new Response(JSON.stringify({ error: 'unexpected request' }), { status: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const worker = createRelaySessionWorker({
      auth: {
        deviceId: 'device-1',
        deviceToken: 'device-token',
        remoteBaseUrl: 'https://relay.example'
      },
      adapter: {
        listSessions: () => [{ id: 'session-1', title: 'Office chat' }],
        submitMessage: () => new Promise(() => {})
      }
    })

    await worker.runOnce()
    await waitFor(() =>
      statusBodies.some(body =>
        typeof body === 'object' &&
        body != null &&
        'status' in body &&
        body.status === 'succeeded'
      )
    )
    worker.stop()

    expect(fetchMock.mock.calls.map(call => String(call[0]))).toContain('http://127.0.0.1:54321/config')
    expect(statusBodies).toContainEqual({ status: 'running' })
    expect(statusBodies).toContainEqual(expect.objectContaining({
      result: expect.objectContaining({ status: 200 }),
      status: 'succeeded'
    }))
  })
})
