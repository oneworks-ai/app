import { afterEach, describe, expect, it, vi } from 'vitest'

import { createLocalRelaySessionSnapshot, submitLocalRelaySessionMessage } from '../src/server/session-adapter.js'
import {
  pollRelaySessionForwardingJobs,
  pushRelaySessionSnapshot,
  updateRelaySessionForwardingJobStatus
} from '../src/server/session-relay-client.js'
import { cleanupPluginFixtures } from './helpers.js'

afterEach(cleanupPluginFixtures)

describe('relay plugin session helpers', () => {
  it('normalizes local sessions and submits forwarding jobs through the adapter', async () => {
    const adapter = {
      listSessions: vi.fn(async () => [
        {
          adapter: 'codex',
          id: 'session-1',
          lastMessage: 'do not relay this',
          messageCount: '4',
          metadata: { source: 'test' },
          title: 'Relay session',
          userId: 'user-1'
        },
        {
          title: 'missing id'
        }
      ]),
      submitMessage: vi.fn(async () => ({ accepted: true }))
    }

    const snapshot = await createLocalRelaySessionSnapshot(adapter, 'device-1')
    const update = await submitLocalRelaySessionMessage(adapter, {
      id: 'job-1',
      deviceId: 'device-1',
      sessionId: 'session-1',
      status: 'queued',
      mode: 'direct',
      payload: {
        message: 'hello'
      },
      requestId: 'request-1'
    })

    expect(snapshot.deviceId).toBe('device-1')
    expect(snapshot.sessions).toMatchObject([
      {
        adapter: 'codex',
        id: 'session-1',
        messageCount: 4,
        userId: 'user-1'
      }
    ])
    expect(JSON.stringify(snapshot)).not.toContain('do not relay this')
    expect(JSON.stringify(snapshot)).not.toContain('Relay session')
    expect(adapter.submitMessage).toHaveBeenCalledWith({
      jobId: 'job-1',
      message: 'hello',
      mode: 'direct',
      requestId: 'request-1',
      sessionId: 'session-1'
    })
    expect(update).toEqual({
      result: {
        accepted: true
      },
      status: 'succeeded'
    })
  })

  it('uses the relay HTTP polling protocol with the device token', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/sessions/snapshot')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      if (url.endsWith('/session-jobs?status=queued&limit=2')) {
        return new Response(
          JSON.stringify({
            jobs: [
              {
                id: 'job-1',
                deviceId: 'device-1',
                payload: {
                  message: 'hello'
                },
                payloadSizeBytes: 5,
                sessionId: 'session-1',
                status: 'claimed'
              }
            ]
          }),
          { status: 200 }
        )
      }
      if (url.endsWith('/session-jobs/job-1/status')) {
        return new Response(
          JSON.stringify({
            job: {
              id: 'job-1',
              status: 'succeeded'
            }
          }),
          { status: 200 }
        )
      }
      return new Response(JSON.stringify({ error: 'unexpected path' }), { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const auth = {
      deviceId: 'device-1',
      deviceToken: 'device-token',
      remoteBaseUrl: 'https://relay.example/'
    }

    const snapshotResponse = await pushRelaySessionSnapshot(auth, {
      deviceId: 'device-1',
      sessions: [{ id: 'session-1' }],
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
    const jobs = await pollRelaySessionForwardingJobs(auth, {
      limit: 2,
      status: 'queued'
    })
    const statusResponse = await updateRelaySessionForwardingJobStatus(auth, 'job-1', {
      status: 'succeeded'
    })

    expect(snapshotResponse).toEqual({ ok: true })
    expect(jobs.jobs).toMatchObject([
      {
        id: 'job-1',
        payload: {
          message: 'hello'
        },
        payloadSizeBytes: 5,
        status: 'claimed'
      }
    ])
    expect(statusResponse).toEqual({
      job: {
        id: 'job-1',
        status: 'succeeded'
      }
    })
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://relay.example/api/relay/devices/device-1/sessions/snapshot', {
      body: expect.stringContaining('"session-1"'),
      headers: {
        authorization: 'Bearer device-token',
        'content-type': 'application/json'
      },
      method: 'POST'
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://relay.example/api/relay/devices/device-1/session-jobs?status=queued&limit=2',
      {
        headers: {
          authorization: 'Bearer device-token',
          'content-type': 'application/json'
        },
        method: 'GET'
      }
    )
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'https://relay.example/api/relay/session-jobs/job-1/status', {
      body: JSON.stringify({
        status: 'succeeded'
      }),
      headers: {
        authorization: 'Bearer device-token',
        'content-type': 'application/json'
      },
      method: 'POST'
    })
  })
})
