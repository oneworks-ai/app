import { afterEach, describe, expect, it } from 'vitest'

import { readRelayStore, writeRelayStore } from '../src/store.js'
import { authHeaders, cleanupRelayFixtures, listenRelay, requestJson } from './helpers.js'

afterEach(cleanupRelayFixtures)

const timestamp = '2026-01-01T00:00:00.000Z'
const future = '2999-01-01T00:00:00.000Z'

interface AuditEventSnapshot {
  action: string
  actor: string
  resource: string
  status: string
}

const sleep = async (ms: number) => await new Promise<void>(resolve => setTimeout(resolve, ms))

const seedTeamUsers = async (dataPath: string) => {
  const store = await readRelayStore(dataPath)
  store.users.push(
    {
      id: 'user-1',
      email: 'one@example.com',
      name: 'One',
      role: 'member',
      createdAt: timestamp
    },
    {
      id: 'user-2',
      email: 'two@example.com',
      name: 'Two',
      avatarUrl: 'https://cdn.example.com/users/two.png',
      role: 'member',
      createdAt: timestamp
    },
    {
      id: 'admin-1',
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
      createdAt: timestamp
    }
  )
  store.sessions.push(
    {
      token: 'user-1-session',
      userId: 'user-1',
      createdAt: timestamp,
      expiresAt: future,
      lastSeenAt: timestamp
    },
    {
      token: 'user-2-session',
      userId: 'user-2',
      createdAt: timestamp,
      expiresAt: future,
      lastSeenAt: timestamp
    },
    {
      token: 'admin-session',
      userId: 'admin-1',
      createdAt: timestamp,
      expiresAt: future,
      lastSeenAt: timestamp
    }
  )
  await writeRelayStore(dataPath, store)
}

const waitForTeamAuditEvents = async (
  baseUrl: string,
  teamId: string,
  predicate: (event: AuditEventSnapshot) => boolean
) => {
  let events: AuditEventSnapshot[] = []
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const audit = await requestJson(baseUrl, `/api/admin/teams/${teamId}/audit-events`, {
      headers: authHeaders('admin-token')
    })
    events = Array.isArray(audit.body.events) ? audit.body.events as AuditEventSnapshot[] : []
    if (events.some(predicate)) return events
    await sleep(25)
  }
  return events
}

