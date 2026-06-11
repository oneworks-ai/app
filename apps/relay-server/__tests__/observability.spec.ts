import { afterEach, describe, expect, it } from 'vitest'

import { writeRelayStore } from '../src/store.js'
import { sanitizeRelayLogFields } from '../src/telemetry/logger.js'
import type { RelayMetricsSnapshot } from '../src/telemetry/metrics.js'
import { createTraceMetricsEvent } from '../src/telemetry/trace.js'
import type { RelayForwardingJob } from '../src/types.js'
import { authHeaders, cleanupRelayFixtures, listenRelay, requestJson } from './helpers.js'
import { createFixtureStore, timestamp } from './session-route-helpers.js'

afterEach(cleanupRelayFixtures)

const listenObservableRelay = async () => {
  const relay = await listenRelay()
  await writeRelayStore(relay.args.dataPath, createFixtureStore())
  return relay
}

const writeExpiredJobFixture = async (dataPath: string) => {
  const store = createFixtureStore()
  const job: RelayForwardingJob = {
    id: 'expired-job-1',
    deviceId: 'device-1',
    sessionId: 'session-1',
    userId: 'user-1',
    status: 'queued',
    traceId: 'trace-expired',
    requestId: 'request-expired',
    payloadSizeBytes: 128,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  store.forwardingJobs.push(job)
  await writeRelayStore(dataPath, store)
}

const readMetricsSnapshot = async (baseUrl: string) => {
  const metrics = await requestJson(baseUrl, '/api/relay/metrics', {
    headers: authHeaders('admin-token')
  })
  return {
    body: metrics.body as unknown as RelayMetricsSnapshot,
    response: metrics.response
  }
}

describe('relay server observability', () => {
  it('protects metrics and accumulates heartbeat and forwarding delivery counters', async () => {
    const { baseUrl } = await listenObservableRelay()

    const unauthorized = await requestJson(baseUrl, '/api/relay/metrics')
    const heartbeat = await requestJson(baseUrl, '/api/relay/devices/heartbeat', {
      method: 'POST',
      headers: authHeaders('device-token-1'),
      body: JSON.stringify({
        capabilities: { sessions: true },
        deviceId: 'device-1'
      })
    })
    await requestJson(baseUrl, '/api/relay/devices/device-1/sessions/snapshot', {
      method: 'POST',
      headers: authHeaders('device-token-1'),
      body: JSON.stringify({
        sessions: [
          {
            id: 'session-1',
            title: 'Own session',
            userId: 'user-1'
          }
        ]
      })
    })
    const submitted = await requestJson(baseUrl, '/api/relay/devices/device-1/sessions/session-1/messages', {
      method: 'POST',
      headers: authHeaders('member-token-1'),
      body: JSON.stringify({
        message: 'sensitive prompt should stay out of observability',
        requestId: 'request-1',
        traceId: 'trace-1'
      })
    })
    const job = submitted.body.job as { id: string }
    await requestJson(baseUrl, '/api/relay/devices/device-1/session-jobs?status=queued', {
      headers: authHeaders('device-token-1')
    })
    await requestJson(baseUrl, `/api/relay/session-jobs/${job.id}/status`, {
      method: 'POST',
      headers: authHeaders('device-token-1'),
      body: JSON.stringify({
        result: {
          text: 'sensitive result should stay out of observability'
        },
        status: 'succeeded'
      })
    })
    await requestJson(baseUrl, `/api/relay/session-jobs/${job.id}/result`, {
      headers: authHeaders('member-token-1')
    })
    const metrics = await readMetricsSnapshot(baseUrl)
    const metricsText = JSON.stringify(metrics.body)

    expect(unauthorized.response.status).toBe(401)
    expect(heartbeat.response.status).toBe(200)
    expect(metrics.response.status).toBe(200)
    expect(metrics.body.forwarding).toMatchObject({
      counters: {
        cancelled: 0,
        claimed: 1,
        completed: 1,
        expired: 0,
        failed: 0,
        submitted: 1
      },
      rates: {
        delivery: {
          denominator: 1,
          numerator: 1,
          ratio: 1
        },
        success: {
          denominator: 1,
          numerator: 1,
          ratio: 1
        }
      }
    })
    expect(metrics.body.devices).toMatchObject({
      count: 1,
      heartbeats: 1
    })
    expect(metrics.body.devices.items).toEqual([
      expect.objectContaining({
        claimed: 1,
        completed: 1,
        deviceId: 'device-1',
        heartbeatCount: 1,
        lastStatus: 'online',
        submitted: 1
      })
    ])
    expect(metrics.body.traces.recent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          deviceId: 'device-1',
          event: 'relay.forwarding.job_submitted',
          jobId: job.id,
          requestId: 'request-1',
          sessionId: 'session-1',
          traceId: 'trace-1',
          userId: 'user-1'
        }),
        expect.objectContaining({
          event: 'relay.forwarding.job_status',
          resultAvailable: true,
          status: 'succeeded'
        }),
        expect.objectContaining({
          event: 'relay.forwarding.result_consumed',
          resultSizeBytes: 60
        })
      ])
    )
    expect(metricsText).not.toContain('sensitive prompt should stay out of observability')
    expect(metricsText).not.toContain('sensitive result should stay out of observability')
  })

  it('counts expired queue payloads without exposing payload content', async () => {
    const { args, baseUrl } = await listenObservableRelay()
    await writeExpiredJobFixture(args.dataPath)

    const expired = await requestJson(baseUrl, '/api/relay/session-jobs/expired-job-1', {
      headers: authHeaders('member-token-1')
    })
    const metrics = await readMetricsSnapshot(baseUrl)
    const metricsText = JSON.stringify(metrics.body)

    expect(expired.response.status).toBe(200)
    expect(expired.body.job).toMatchObject({
      errorCode: 'payload_expired',
      id: 'expired-job-1',
      status: 'failed'
    })
    expect(metrics.body.forwarding.counters).toMatchObject({
      expired: 1,
      failed: 1
    })
    expect(metrics.body.traces.recent).toEqual([
      expect.objectContaining({
        event: 'relay.forwarding.payload_expired',
        jobId: 'expired-job-1',
        requestId: 'request-expired',
        traceId: 'trace-expired'
      })
    ])
    expect(metricsText).not.toContain('message')
    expect(metricsText).not.toContain('result')
  })

  it('redacts relay log and trace structures before payload fields can be recorded', () => {
    const sanitized = sanitizeRelayLogFields({
      adminToken: 'admin-token-secret',
      authorization: 'Bearer secret',
      deviceId: 'device-1',
      message: 'prompt text',
      nested: {
        accessToken: 'device-token-secret',
        requestId: 'request-1',
        result: 'result text'
      },
      payload: {
        message: 'payload text'
      }
    })
    const trace = createTraceMetricsEvent('info', 'relay.forwarding.job_submitted', {
      deviceId: 'device-1',
      jobId: 'job-1',
      message: 'prompt text',
      payload: {
        message: 'payload text'
      },
      requestId: 'request-1',
      result: 'result text',
      traceId: 'trace-1'
    })

    expect(sanitized).toEqual({
      deviceId: 'device-1',
      nested: {
        requestId: 'request-1'
      }
    })
    expect(trace).toMatchObject({
      deviceId: 'device-1',
      event: 'relay.forwarding.job_submitted',
      jobId: 'job-1',
      requestId: 'request-1',
      traceId: 'trace-1'
    })
    expect(JSON.stringify(trace)).not.toContain('prompt text')
    expect(JSON.stringify(trace)).not.toContain('payload text')
    expect(JSON.stringify(trace)).not.toContain('result text')
  })
})
