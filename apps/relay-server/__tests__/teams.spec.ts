import { afterEach, describe, expect, it } from 'vitest'

import { readRelayStore, writeRelayStore } from '../src/store.js'
import { authHeaders, cleanupRelayFixtures, listenRelay, requestJson } from './helpers.js'

afterEach(cleanupRelayFixtures)

const timestamp = '2026-01-01T00:00:00.000Z'
const future = '2999-01-01T00:00:00.000Z'

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
    const deniedUpdate = await requestJson(baseUrl, `/api/relay/teams/${teamId}`, {
      method: 'PATCH',
      headers: authHeaders('user-2-session'),
      body: JSON.stringify({ name: 'Blocked' })
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
      configEnabled: false,
      role: 'editor',
      userId: 'user-2'
    })
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
