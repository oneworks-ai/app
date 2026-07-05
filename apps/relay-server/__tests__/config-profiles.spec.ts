import { Buffer } from 'node:buffer'

import { afterEach, describe, expect, it } from 'vitest'

import { relayPermissions } from '../src/permissions/index.js'
import { readRelayStore, writeRelayStore } from '../src/store.js'
import { authHeaders, cleanupRelayFixtures, listenRelay, requestJson } from './helpers.js'

afterEach(cleanupRelayFixtures)

const timestamp = '2026-01-01T00:00:00.000Z'
const future = '2999-01-01T00:00:00.000Z'

const seedConfigProfileFixture = async (
  dataPath: string,
  options: { staleBuiltInMemberCapabilities?: boolean } = {}
) => {
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
  store.devices.push({
    id: 'member-device',
    deviceToken: 'member-device-token',
    userId: 'member-1',
    createdAt: timestamp,
    lastSeenAt: timestamp,
    name: 'Member Device'
  })
  store.teams.push({
    id: 'team-1',
    slug: 'team-1',
    name: 'Team One',
    createdByUserId: 'owner-1',
    createdAt: timestamp,
    accessGroups: options.staleBuiltInMemberCapabilities
      ? [
        {
          id: 'team:member',
          scope: 'team',
          name: '团队成员',
          builtIn: true,
          capabilities: {
            allow: [
              relayPermissions.relayTeamMembersRead,
              relayPermissions.relayTeamsRead,
              relayPermissions.relayTeamConfigProfilesRead,
              relayPermissions.relayTeamConfigProfilesWrite,
              relayPermissions.relayTeamConfigSecretsRead,
              relayPermissions.relayTeamConfigSecretsWrite
            ]
          },
          createdAt: timestamp
        }
      ]
      : undefined
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
    const ownerProfiles = await requestJson(baseUrl, '/api/relay/teams/team-1/config-profiles', {
      headers: authHeaders('owner-session')
    })
    const deniedMemberProfiles = await requestJson(baseUrl, '/api/relay/teams/team-1/config-profiles', {
      headers: authHeaders('member-session')
    })
    const deniedMemberProfileDetail = await requestJson(baseUrl, `/api/relay/config-profiles/${profileId}`, {
      headers: authHeaders('member-session')
    })
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
    expect(ownerProfiles.response.status).toBe(200)
    expect(ownerProfiles.body.profiles).toMatchObject([{ id: profileId, name: 'Team Config' }])
    expect(deniedMemberProfiles.response.status).toBe(403)
    expect(deniedMemberProfileDetail.response.status).toBe(403)
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

  it('normalizes stale built-in member permissions before checking profile management access', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedConfigProfileFixture(args.dataPath, { staleBuiltInMemberCapabilities: true })

    const profile = await requestJson(baseUrl, '/api/relay/teams/team-1/config-profiles', {
      method: 'POST',
      headers: authHeaders('owner-session'),
      body: JSON.stringify({ name: 'Stale Access Team Config' })
    })
    const profileId = (profile.body.profile as Record<string, unknown>).id as string
    const deniedMemberProfiles = await requestJson(baseUrl, '/api/relay/teams/team-1/config-profiles', {
      headers: authHeaders('member-session')
    })
    const deniedMemberProfileDetail = await requestJson(baseUrl, `/api/relay/config-profiles/${profileId}`, {
      headers: authHeaders('member-session')
    })

    expect(profile.response.status).toBe(200)
    expect(deniedMemberProfiles.response.status).toBe(403)
    expect(deniedMemberProfileDetail.response.status).toBe(403)
  })

  it('stores encrypted team instruction documents without exposing plaintext', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedConfigProfileFixture(args.dataPath)

    const update = await requestJson(baseUrl, '/api/relay/teams/team-1/documents', {
      body: JSON.stringify({
        documents: {
          countsByKind: {
            agents: 1
          },
          documentCount: 1,
          encryptedPayload: {
            algorithm: 'aes-256-gcm',
            ciphertext: Buffer.from('encrypted team documents').toString('base64'),
            iv: Buffer.from('abcdefghijkl').toString('base64'),
            tag: Buffer.from('abcdefghijklmnop').toString('base64'),
            version: 1
          },
          plaintext: 'team AGENTS secret content',
          totalSizeBytes: 96,
          version: 1
        }
      }),
      headers: authHeaders('owner-session'),
      method: 'PUT'
    })
    const pulled = await requestJson(baseUrl, '/api/relay/teams/team-1/documents', {
      headers: authHeaders('owner-session')
    })
    const deniedMember = await requestJson(baseUrl, '/api/relay/teams/team-1/documents', {
      headers: authHeaders('member-session')
    })
    const stale = await requestJson(baseUrl, '/api/relay/teams/team-1/documents', {
      body: JSON.stringify({
        baseHash: 'sha256:stale',
        documents: {
          countsByKind: {
            agents: 1
          },
          documentCount: 1,
          encryptedPayload: {
            algorithm: 'aes-256-gcm',
            ciphertext: Buffer.from('new encrypted docs').toString('base64'),
            iv: Buffer.from('123456789012').toString('base64'),
            tag: Buffer.from('1234567890123456').toString('base64'),
            version: 1
          },
          totalSizeBytes: 24,
          version: 1
        }
      }),
      headers: authHeaders('owner-session'),
      method: 'PUT'
    })
    const serialized = JSON.stringify(pulled.body)

    expect(update.response.status).toBe(200)
    expect(pulled.response.status).toBe(200)
    expect(deniedMember.response.status).toBe(403)
    expect(stale.response.status).toBe(409)
    expect(pulled.body.teamDocumentSnapshot).toMatchObject({
      countsByKind: {
        agents: 1
      },
      documentCount: 1,
      encryptedPayload: {
        algorithm: 'aes-256-gcm',
        ciphertext: Buffer.from('encrypted team documents').toString('base64'),
        version: 1
      },
      hash: expect.stringMatching(/^sha256:/),
      teamId: 'team-1',
      totalSizeBytes: 96,
      updatedByUserId: 'owner-1',
      version: 1
    })
    expect(serialized).not.toContain('team AGENTS secret content')
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

  it('delivers profile secrets only as device encrypted snapshot envelopes', async () => {
    const { args, baseUrl } = await listenRelay()
    await seedConfigProfileFixture(args.dataPath)

    const createdSecret = await requestJson(baseUrl, '/api/relay/teams/team-1/config-secrets', {
      method: 'POST',
      headers: authHeaders('owner-session'),
      body: JSON.stringify({ name: 'OpenAI API key', value: 'sk-relay-team-secret' })
    })
    const secret = createdSecret.body.secret as Record<string, unknown>
    const ownerSecrets = await requestJson(baseUrl, '/api/relay/teams/team-1/config-secrets', {
      headers: authHeaders('owner-session')
    })
    const deniedMemberSecrets = await requestJson(baseUrl, '/api/relay/teams/team-1/config-secrets', {
      headers: authHeaders('member-session')
    })
    const profile = await requestJson(baseUrl, '/api/relay/teams/team-1/config-profiles', {
      method: 'POST',
      headers: authHeaders('owner-session'),
      body: JSON.stringify({ name: 'Secret Team Config' })
    })
    const profileId = (profile.body.profile as Record<string, unknown>).id as string
    const version = await requestJson(baseUrl, `/api/relay/config-profiles/${profileId}/versions`, {
      method: 'POST',
      headers: authHeaders('owner-session'),
      body: JSON.stringify({
        allowedFields: ['defaultModelService', 'modelServices'],
        configPatch: {
          defaultModelService: 'relay-secret',
          modelServices: {
            'relay-secret': {
              apiBaseUrl: 'https://relay.example.com/v1',
              apiKey: 'sk-relay-team-secret'
            }
          }
        },
        secretRefs: {
          'modelServices.relay-secret.apiKey': secret.id
        }
      })
    })
    const versionId = (version.body.version as Record<string, unknown>).id as string
    await requestJson(baseUrl, `/api/relay/config-profiles/${profileId}/publish`, {
      method: 'POST',
      headers: authHeaders('owner-session'),
      body: JSON.stringify({ versionId })
    })
    await requestJson(baseUrl, `/api/relay/config-profiles/${profileId}/assignments`, {
      method: 'POST',
      headers: authHeaders('owner-session'),
      body: JSON.stringify({})
    })

    const deviceSnapshot = await requestJson(baseUrl, '/api/relay/config-snapshot', {
      headers: authHeaders('member-device-token')
    })
    const sessionSnapshot = await requestJson(baseUrl, '/api/relay/config-snapshot', {
      headers: authHeaders('member-session')
    })
    const deviceAssignments = deviceSnapshot.body.assignments as Array<Record<string, unknown>>
    const deviceSecrets = deviceAssignments[0]?.secrets as Array<Record<string, unknown>>

    expect(createdSecret.response.status).toBe(200)
    expect(ownerSecrets.response.status).toBe(200)
    expect(ownerSecrets.body.secrets).toMatchObject([{ id: secret.id, name: 'OpenAI API key' }])
    expect(deniedMemberSecrets.response.status).toBe(403)
    expect(createdSecret.body).toMatchObject({
      secret: {
        id: expect.any(String),
        name: 'OpenAI API key',
        revokedAt: null,
        secretVersion: 1,
        teamId: 'team-1'
      }
    })
    expect(JSON.stringify(createdSecret.body)).not.toContain('sk-relay-team-secret')
    expect(version.response.status).toBe(200)
    expect(deviceSnapshot.response.status).toBe(200)
    expect(deviceAssignments).toHaveLength(1)
    expect(deviceAssignments[0]).toMatchObject({
      configPatch: {
        defaultModelService: 'relay-secret',
        modelServices: {
          'relay-secret': {
            apiBaseUrl: 'https://relay.example.com/v1'
          }
        }
      },
      mustRefreshAfter: expect.any(String)
    })
    expect(deviceSecrets).toHaveLength(1)
    expect(deviceSecrets[0]).toMatchObject({
      algorithm: 'aes-256-gcm',
      ciphertext: expect.any(String),
      expiresAt: expect.any(String),
      iv: expect.any(String),
      keyId: 'device:member-device:token',
      recipientDeviceId: 'member-device',
      ref: 'modelServices.relay-secret.apiKey',
      secretId: secret.id,
      secretVersion: 1,
      tag: expect.any(String),
      version: 1
    })
    expect(sessionSnapshot.response.status).toBe(200)
    expect(JSON.stringify(sessionSnapshot.body)).not.toContain('"secrets"')
    expect(JSON.stringify(deviceSnapshot.body)).not.toContain('sk-relay-team-secret')
    expect(JSON.stringify(sessionSnapshot.body)).not.toContain('sk-relay-team-secret')
  })
})
