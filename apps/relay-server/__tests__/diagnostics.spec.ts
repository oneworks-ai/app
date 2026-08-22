import { afterEach, describe, expect, it } from 'vitest'

import { createDiagnosticClient } from '../../../packages/diagnostics/src/index.js'
import { OtlpHttpDiagnosticExporter } from '../../../packages/diagnostics/src/node.js'
import { createRelayAccessToken } from '../src/auth/access-tokens.js'
import { normalizeOtlpLogs } from '../src/diagnostics/otlp.js'
import { appendRelayDiagnosticEvents } from '../src/diagnostics/store.js'
import { readRelayStore } from '../src/server.js'
import { writeRelayStore } from '../src/store.js'
import type { RelayDiagnosticEvent } from '../src/types.js'
import { authHeaders, cleanupRelayFixtures, listenRelay, requestJson } from './helpers.js'

const timestamp = '2026-08-09T01:02:03.000Z'
const future = '2999-01-01T00:00:00.000Z'

const otlpPayload = {
  resourceLogs: [{
    resource: {
      attributes: [
        { key: 'service.name', value: { stringValue: 'oneworks-desktop' } },
        { key: 'service.version', value: { stringValue: '1.2.3' } },
        { key: 'deployment.environment.name', value: { stringValue: 'production' } },
        { key: 'host.arch', value: { stringValue: 'arm64' } },
        { key: 'os.type', value: { stringValue: 'darwin' } },
        { key: 'oneworks.release.channel', value: { stringValue: 'stable' } },
        { key: 'oneworks.surface', value: { stringValue: 'desktop' } }
      ]
    },
    scopeLogs: [{
      logRecords: [{
        attributes: [
          { key: 'event.name', value: { stringValue: 'oneworks.diagnostic.operation.completed' } },
          { key: 'oneworks.context.user_id', value: { stringValue: 'spoofed-user' } },
          { key: 'oneworks.context.app_session_id', value: { stringValue: 'private-session-id' } },
          { key: 'oneworks.operation.duration_ms', value: { intValue: '825' } },
          { key: 'oneworks.operation.failure.code', value: { stringValue: 'renderer.ready_timeout' } },
          { key: 'oneworks.operation.failure.fingerprint', value: { stringValue: 'js_1234567890abcdef' } },
          { key: 'oneworks.operation.failure.domain', value: { stringValue: 'renderer' } },
          { key: 'oneworks.operation.id', value: { stringValue: 'private-operation-id' } },
          { key: 'oneworks.operation.name', value: { stringValue: 'oneworks.desktop.startup' } },
          { key: 'oneworks.operation.outcome', value: { stringValue: 'timeout' } },
          { key: 'oneworks.operation.stage', value: { stringValue: 'renderer.ready' } },
          { key: 'error.type', value: { stringValue: 'https://private.example/secret' } },
          { key: 'session.id', value: { stringValue: '/Users/private/workspace' } }
        ],
        body: { stringValue: 'raw prompt must never be persisted' },
        severityNumber: 17,
        severityText: 'ERROR',
        timeUnixNano: '1786240923000000000'
      }]
    }]
  }]
}

afterEach(async () => {
  await cleanupRelayFixtures()
})

const seedUser = async (dataPath: string) => {
  const store = await readRelayStore(dataPath)
  store.users.push({
    createdAt: timestamp,
    email: 'member@example.com',
    id: 'member-1',
    name: 'Member One',
    role: 'member'
  })
  store.sessions.push({
    createdAt: timestamp,
    expiresAt: future,
    lastSeenAt: timestamp,
    token: 'member-session',
    userId: 'member-1'
  })
  store.devices.push({
    capabilities: { sessions: true },
    createdAt: timestamp,
    deviceToken: 'paired-device-token',
    id: 'device-1',
    lastSeenAt: timestamp,
    name: 'Desktop',
    userId: 'member-1'
  })
  await writeRelayStore(dataPath, store)
}

const waitForOpenApiAudit = async (dataPath: string, path: string) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const store = await readRelayStore(dataPath)
    if (store.openApiAuditEvents?.some(event => event.path === path)) return store
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return await readRelayStore(dataPath)
}

