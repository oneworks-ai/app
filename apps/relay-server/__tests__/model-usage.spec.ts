import { afterEach, describe, expect, it } from 'vitest'

import { createModelUsageClient } from '../../../packages/diagnostics/src/index.js'
import { OtlpHttpDiagnosticExporter } from '../../../packages/diagnostics/src/node.js'
import { normalizeOtlpModelUsage } from '../src/diagnostics/model-usage.js'
import { readRelayStore } from '../src/server.js'
import { writeRelayStore } from '../src/store.js'
import { authHeaders, cleanupRelayFixtures, listenRelay, requestJson } from './helpers.js'

const timestamp = '2026-08-09T01:02:03.000Z'
const future = '2999-01-01T00:00:00.000Z'

afterEach(async () => {
  await cleanupRelayFixtures()
})

const seedTeam = async (dataPath: string, multipleTeams = false) => {
  const store = await readRelayStore(dataPath)
  store.users.push(
    { createdAt: timestamp, email: 'alice@example.com', id: 'alice', name: 'Alice', role: 'member' },
    { createdAt: timestamp, email: 'bob@example.com', id: 'bob', name: 'Bob', role: 'member' }
  )
  store.sessions.push(
    { createdAt: timestamp, expiresAt: future, lastSeenAt: timestamp, token: 'alice-session', userId: 'alice' },
    { createdAt: timestamp, expiresAt: future, lastSeenAt: timestamp, token: 'bob-session', userId: 'bob' }
  )
  store.teams.push({
    createdAt: timestamp,
    createdByUserId: 'alice',
    id: 'team-1',
    name: 'Platform Team',
    slug: 'platform-team'
  })
  store.teamMembers.push(
    {
      createdAt: timestamp,
      createdByUserId: 'alice',
      id: 'member-a',
      role: 'owner',
      teamId: 'team-1',
      userId: 'alice'
    },
    { createdAt: timestamp, createdByUserId: 'alice', id: 'member-b', role: 'member', teamId: 'team-1', userId: 'bob' }
  )
  if (multipleTeams) {
    store.teams.push({
      createdAt: timestamp,
      createdByUserId: 'alice',
      id: 'team-2',
      name: 'Research Team',
      slug: 'research-team'
    })
    store.teamMembers.push({
      createdAt: timestamp,
      createdByUserId: 'alice',
      id: 'member-a2',
      role: 'owner',
      teamId: 'team-2',
      userId: 'alice'
    })
  }
  await writeRelayStore(dataPath, store)
}

const codexUsagePayload = {
  resourceLogs: [{
    resource: {
      attributes: [
        { key: 'service.name', value: { stringValue: 'codex_cli_rs' } },
        { key: 'service.version', value: { stringValue: '0.144.5' } }
      ]
    },
    scopeLogs: [{
      logRecords: [{
        attributes: [
          { key: 'event.name', value: { stringValue: 'codex.sse_event' } },
          { key: 'event.kind', value: { stringValue: 'response.completed' } },
          { key: 'model', value: { stringValue: 'gpt-5.6-codex' } },
          { key: 'provider_name', value: { stringValue: 'openai-team' } },
          { key: 'conversation.id', value: { stringValue: 'private-conversation' } },
          { key: 'input_token_count', value: { intValue: '1200' } },
          { key: 'output_token_count', value: { intValue: '360' } },
          { key: 'cached_token_count', value: { intValue: '400' } },
          { key: 'duration_ms', value: { intValue: '2200' } },
          { key: 'prompt', value: { stringValue: 'private prompt' } }
        ],
        body: { stringValue: 'codex.sse_event' },
        timeUnixNano: '1786240923000000000'
      }]
    }]
  }]
}

