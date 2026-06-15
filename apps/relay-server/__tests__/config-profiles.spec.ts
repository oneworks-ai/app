import { afterEach, describe, expect, it } from 'vitest'

import { readRelayStore, writeRelayStore } from '../src/store.js'
import { authHeaders, cleanupRelayFixtures, listenRelay, requestJson } from './helpers.js'

afterEach(cleanupRelayFixtures)

const timestamp = '2026-01-01T00:00:00.000Z'
const future = '2999-01-01T00:00:00.000Z'

const seedConfigProfileFixture = async (dataPath: string) => {
  const store = await readRelayStore(dataPath)
  store.users.push(
    { id: 'owner-1', email: 'owner@example.com', name: 'Owner', role: 'member', createdAt: timestamp },
    { id: 'member-1', email: 'member@example.com', name: 'Member', role: 'member', createdAt: timestamp },
    { id: 'admin-1', email: 'admin@example.com', name: 'Admin', role: 'admin', createdAt: timestamp }
  )
  store.sessions.push(
    { token: 'owner-session', userId: 'owner-1', createdAt: timestamp, expiresAt: future, lastSeenAt: timestamp },
    { token: 'member-session', userId: 'member-1', createdAt: timestamp, expiresAt: future, lastSeenAt: timestamp },
    { token: 'admin-session', userId: 'admin-1', createdAt: timestamp, expiresAt: future, lastSeenAt: timestamp }
  )
  store.teams.push({
    id: 'team-1',
    slug: 'team-1',
    name: 'Team One',
    createdByUserId: 'owner-1',
    createdAt: timestamp
  })
  store.teamMembers.push(
    {
      id: 'owner-member',
      teamId: 'team-1',
      userId: 'owner-1',
      role: 'owner',
      createdByUserId: 'owner-1',
      createdAt: timestamp
    },
    {
      id: 'team-member',
      teamId: 'team-1',
      userId: 'member-1',
      role: 'member',
      createdByUserId: 'owner-1',
      createdAt: timestamp
    }
  )
  await writeRelayStore(dataPath, store)
}

describe('relay config profile routes', () => {
  it('publishes a team config profile and includes provenance in member snapshots', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedConfigProfileFixture(args.dataPath)

    const profile = await requestJson(baseUrl, '/api/relay/teams/team-1/config-profiles', {
      method: 'POST',
      headers: authHeaders('owner-session'),
      body: JSON.stringify({ name: 'Team Config' })
    })
    const profileId = (profile.body.profile as Record<string, unknown>).id as string
    const deniedVersion = await requestJson(baseUrl, `/api/relay/config-profiles/${profileId}/versions`, {
      method: 'POST',
      headers: authHeaders('member-session'),
      body: JSON.stringify({ configPatch: { defaultModelService: 'blocked' } })
    })
    const version = await requestJson(baseUrl, `/api/relay/config-profiles/${profileId}/versions`, {
      method: 'POST',
      headers: authHeaders('owner-session'),
      body: JSON.stringify({
        allowedFields: ['defaultModelService', 'plugins', 'skills'],
        configPatch: {
          defaultModelService: 'team-model',
          env: { SECRET: 'nope' },
          plugins: { relay: { enabled: true } },
          skills: ['team-skill']
        }
      })
    })
    const versionId = (version.body.version as Record<string, unknown>).id as string
    const published = await requestJson(baseUrl, `/api/relay/config-profiles/${profileId}/publish`, {
      method: 'POST',
      headers: authHeaders('owner-session'),
      body: JSON.stringify({ versionId })
    })
    const assignment = await requestJson(baseUrl, `/api/relay/config-profiles/${profileId}/assignments`, {
      method: 'POST',
      headers: authHeaders('owner-session'),
      body: JSON.stringify({ priority: 10 })
    })
    const snapshot = await requestJson(baseUrl, '/api/relay/config-snapshot', {
      headers: authHeaders('member-session')
    })
    const assignments = snapshot.body.assignments as Array<Record<string, unknown>>
    const serialized = JSON.stringify(snapshot.body)

    expect(profile.response.status).toBe(200)
    expect(deniedVersion.response.status).toBe(403)
    expect(version.response.status).toBe(200)
    expect(published.body.profile).toMatchObject({ activeVersionId: versionId, status: 'published' })
    expect(assignment.response.status).toBe(200)
    expect(snapshot.response.status).toBe(200)
    expect(assignments).toHaveLength(1)
    expect(assignments[0]).toMatchObject({
      allowedFields: ['defaultModelService', 'plugins', 'skills'],
      configPatch: {
        defaultModelService: 'team-model',
        plugins: { relay: { enabled: true } },
        skills: ['team-skill']
      },
      provenance: {
        assignmentId: (assignment.body.assignment as Record<string, unknown>).id,
        fields: ['defaultModelService', 'plugins', 'skills'],
        mode: 'default',
        profileId,
        profileName: 'Team Config',
        teamId: 'team-1',
        teamName: 'Team One',
        version: 1,
        versionId
      }
    })
    expect(serialized).not.toContain('SECRET')
    expect(serialized).not.toContain('nope')
  })

  it('enforces profile limits and stops disabled assignments from snapshot delivery', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedConfigProfileFixture(args.dataPath)

    const policy = await requestJson(baseUrl, '/api/admin/team-policy', {
      method: 'PATCH',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ maxAssignmentsPerProfile: 1, maxProfilesPerTeam: 1 })
    })
    const first = await requestJson(baseUrl, '/api/relay/teams/team-1/config-profiles', {
      method: 'POST',
      headers: authHeaders('owner-session'),
      body: JSON.stringify({ name: 'Only Profile' })
    })
    const second = await requestJson(baseUrl, '/api/relay/teams/team-1/config-profiles', {
      method: 'POST',
      headers: authHeaders('owner-session'),
      body: JSON.stringify({ name: 'Too Many' })
    })
    const profileId = (first.body.profile as Record<string, unknown>).id as string
    await requestJson(baseUrl, `/api/relay/config-profiles/${profileId}/versions`, {
      method: 'POST',
      headers: authHeaders('owner-session'),
      body: JSON.stringify({ configPatch: { defaultModelService: 'limited' } })
    })
    await requestJson(baseUrl, `/api/relay/config-profiles/${profileId}/publish`, {
      method: 'POST',
      headers: authHeaders('owner-session'),
      body: JSON.stringify({})
    })
    const firstAssignment = await requestJson(baseUrl, `/api/relay/config-profiles/${profileId}/assignments`, {
      method: 'POST',
      headers: authHeaders('owner-session'),
      body: JSON.stringify({})
    })
    const secondAssignment = await requestJson(baseUrl, `/api/relay/config-profiles/${profileId}/assignments`, {
      method: 'POST',
      headers: authHeaders('owner-session'),
      body: JSON.stringify({})
    })
    const assignmentId = (firstAssignment.body.assignment as Record<string, unknown>).id as string
    const disabled = await requestJson(baseUrl, `/api/admin/config-assignments/${assignmentId}`, {
      method: 'PATCH',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ enabled: false })
    })
    const snapshot = await requestJson(baseUrl, '/api/relay/config-snapshot', {
      headers: authHeaders('member-session')
    })

    expect(policy.response.status).toBe(200)
    expect(second.response.status).toBe(403)
    expect(second.body).toEqual({ error: 'Team profile limit reached.' })
    expect(firstAssignment.response.status).toBe(200)
    expect(secondAssignment.response.status).toBe(403)
    expect(disabled.body.assignment).toMatchObject({ enabled: false })
    expect(snapshot.body.assignments).toEqual([])
  })
})
