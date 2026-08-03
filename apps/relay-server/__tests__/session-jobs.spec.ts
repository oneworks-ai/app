import { afterEach, describe, expect, it } from 'vitest'

import { readRelayStore } from '../src/server.js'
import { authHeaders, requestJson } from './helpers.js'
import { cleanupSessionRelayFixtures, listenSessionRelay, postSnapshot } from './session-route-helpers.js'

afterEach(cleanupSessionRelayFixtures)

describe('relay server session forwarding jobs', () => {
  it('submits forwarding jobs and lets the owning device poll and update status', async () => {
    const { args, baseUrl } = await listenSessionRelay()
    await postSnapshot(baseUrl, 'device-1', 'device-token-1', [
      {
        id: 'session-1',
        title: 'Own session',
        userId: 'user-1',
        workspaceFolder: '/tmp/relay-workspace'
      }
    ])
    const sessions = await requestJson(baseUrl, '/api/relay/devices/device-1/sessions', {
      headers: authHeaders('member-token-1')
    })

    const forbiddenSubmit = await requestJson(baseUrl, '/api/relay/devices/device-1/sessions/session-1/messages', {
      method: 'POST',
      headers: authHeaders('member-token-2'),
      body: JSON.stringify({ message: 'hello from another user' })
    })
    const submitted = await requestJson(baseUrl, '/api/relay/devices/device-1/sessions/session-1/messages', {
      method: 'POST',
      headers: authHeaders('member-token-1'),
      body: JSON.stringify({
        message: 'hello from relay',
        requestId: 'request-1'
      })
    })
    const job = submitted.body.job as Record<string, unknown>
    const forbiddenStatus = await requestJson(baseUrl, `/api/relay/session-jobs/${job.id}`, {
      headers: authHeaders('member-token-2')
    })
    const polled = await requestJson(baseUrl, '/api/relay/devices/device-1/session-jobs?status=queued', {
      headers: authHeaders('device-token-1')
    })
    const completed = await requestJson(baseUrl, `/api/relay/session-jobs/${job.id}/status`, {
      method: 'POST',
      headers: authHeaders('device-token-1'),
      body: JSON.stringify({
        result: { accepted: true, text: 'do not persist result' },
        status: 'succeeded'
      })
    })
    const status = await requestJson(baseUrl, `/api/relay/session-jobs/${job.id}`, {
      headers: authHeaders('member-token-1')
    })
    const result = await requestJson(baseUrl, `/api/relay/session-jobs/${job.id}/result`, {
      headers: authHeaders('member-token-1')
    })
    const consumedResult = await requestJson(baseUrl, `/api/relay/session-jobs/${job.id}/result`, {
      headers: authHeaders('member-token-1')
    })
    const store = await readRelayStore(args.dataPath)

    expect(sessions.response.status).toBe(200)
    expect(sessions.body.sessions).toMatchObject([
      {
        id: 'session-1',
        title: 'Own session',
        workspaceFolder: '/tmp/relay-workspace'
      }
    ])
    expect(forbiddenSubmit.response.status).toBe(403)
    expect(submitted.response.status).toBe(202)
    expect(job).toMatchObject({
      deviceId: 'device-1',
      payloadSizeBytes: 16,
      requestId: 'request-1',
      sessionId: 'session-1',
      status: 'queued',
      userId: 'user-1'
    })
    expect(job).not.toHaveProperty('message')
    expect(job).not.toHaveProperty('payload')
    expect(forbiddenStatus.response.status).toBe(403)
    expect(polled.response.status).toBe(200)
    expect(polled.body.jobs).toMatchObject([
      {
        id: job.id,
        payload: {
          message: 'hello from relay'
        },
        status: 'claimed'
      }
    ])
    expect(completed.response.status).toBe(200)
    expect(completed.body.job).toMatchObject({
      resultAvailable: true,
      status: 'succeeded'
    })
    expect(completed.body.job).not.toHaveProperty('result')
    expect(status.response.status).toBe(200)
    expect(status.body.job).toMatchObject({
      id: job.id,
      resultAvailable: true,
      status: 'succeeded'
    })
    expect(status.body.job).not.toHaveProperty('result')
    expect(result.response.status).toBe(200)
    expect(result.body).toMatchObject({
      job: {
        id: job.id,
        resultAvailable: false,
        status: 'succeeded'
      },
      result: {
        accepted: true,
        text: 'do not persist result'
      }
    })
    expect(consumedResult.response.status).toBe(404)
    expect(JSON.stringify(store.forwardingJobs)).not.toContain('hello from relay')
    expect(JSON.stringify(store.forwardingJobs)).not.toContain('do not persist result')
    expect(store.forwardingJobs[0]).toMatchObject({
      deviceId: 'device-1',
      payloadSizeBytes: 16,
      requestId: 'request-1',
      sessionId: 'session-1',
      status: 'succeeded',
      userId: 'user-1'
    })
  })

  it('long-polls empty device job claims until a queued job is available', async () => {
    const { baseUrl } = await listenSessionRelay()
    await postSnapshot(baseUrl, 'device-1', 'device-token-1', [
      {
        id: 'session-1',
        title: 'Own session',
        userId: 'user-1',
        workspaceFolder: '/tmp/relay-workspace'
      }
    ])

    const startedAt = Date.now()
    const polling = requestJson(baseUrl, '/api/relay/devices/device-1/session-jobs?status=queued&waitMs=2000', {
      headers: authHeaders('device-token-1')
    })
    await new Promise(resolve => setTimeout(resolve, 50))
    const submitted = await requestJson(baseUrl, '/api/relay/devices/device-1/sessions/session-1/messages', {
      method: 'POST',
      headers: authHeaders('member-token-1'),
      body: JSON.stringify({
        message: 'hello from relay',
        requestId: 'request-1'
      })
    })
    const job = submitted.body.job as Record<string, unknown>
    const polled = await polling

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(40)
    expect(polled.response.status).toBe(200)
    expect(polled.body.jobs).toMatchObject([
      {
        id: job.id,
        payload: {
          message: 'hello from relay'
        },
        status: 'claimed'
      }
    ])
    expect(polled.body).not.toHaveProperty('nextPollMs')
  })

  it('accepts a valid v2 body poll, renews once, and wakes after a concurrent persisted job submit', async () => {
    const { args, baseUrl } = await listenSessionRelay()
    await postSnapshot(baseUrl, 'device-1', 'device-token-1', [
      { id: 'session-1', title: 'Own session', userId: 'user-1', workspaceFolder: '/tmp/relay-workspace' }
    ])
    const before = (await readRelayStore(args.dataPath)).devices[0].lastSeenAt
    const polling = requestJson(baseUrl, '/api/relay/devices/device-1/session-jobs', {
      method: 'POST',
      headers: authHeaders('device-token-1'),
      body: JSON.stringify({
        heartbeat: { deviceId: 'device-1', deviceName: 'Body polling device' },
        limit: 50,
        status: 'queued',
        waitMs: 1_000
      })
    })
    await new Promise(resolve => setTimeout(resolve, 50))
    const submitted = await requestJson(baseUrl, '/api/relay/devices/device-1/sessions/session-1/messages', {
      method: 'POST',
      headers: authHeaders('member-token-1'),
      body: JSON.stringify({ message: 'body poll wake' })
    })
    const polled = await polling
    const after = (await readRelayStore(args.dataPath)).devices[0].lastSeenAt

    expect(submitted.response.status).toBe(202)
    expect(polled.response.status).toBe(200)
    expect(polled.body.jobs).toHaveLength(1)
    expect(after).toEqual(expect.any(String))
    expect(after).not.toBe(before)
  })

  it.each([
    { heartbeat: { deviceId: 'other-device' }, limit: 50, status: 'queued', waitMs: 1_000 },
    { heartbeat: { deviceId: 'device-1' }, limit: 50, status: 'active', waitMs: 1_000 },
    { heartbeat: { deviceId: 'device-1' }, limit: 101, status: 'queued', waitMs: 1_000 },
    { heartbeat: { deviceId: 'device-1' }, limit: 50, status: 'queued', waitMs: 999 }
  ])('rejects invalid v2 body-poll controls before holding a request (%o)', async body => {
    const { baseUrl } = await listenSessionRelay()
    const response = await requestJson(baseUrl, '/api/relay/devices/device-1/session-jobs', {
      method: 'POST',
      headers: authHeaders('device-token-1'),
      body: JSON.stringify(body)
    })
    expect(response.response.status).toBe(400)
  })

  it('rejects malformed v2 body polls and query controls immediately', async () => {
    const { baseUrl } = await listenSessionRelay()
    const malformed = await requestJson(baseUrl, '/api/relay/devices/device-1/session-jobs', {
      method: 'POST',
      headers: authHeaders('device-token-1'),
      body: '{'
    })
    const query = await requestJson(baseUrl, '/api/relay/devices/device-1/session-jobs?waitMs=50000', {
      method: 'POST',
      headers: authHeaders('device-token-1'),
      body: JSON.stringify({
        heartbeat: { deviceId: 'device-1' },
        limit: 50,
        status: 'queued',
        waitMs: 1_000
      })
    })
    expect(malformed.response.status).toBe(400)
    expect(query.response.status).toBe(400)
  })

  it('does not hold the relay store lock while waiting for empty device job claims', async () => {
    const { baseUrl } = await listenSessionRelay()
    await postSnapshot(baseUrl, 'device-1', 'device-token-1', [
      {
        id: 'session-1',
        title: 'Own session',
        userId: 'user-1',
        workspaceFolder: '/tmp/relay-workspace'
      }
    ])

    const polling = requestJson(baseUrl, '/api/relay/devices/device-1/session-jobs?status=queued&waitMs=1000', {
      headers: authHeaders('device-token-1')
    })
    await new Promise(resolve => setTimeout(resolve, 50))
    const startedAt = Date.now()
    const invite = await requestJson(baseUrl, '/api/admin/invites', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ code: 'pair-lock-check', role: 'member', userId: 'user-1' })
    })
    const inviteElapsedMs = Date.now() - startedAt
    const polled = await polling

    expect(invite.response.status).toBe(200)
    expect(inviteElapsedMs).toBeLessThan(800)
    expect(polled.response.status).toBe(200)
    expect(polled.body).toMatchObject({
      jobs: [],
      nextPollMs: 60_000
    })
  })
})