describe('relay team routes', () => {
  it('lets a session create a team and manage members through team role permissions', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedTeamUsers(args.dataPath)

    const created = await requestJson(baseUrl, '/api/relay/teams', {
      method: 'POST',
      headers: authHeaders('user-1-session'),
      body: JSON.stringify({ name: 'Engineering', slug: 'eng' })
    })
    const teamId = (created.body.team as Record<string, unknown>).id as string
    const added = await requestJson(baseUrl, `/api/relay/teams/${teamId}/members`, {
      method: 'POST',
      headers: authHeaders('user-1-session'),
      body: JSON.stringify({ configEnabled: false, role: 'editor', userId: 'user-2' })
    })
    const userTwoTeams = await requestJson(baseUrl, '/api/relay/teams', {
      headers: authHeaders('user-2-session')
    })
    const members = await requestJson(baseUrl, `/api/relay/teams/${teamId}/members`, {
      headers: authHeaders('user-1-session')
    })
    const deniedUpdate = await requestJson(baseUrl, `/api/relay/teams/${teamId}`, {
      method: 'PATCH',
      headers: authHeaders('user-2-session'),
      body: JSON.stringify({ name: 'Blocked' })
    })
    const deniedProxyUpdate = await requestJson(baseUrl, `/api/relay/teams/${teamId}`, {
      method: 'PATCH',
      headers: authHeaders('user-1-session'),
      body: JSON.stringify({ proxyModeEnabled: true })
    })
    const ownerUpdate = await requestJson(baseUrl, `/api/relay/teams/${teamId}/members/user-2`, {
      method: 'PATCH',
      headers: authHeaders('user-1-session'),
      body: JSON.stringify({ configEnabled: true, role: 'member' })
    })
    const ownerArchive = await requestJson(baseUrl, `/api/relay/teams/${teamId}/archive`, {
      method: 'POST',
      headers: authHeaders('user-1-session')
    })
    const ownerRestore = await requestJson(baseUrl, `/api/relay/teams/${teamId}/restore`, {
      method: 'POST',
      headers: authHeaders('user-1-session')
    })
    const lastOwnerDelete = await requestJson(baseUrl, `/api/relay/teams/${teamId}/members/user-1`, {
      method: 'DELETE',
      headers: authHeaders('user-1-session')
    })
    const auditEvents = await waitForTeamAuditEvents(
      baseUrl,
      teamId,
      event => event.action === 'team.member.delete' && event.status === 'failure'
    )

    expect(created.response.status).toBe(200)
    expect(created.body.team).toMatchObject({
      slug: 'eng',
      membership: {
        defaultForPublishing: true,
        role: 'owner'
      }
    })
    expect(added.response.status).toBe(200)
    expect(added.body.member).toMatchObject({
      avatarUrl: 'https://cdn.example.com/users/two.png',
      configEnabled: false,
      role: 'editor',
      userId: 'user-2'
    })
    expect(members.response.status).toBe(200)
    expect(members.body.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          avatarUrl: 'https://cdn.example.com/users/two.png',
          email: 'two@example.com',
          userId: 'user-2'
        })
      ])
    )
    expect(userTwoTeams.response.status).toBe(200)
    expect(userTwoTeams.body.teams).toMatchObject([
      {
        id: teamId,
        membership: {
          configEnabled: false,
          role: 'editor'
        }
      }
    ])
    expect(deniedUpdate.response.status).toBe(403)
    expect(deniedProxyUpdate.response.status).toBe(403)
    expect(deniedProxyUpdate.body).toEqual({ error: 'Team proxy mode can only be managed by tenant admins.' })
    expect(ownerUpdate.response.status).toBe(200)
    expect(ownerUpdate.body.member).toMatchObject({
      configEnabled: true,
      role: 'member',
      userId: 'user-2'
    })
    expect(ownerArchive.response.status).toBe(200)
    expect(ownerArchive.body.team.archivedAt).toEqual(expect.any(String))
    expect(ownerRestore.response.status).toBe(200)
    expect(ownerRestore.body.team.archivedAt).toBeNull()
    expect(lastOwnerDelete.response.status).toBe(400)
    expect(lastOwnerDelete.body).toEqual({ error: 'Team must keep at least one owner.' })
    expect(auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'team.member.create',
          actor: 'session:user-1',
          resource: `team:${teamId}`,
          status: 'success'
        }),
        expect.objectContaining({
          action: 'team.update',
          actor: 'session:user-2',
          resource: `team:${teamId}`,
          status: 'failure'
        }),
        expect.objectContaining({
          action: 'team.archive',
          actor: 'session:user-1',
          resource: `team:${teamId}`,
          status: 'success'
        }),
        expect.objectContaining({
          action: 'team.restore',
          actor: 'session:user-1',
          resource: `team:${teamId}`,
          status: 'success'
        }),
        expect.objectContaining({
          action: 'team.member.delete',
          actor: 'session:user-1',
          resource: `team:${teamId}`,
          status: 'failure'
        })
      ])
    )
  })

  it('enforces tenant team policy for self-service creation and member limits', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedTeamUsers(args.dataPath)

    const policy = await requestJson(baseUrl, '/api/admin/team-policy', {
      method: 'PATCH',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({
        allowedSecretModes: [],
        maxMembersPerTeam: 1,
        selfServiceTeamCreation: false,
        teamsEnabled: true
      })
    })
    const selfServiceCreate = await requestJson(baseUrl, '/api/relay/teams', {
      method: 'POST',
      headers: authHeaders('user-1-session'),
      body: JSON.stringify({ name: 'Blocked Team' })
    })
    const adminCreate = await requestJson(baseUrl, '/api/admin/teams', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ name: 'Admin Team', ownerUserId: 'user-1' })
    })
    const teamId = (adminCreate.body.team as Record<string, unknown>).id as string
    const limitedMember = await requestJson(baseUrl, `/api/admin/teams/${teamId}/members`, {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ role: 'member', userId: 'user-2' })
    })
    const adminUpdate = await requestJson(baseUrl, `/api/admin/teams/${teamId}`, {
      method: 'PATCH',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({
        avatarUrl: 'https://cdn.example.com/relay-demo-team.png',
        description: 'Platform-owned team',
        name: 'Admin Team Updated',
        proxyModeEnabled: true
      })
    })
    const invalidAvatarUpdate = await requestJson(baseUrl, `/api/admin/teams/${teamId}`, {
      method: 'PATCH',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ avatarUrl: 'ftp://cdn.example.com/team.png' })
    })
    const relayPolicy = await requestJson(baseUrl, '/api/relay/team-policy', {
      headers: authHeaders('user-1-session')
    })

    expect(policy.response.status).toBe(200)
    expect(policy.body.policy).toMatchObject({
      allowedSecretModes: [],
      maxMembersPerTeam: 1,
      selfServiceTeamCreation: false,
      teamsEnabled: true
    })
    expect(selfServiceCreate.response.status).toBe(403)
    expect(selfServiceCreate.body).toEqual({
      error: 'Self-service team creation is disabled by tenant policy.'
    })
    expect(adminCreate.response.status).toBe(200)
    expect(adminUpdate.response.status).toBe(200)
    expect(adminUpdate.body.team).toMatchObject({
      avatarUrl: 'https://cdn.example.com/relay-demo-team.png',
      description: 'Platform-owned team',
      name: 'Admin Team Updated',
      proxyModeEnabled: true
    })
    expect(invalidAvatarUpdate.response.status).toBe(400)
    expect(invalidAvatarUpdate.body).toEqual({
      error: 'Team avatar URL must be an HTTP or HTTPS URL.'
    })
    expect(limitedMember.response.status).toBe(403)
    expect(limitedMember.body).toEqual({ error: 'Team member limit reached.' })
    expect(relayPolicy.response.status).toBe(200)
    expect(relayPolicy.body.policy).toMatchObject({
      maxMembersPerTeam: 1,
      selfServiceTeamCreation: false
    })
  })

  it('keeps admin team routes tenant-admin only', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedTeamUsers(args.dataPath)

    const denied = await requestJson(baseUrl, '/api/admin/teams', {
      headers: authHeaders('user-1-session')
    })
    const allowed = await requestJson(baseUrl, '/api/admin/teams', {
      headers: authHeaders('admin-session')
    })

    expect(denied.response.status).toBe(403)
    expect(allowed.response.status).toBe(200)
  })
})