describe('relay team model usage', () => {
  it('maps Codex response.completed counters without content', () => {
    const events = normalizeOtlpModelUsage(codexUsagePayload, {
      now: new Date(timestamp),
      scope: 'team',
      teamId: 'team-1',
      userId: 'alice'
    })

    expect(events).toMatchObject([{
      adapter: 'codex',
      cachedInputTokens: 400,
      durationMs: 2200,
      inputTokens: 1200,
      model: 'gpt-5.6-codex',
      modelService: 'openai-team',
      outputTokens: 360,
      source: 'codex',
      teamId: 'team-1',
      userId: 'alice'
    }])
    expect(JSON.stringify(events)).not.toContain('private prompt')
    expect(events[0]?.sessionId).not.toBe('private-conversation')
  })

  it('ingests OneWorks and Codex usage, binds team membership, and aggregates the admin view', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedTeam(args.dataPath)
    const exporter = new OtlpHttpDiagnosticExporter({
      batchSize: 1,
      endpoint: `${baseUrl}/api/relay/diagnostics/v1/logs`,
      headers: {
        ...authHeaders('alice-session'),
        'x-oneworks-team-id': 'team-1'
      }
    })
    const client = createModelUsageClient({
      exporters: [exporter],
      resource: { serviceName: 'oneworks-server', serviceVersion: '1.2.3', surface: 'server' }
    })
    client.record({
      adapter: 'claude-code',
      cachedInputTokens: 300,
      eventId: 'message-1',
      inputTokens: 1000,
      model: 'claude-sonnet-4',
      modelService: 'anthropic-team',
      outputTokens: 250
    })
    await client.flush()
    const codex = await requestJson(baseUrl, '/api/relay/diagnostics/v1/logs', {
      body: JSON.stringify(codexUsagePayload),
      headers: { ...authHeaders('bob-session'), 'x-oneworks-team-id': 'team-1' },
      method: 'POST'
    })
    const queried = await requestJson(baseUrl, '/api/admin/teams/team-1/model-usage?modelService=openai-team', {
      headers: authHeaders('admin-token')
    })
    const all = await requestJson(baseUrl, '/api/admin/teams/team-1/model-usage', {
      headers: authHeaders('admin-token')
    })
    const stored = await readRelayStore(args.dataPath)

    expect(codex.response.status).toBe(200)
    expect(queried.response.status).toBe(200)
    expect(queried.body.events).toMatchObject([{ userId: 'bob', model: 'gpt-5.6-codex' }])
    expect(queried.body.summary).toMatchObject({
      activeUsers: 1,
      cachedInputTokens: 400,
      inputTokens: 1200,
      outputTokens: 360,
      requests: 1,
      totalTokens: 1560
    })
    expect(all.body).toMatchObject({
      summary: {
        activeUsers: 2,
        byModelService: {
          'anthropic-team': expect.any(Object),
          'openai-team': expect.any(Object)
        },
        inputTokens: 2200,
        outputTokens: 610,
        requests: 2,
        totalTokens: 2810
      }
    })
    expect(JSON.stringify(stored)).not.toContain('private prompt')
  })

  it('uses personal scope without a team header and rejects team spoofing', async () => {
    const single = await listenRelay()
    await seedTeam(single.args.dataPath)
    const inferred = await requestJson(single.baseUrl, '/api/relay/diagnostics/v1/logs', {
      body: JSON.stringify(codexUsagePayload),
      headers: authHeaders('alice-session'),
      method: 'POST'
    })
    expect(inferred.response.status).toBe(200)
    expect((await readRelayStore(single.args.dataPath)).modelUsageEvents).toMatchObject([{
      scope: 'personal',
      userId: 'alice'
    }])

    const multiple = await listenRelay()
    await seedTeam(multiple.args.dataPath, true)
    const personal = await requestJson(multiple.baseUrl, '/api/relay/diagnostics/v1/logs', {
      body: JSON.stringify(codexUsagePayload),
      headers: authHeaders('alice-session'),
      method: 'POST'
    })
    const spoofed = await requestJson(multiple.baseUrl, '/api/relay/diagnostics/v1/logs', {
      body: JSON.stringify(codexUsagePayload),
      headers: { ...authHeaders('bob-session'), 'x-oneworks-team-id': 'team-2' },
      method: 'POST'
    })

    expect(personal.response.status).toBe(200)
    expect((await readRelayStore(multiple.args.dataPath)).modelUsageEvents).toMatchObject([{
      scope: 'personal',
      userId: 'alice'
    }])
    expect(spoofed.response.status).toBe(403)
  })

  it('enforces personal consent and team-controlled reporting policy', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedTeam(args.dataPath)
    const headers = authHeaders('alice-session')

    const defaults = await requestJson(baseUrl, '/api/profile/data-reporting-settings', { headers })
    const disablePersonal = await requestJson(baseUrl, '/api/profile/data-reporting-settings', {
      body: JSON.stringify({ personalEnabled: false }),
      headers,
      method: 'PATCH'
    })
    await requestJson(baseUrl, '/api/relay/diagnostics/v1/logs', {
      body: JSON.stringify(codexUsagePayload),
      headers,
      method: 'POST'
    })
    const requiredTeam = await requestJson(baseUrl, '/api/relay/diagnostics/v1/logs', {
      body: JSON.stringify(codexUsagePayload),
      headers: { ...headers, 'x-oneworks-team-id': 'team-1' },
      method: 'POST'
    })
    const lockedMemberSetting = await requestJson(baseUrl, '/api/profile/data-reporting-settings', {
      body: JSON.stringify({ teamEnabled: false, teamId: 'team-1' }),
      headers,
      method: 'PATCH'
    })
    const makeOptional = await requestJson(baseUrl, '/api/relay/teams/team-1', {
      body: JSON.stringify({ modelUsageReportingMode: 'optional' }),
      headers,
      method: 'PATCH'
    })
    const optOutTeam = await requestJson(baseUrl, '/api/profile/data-reporting-settings', {
      body: JSON.stringify({ teamEnabled: false, teamId: 'team-1' }),
      headers,
      method: 'PATCH'
    })
    await requestJson(baseUrl, '/api/relay/diagnostics/v1/logs', {
      body: JSON.stringify(codexUsagePayload),
      headers: { ...headers, 'x-oneworks-team-id': 'team-1' },
      method: 'POST'
    })
    const stored = await readRelayStore(args.dataPath)
    const makeOptionalBody = makeOptional.body as { team: { modelUsageReportingMode: string } }
    const disablePersonalBody = disablePersonal.body as {
      modelUsageReporting: { personal: { updatedAt: string } }
    }
    const optOutTeamBody = optOutTeam.body as {
      modelUsageReporting: {
        teams: Array<{ enabled: boolean; mode: string; userCanControl: boolean }>
      }
    }

    expect(defaults.body).toMatchObject({
      diagnosticReporting: { defaultEnabled: true, enabled: true },
      modelUsageReporting: {
        personal: { defaultEnabled: true, enabled: true },
        teams: [{ enabled: true, mode: 'required', userCanControl: false }]
      }
    })
    expect(disablePersonalBody.modelUsageReporting.personal).toMatchObject({
      enabled: false,
      updatedAt: expect.any(String)
    })
    expect(requiredTeam.response.status).toBe(200)
    expect(lockedMemberSetting.response.status).toBe(403)
    expect(makeOptionalBody.team.modelUsageReportingMode).toBe('optional')
    expect(optOutTeamBody.modelUsageReporting.teams).toMatchObject([
      { enabled: false, mode: 'optional', userCanControl: true }
    ])
    expect(stored.modelUsageEvents).toMatchObject([{ scope: 'team', teamId: 'team-1', userId: 'alice' }])
    expect(stored.modelUsageEvents).toHaveLength(1)
    expect(stored.users.find(user => user.id === 'alice')?.modelUsageReportingUpdatedAt).toEqual(
      disablePersonalBody.modelUsageReporting.personal.updatedAt
    )
  })

  it('aggregates personal usage from multiple owned devices', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedTeam(args.dataPath)
    const store = await readRelayStore(args.dataPath)
    store.devices.push(
      { createdAt: timestamp, id: 'alice-laptop', lastSeenAt: timestamp, userId: 'alice' },
      { createdAt: timestamp, id: 'alice-desktop', lastSeenAt: timestamp, userId: 'alice' }
    )
    await writeRelayStore(args.dataPath, store)

    for (const deviceId of ['alice-laptop', 'alice-desktop']) {
      const ingested = await requestJson(baseUrl, '/api/relay/diagnostics/v1/logs', {
        body: JSON.stringify(codexUsagePayload),
        headers: { ...authHeaders('alice-session'), 'x-oneworks-device-id': deviceId },
        method: 'POST'
      })
      expect(ingested.response.status).toBe(200)
    }
    const personal = await requestJson(baseUrl, '/api/profile/model-usage', {
      headers: authHeaders('alice-session')
    })
    const personalBody = personal.body as {
      events: Array<{ deviceId: string }>
    }

    expect(personal.response.status).toBe(200)
    expect(personal.body.events).toMatchObject([
      { scope: 'personal', userId: 'alice' },
      { scope: 'personal', userId: 'alice' }
    ])
    expect(new Set(personalBody.events.map(event => event.deviceId))).toEqual(
      new Set(['alice-laptop', 'alice-desktop'])
    )
    expect(personal.body.summary).toMatchObject({ activeUsers: 1, requests: 2, totalTokens: 3120 })
    expect(personal.body.teams).toEqual([])
  })

  it('allows team owners to read their team usage and denies ordinary members', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedTeam(args.dataPath)
    const owner = await requestJson(baseUrl, '/api/relay/teams/team-1/model-usage', {
      headers: authHeaders('alice-session')
    })
    const member = await requestJson(baseUrl, '/api/relay/teams/team-1/model-usage', {
      headers: authHeaders('bob-session')
    })

    expect(owner.response.status).toBe(200)
    expect(member.response.status).toBe(403)
  })

  it('gives platform admins a filterable cross-team view and denies team-only owners', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedTeam(args.dataPath, true)
    const teamOne = await requestJson(baseUrl, '/api/relay/diagnostics/v1/logs', {
      body: JSON.stringify(codexUsagePayload),
      headers: { ...authHeaders('alice-session'), 'x-oneworks-team-id': 'team-1' },
      method: 'POST'
    })
    const teamTwo = await requestJson(baseUrl, '/api/relay/diagnostics/v1/logs', {
      body: JSON.stringify(codexUsagePayload),
      headers: { ...authHeaders('alice-session'), 'x-oneworks-team-id': 'team-2' },
      method: 'POST'
    })
    const platform = await requestJson(baseUrl, '/api/admin/model-usage', {
      headers: authHeaders('admin-token')
    })
    const filtered = await requestJson(baseUrl, '/api/admin/model-usage?teamId=team-2', {
      headers: authHeaders('admin-token')
    })
    const teamOwner = await requestJson(baseUrl, '/api/admin/model-usage', {
      headers: authHeaders('alice-session')
    })

    expect(teamOne.response.status).toBe(200)
    expect(teamTwo.response.status).toBe(200)
    expect(platform.response.status).toBe(200)
    expect(platform.body).toMatchObject({
      summary: {
        byTeam: {
          'team-1': expect.any(Object),
          'team-2': expect.any(Object)
        },
        requests: 2
      },
      teams: [
        { id: 'team-1', name: 'Platform Team' },
        { id: 'team-2', name: 'Research Team' }
      ]
    })
    expect(filtered.body).toMatchObject({
      events: [{ teamId: 'team-2' }],
      summary: { requests: 1 },
      teams: [{ id: 'team-2' }]
    })
    expect(teamOwner.response.status).toBe(403)
  })
})
