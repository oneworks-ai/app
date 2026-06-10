import { afterEach, describe, expect, it, vi } from 'vitest'

import { submitLocalRelaySessionMessage } from '../src/server/session-adapter.js'
import { createRelaySessionWorker } from '../src/server/session-worker.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('relay plugin session worker', () => {
  it('pushes snapshots, polls queued jobs, and posts job results', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/relay/devices/device-1/sessions/snapshot')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      if (url.endsWith('/api/relay/devices/device-1/session-jobs?status=queued&limit=5')) {
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
})