const firstActionEvent = (
  id: string,
  occurredAt: string,
  input: Partial<RelayDiagnosticEvent> = {}
): RelayDiagnosticEvent => ({
  category: 'first-action',
  eventName: 'oneworks.diagnostic.operation.stage',
  id,
  occurredAt,
  operationId: 'cross-midnight-first-action',
  receivedAt: occurredAt,
  serviceName: 'oneworks-desktop',
  severity: 'INFO',
  source: 'oneworks',
  userId: 'member-1',
  ...input
})

describe('relay diagnostic ingestion', () => {
  it('accepts the shared OneWorks exporter contract end to end', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedUser(args.dataPath)
    const exporter = new OtlpHttpDiagnosticExporter({
      batchSize: 32,
      endpoint: `${baseUrl}/api/relay/diagnostics/v1/logs`,
      headers: authHeaders('paired-device-token')
    })
    const client = createDiagnosticClient({
      context: { appSessionId: 'private-live-session' },
      exporters: [exporter],
      resource: {
        architecture: 'arm64',
        environment: 'test',
        platform: 'darwin',
        serviceName: 'oneworks-desktop',
        serviceVersion: '1.2.3',
        surface: 'desktop'
      }
    })

    const startup = client.startOperation('oneworks.desktop.startup')
    startup.stage('renderer.loaded')
    startup.ready('renderer.ready')
    startup.stable()
    const firstAction = client.startOperation('oneworks.app.first_action')
    firstAction.stage('first.submit')
    firstAction.stage('submit.accepted')
    firstAction.ready('first.response.received')
    firstAction.stage('first.success')
    firstAction.succeed()
    await client.flush()

    const queried = await requestJson(baseUrl, '/api/admin/diagnostics?userId=member-1', {
      headers: authHeaders('admin-token')
    })
    const allEvents = queried.body.events as RelayDiagnosticEvent[]
    const events = allEvents.filter(event => event.category === 'startup')

    expect(queried.response.status).toBe(200)
    expect(events).toHaveLength(5)
    expect(events.find(event => event.outcome === 'success')).toMatchObject({
      category: 'startup',
      deviceId: 'device-1',
      operationName: 'oneworks.desktop.startup',
      serviceName: 'oneworks-desktop',
      source: 'oneworks',
      userId: 'member-1'
    })
    expect(queried.body.summary).toMatchObject({
      startup: {
        attempts: 1,
        p50DurationMs: expect.any(Number),
        p95DurationMs: expect.any(Number),
        successRate: 1
      },
      total: 12
    })
    expect(queried.body.series).toMatchObject([{
      activeUsers: 1,
      date: expect.any(String),
      startupAttempts: 1,
      startupSuccessRate: 1,
      totalEvents: 12
    }])
    expect(JSON.stringify(events)).not.toContain('private-live-session')

    expect(allEvents.filter(event => event.category === 'first-action')).toHaveLength(7)
    const firstActionSummary = (queried.body.summary as { firstAction: unknown }).firstAction
    expect(firstActionSummary).toMatchObject({
      appStartToSubmit: {
        p50DurationMs: expect.any(Number),
        p95DurationMs: expect.any(Number)
      },
      attempts: 1,
      pendingAttempts: 0,
      submitToAccepted: {
        p50DurationMs: expect.any(Number),
        p95DurationMs: expect.any(Number)
      },
      submitToResponse: {
        p50DurationMs: expect.any(Number),
        p95DurationMs: expect.any(Number)
      },
      submitToSuccess: {
        p50DurationMs: expect.any(Number),
        p95DurationMs: expect.any(Number)
      },
      successRate: 1,
      terminalAttempts: 1
    })
  })

  it('attributes a cross-midnight first action only to its submit cohort date', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedUser(args.dataPath)
    const store = await readRelayStore(args.dataPath)
    store.diagnosticEvents = [
      firstActionEvent('started', '2026-08-09T23:59:59.000Z', {
        eventName: 'oneworks.diagnostic.operation.started'
      }),
      firstActionEvent('completed', '2026-08-10T00:00:01.000Z', {
        eventName: 'oneworks.diagnostic.operation.completed',
        outcome: 'success'
      })
    ]
    await writeRelayStore(args.dataPath, store)

    const queried = await requestJson(baseUrl, '/api/admin/diagnostics?userId=member-1', {
      headers: authHeaders('admin-token')
    })
    const series = queried.body.series as Array<{
      date: string
      firstActionAttempts: number
      firstActionSuccessRate?: number
      totalEvents: number
    }>

    expect(series.find(item => item.date === '2026-08-09')).toMatchObject({
      firstActionAttempts: 1,
      firstActionSuccessRate: 1,
      totalEvents: 1
    })
    expect(series.find(item => item.date === '2026-08-10')).toMatchObject({
      firstActionAttempts: 0,
      totalEvents: 1
    })

    const terminalOnly = await requestJson(
      baseUrl,
      '/api/admin/diagnostics?userId=member-1&from=2026-08-10T00:00:00.000Z',
      { headers: authHeaders('admin-token') }
    )
    expect(terminalOnly.body.series as Array<{ firstActionAttempts: number }>).toEqual([
      expect.objectContaining({ firstActionAttempts: 0 })
    ])
  })

  it('accepts OTLP/HTTP JSON, binds authenticated identity, and stores only safe facts', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedUser(args.dataPath)

    const ingested = await requestJson(baseUrl, '/api/relay/diagnostics/v1/logs', {
      body: JSON.stringify(otlpPayload),
      headers: {
        ...authHeaders('member-session'),
        'x-oneworks-device-id': 'device-1'
      },
      method: 'POST'
    })
    const stored = await readRelayStore(args.dataPath)
    const event = stored.diagnosticEvents?.[0]

    expect(ingested.response.status).toBe(200)
    expect(ingested.body).toEqual({})
    expect(event).toMatchObject({
      architecture: 'arm64',
      category: 'startup',
      deviceId: 'device-1',
      durationMs: 825,
      environment: 'production',
      errorCode: 'renderer.ready_timeout',
      errorFingerprint: 'js_1234567890abcdef',
      operationName: 'oneworks.desktop.startup',
      outcome: 'timeout',
      platform: 'darwin',
      releaseChannel: 'stable',
      serviceName: 'oneworks-desktop',
      source: 'oneworks',
      stage: 'renderer.ready',
      userId: 'member-1'
    })
    expect(event?.operationId).not.toBe('private-operation-id')
    expect(event?.sessionId).not.toBe('private-session-id')
    expect(JSON.stringify(stored)).not.toContain('raw prompt')
    expect(JSON.stringify(stored)).not.toContain('spoofed-user')
    expect(JSON.stringify(stored)).not.toContain('private.example')
    expect(JSON.stringify(stored)).not.toContain('/Users/private')
  })

  it('drops system diagnostics after the user disables reporting', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedUser(args.dataPath)
    const preference = await requestJson(baseUrl, '/api/profile/data-reporting-settings', {
      body: JSON.stringify({ diagnosticEnabled: false }),
      headers: authHeaders('member-session'),
      method: 'PATCH'
    })
    const ingested = await requestJson(baseUrl, '/api/relay/diagnostics/v1/logs', {
      body: JSON.stringify(otlpPayload),
      headers: authHeaders('member-session'),
      method: 'POST'
    })
    const stored = await readRelayStore(args.dataPath)

    expect(preference.body.diagnosticReporting).toMatchObject({ enabled: false })
    expect(ingested.response.status).toBe(200)
    expect(stored.diagnosticEvents).toEqual([])
  })

  it('accepts paired device tokens and exposes an admin-filtered user timeline with summary', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedUser(args.dataPath)

    const ingested = await requestJson(baseUrl, '/api/relay/diagnostics/v1/logs', {
      body: JSON.stringify(otlpPayload),
      headers: authHeaders('paired-device-token'),
      method: 'POST'
    })
    const queried = await requestJson(
      baseUrl,
      '/api/admin/diagnostics?userId=member-1&outcome=timeout&serviceVersion=1.2.3&platform=darwin',
      { headers: authHeaders('admin-token') }
    )

    expect(ingested.response.status).toBe(200)
    expect(queried.response.status).toBe(200)
    expect(queried.body.events).toMatchObject([{
      deviceId: 'device-1',
      userId: 'member-1'
    }])
    expect(queried.body.summary).toMatchObject({
      affectedUsers: 1,
      byFailure: { 'renderer.ready_timeout': 1 },
      byFingerprint: { 'js_1234567890abcdef': 1 },
      byOutcome: { timeout: 1 },
      byPlatform: { darwin: 1 },
      byVersion: { '1.2.3': 1 },
      total: 1
    })
    expect(queried.body.series).toMatchObject([{
      activeUsers: 1,
      errorEvents: 1,
      totalEvents: 1
    }])
    expect(queried.body.users).toEqual([{
      email: 'member@example.com',
      id: 'member-1',
      name: 'Member One'
    }])
  })

  it('accepts personal access tokens and records the diagnostics permission in OpenAPI audit', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedUser(args.dataPath)
    const store = await readRelayStore(args.dataPath)
    const { token } = createRelayAccessToken(store, {
      name: 'Codex diagnostics',
      scope: 'platform',
      userId: 'member-1'
    })
    await writeRelayStore(args.dataPath, store)

    const ingested = await requestJson(baseUrl, '/api/relay/diagnostics/v1/logs', {
      body: JSON.stringify(otlpPayload),
      headers: authHeaders(token),
      method: 'POST'
    })
    const stored = await waitForOpenApiAudit(args.dataPath, '/api/relay/diagnostics/v1/logs')

    expect(ingested.response.status).toBe(200)
    expect(stored.diagnosticEvents?.[0]).toMatchObject({ userId: 'member-1' })
    expect(stored.openApiAuditEvents).toContainEqual(expect.objectContaining({
      method: 'POST',
      path: '/api/relay/diagnostics/v1/logs',
      permission: 'relay.diagnostics.write',
      status: 200,
      userId: 'member-1'
    }))
    expect(JSON.stringify(stored)).not.toContain(token)
  })

  it('rejects protobuf and userless deployment-admin ingestion', async () => {
    const { baseUrl } = await listenRelay()
    const protobuf = await requestJson(baseUrl, '/api/relay/diagnostics/v1/logs', {
      body: '{}',
      headers: { authorization: 'Bearer admin-token', 'content-type': 'application/x-protobuf' },
      method: 'POST'
    })
    const adminJson = await requestJson(baseUrl, '/api/relay/diagnostics/v1/logs', {
      body: JSON.stringify(otlpPayload),
      headers: authHeaders('admin-token'),
      method: 'POST'
    })

    expect(protobuf.response.status).toBe(415)
    expect(adminJson.response.status).toBe(401)
  })

  it('normalizes Codex OTel status and duration while discarding prompt and tool output fields', () => {
    const events = normalizeOtlpLogs({
      resourceLogs: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'codex_cli_rs' } }] },
        scopeLogs: [{
          logRecords: [{
            attributes: [
              { key: 'success', value: { boolValue: true } },
              { key: 'duration_ms', value: { intValue: '420' } },
              { key: 'app.version', value: { stringValue: '0.144.5' } },
              { key: 'prompt', value: { stringValue: 'private source code' } },
              { key: 'output', value: { stringValue: 'private tool result' } }
            ],
            body: { stringValue: 'codex.tool_result' },
            severityText: 'INFO'
          }]
        }]
      }]
    }, { now: new Date(timestamp), userId: 'member-1' })

    expect(events).toMatchObject([{
      category: 'tool',
      durationMs: 420,
      eventName: 'codex.tool_result',
      serviceName: 'codex_cli_rs',
      serviceVersion: '0.144.5',
      source: 'codex',
      success: true,
      userId: 'member-1'
    }])
    expect(JSON.stringify(events)).not.toContain('private source code')
    expect(JSON.stringify(events)).not.toContain('private tool result')
  })

  it('applies age and count retention before persistence', () => {
    const store = { diagnosticEvents: [] } as unknown as Parameters<typeof appendRelayDiagnosticEvents>[0]
    const event = (id: string, receivedAt: string): RelayDiagnosticEvent => ({
      category: 'other',
      eventName: 'oneworks.test',
      id,
      occurredAt: receivedAt,
      receivedAt,
      serviceName: 'oneworks-test',
      severity: 'INFO',
      source: 'oneworks',
      userId: 'member-1'
    })
    store.diagnosticEvents = [event('old', '2025-01-01T00:00:00.000Z')]

    appendRelayDiagnosticEvents(store, [event('new', '2026-08-09T00:00:00.000Z')], new Date('2026-08-09'))

    expect(store.diagnosticEvents?.map(item => item.id)).toEqual(['new'])
  })
})
