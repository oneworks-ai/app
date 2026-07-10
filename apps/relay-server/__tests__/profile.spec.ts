/* eslint-disable max-lines -- Profile route tests cover auth, tokens, account deletion, and OpenAPI inventory together. */

import { afterEach, describe, expect, it } from 'vitest'

import {
  defaultRelayAccessGroups,
  defaultTeamAccessGroupIds,
  normalizeRelayTeamAccessGroups
} from '../src/access-groups.js'
import { hashPassword, verifyPassword } from '../src/auth/passwords.js'
import { buildRelayAdminOpenApiDocument, buildRelayProfileOpenApiDocument } from '../src/routes/admin-openapi.js'
import { readRelayStore, writeRelayStore } from '../src/store.js'
import type { RelayStore } from '../src/types.js'
import { authHeaders, cleanupRelayFixtures, listenRelay, requestJson } from './helpers.js'

afterEach(cleanupRelayFixtures)

const timestamp = '2026-01-01T00:00:00.000Z'
const future = '2999-01-01T00:00:00.000Z'
const sortedPathNames = (document: { paths: Record<string, unknown> }) => Object.keys(document.paths).sort()
const httpMethods = ['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace'] as const

interface OpenApiDocumentForTest {
  components: {
    schemas: Record<string, unknown>
  }
  openapi: string
  paths: Record<string, Record<string, unknown>>
  tags: Array<{ name: string }>
}

const publicOpenApiPaths = new Set([
  '/api/admin/openapi.json',
  '/api/auth/providers',
  '/api/profile/openapi.json',
  '/api/relay/info',
  '/health'
])

const internalRuntimePathPrefixes = [
  '/api/auth/email-code',
  '/api/auth/invite-login',
  '/api/auth/oauth',
  '/api/auth/passkey',
  '/api/auth/password-login',
  '/api/relay/devices',
  '/api/relay/session-jobs'
]

const currentUserRelayPathPrefixes = [
  '/api/relay/config/',
  '/api/relay/config-',
  '/api/relay/team-policy',
  '/api/relay/teams'
]

const openApiDocument = (document: unknown) => document as OpenApiDocumentForTest

const openApiOperations = (document: OpenApiDocumentForTest) =>
  Object.entries(document.paths).flatMap(([path, pathItem]) =>
    httpMethods.flatMap(method => {
      const operation = pathItem[method]
      return operation != null && typeof operation === 'object' && !Array.isArray(operation)
        ? [{ method, operation: operation as Record<string, unknown>, path }]
        : []
    })
  )

const collectSchemaRefs = (value: unknown, refs = new Set<string>()) => {
  if (Array.isArray(value)) {
    value.forEach(item => collectSchemaRefs(item, refs))
    return refs
  }

  if (value == null || typeof value !== 'object') return refs

  const record = value as Record<string, unknown>
  if (typeof record.$ref === 'string' && record.$ref.startsWith('#/components/schemas/')) {
    refs.add(record.$ref.slice('#/components/schemas/'.length))
  }
  Object.values(record).forEach(item => collectSchemaRefs(item, refs))
  return refs
}

const expectValidOpenApiContract = (document: OpenApiDocumentForTest) => {
  expect(document.openapi).toBe('3.1.0')
  expect(document.components.schemas).toHaveProperty('ErrorResponse')
  expect(document.components.schemas).toHaveProperty('RelayAuthUser')

  const schemaNames = new Set(Object.keys(document.components.schemas))
  for (const schemaName of collectSchemaRefs(document)) {
    expect(schemaNames.has(schemaName), `missing schema ${schemaName}`).toBe(true)
  }

  const tagNames = new Set(document.tags.map(tag => tag.name))
  const operationIds = new Map<string, string>()
  for (const { method, operation, path } of openApiOperations(document)) {
    expect(typeof operation.operationId, `${method.toUpperCase()} ${path} operationId`).toBe('string')
    const operationId = String(operation.operationId)
    const previousPath = operationIds.get(operationId)
    expect(previousPath, `duplicate operationId ${operationId}`).toBeUndefined()
    operationIds.set(operationId, `${method.toUpperCase()} ${path}`)

    expect(operation.responses, `${method.toUpperCase()} ${path} responses`).toBeDefined()
    const tags = Array.isArray(operation.tags) ? operation.tags : []
    expect(tags.length, `${method.toUpperCase()} ${path} tags`).toBeGreaterThan(0)
    for (const tag of tags) {
      expect(typeof tag).toBe('string')
      expect(tagNames.has(String(tag)), `unknown tag ${String(tag)}`).toBe(true)
    }

    if (!publicOpenApiPaths.has(path)) {
      expect(operation.security, `${method.toUpperCase()} ${path} security`).toEqual([{ bearerAuth: [] }])
    }
  }
}

const visibilityClassForPath = (path: string) => {
  if (publicOpenApiPaths.has(path) || path === '/api/auth/me' || path === '/api/auth/logout') return 'common-auth'
  if (path.startsWith('/api/admin/') || path === '/api/relay/metrics') return 'platform-admin'
  if (path.startsWith('/api/profile/') || currentUserRelayPathPrefixes.some(prefix => path.startsWith(prefix))) {
    return 'current-user'
  }
  if (internalRuntimePathPrefixes.some(prefix => path.startsWith(prefix))) return 'internal-runtime'
  return 'unknown'
}

const expectVisibilityClasses = (document: OpenApiDocumentForTest, allowedClasses: string[]) => {
  const allowed = new Set(allowedClasses)
  for (const path of Object.keys(document.paths)) {
    const visibilityClass = visibilityClassForPath(path)
    expect(allowed.has(visibilityClass), `${path} visibility class ${visibilityClass}`).toBe(true)
  }
}

const createProfileStore = (): RelayStore => ({
  createdAt: timestamp,
  accessGroups: defaultRelayAccessGroups(),
  auditEvents: [],
  configAssignments: [],
  configProfileAssignments: [],
  configProfileVersions: [],
  configProfiles: [],
  configSecrets: [],
  emailRisk: {
    buckets: [],
    challenges: []
  },
  messages: [],
  teamInvitations: [],
  teamMembers: [],
  teamPolicy: {
    allowedSecretModes: ['device_encrypted'],
    proxyModeEnabled: false,
    selfServiceTeamCreation: true,
    teamsEnabled: true,
    tenantId: 'default'
  },
  teams: [],
  users: [
    {
      id: 'admin-user',
      email: 'admin@example.com',
      name: 'Admin',
      role: 'admin',
      createdAt: timestamp
    }
  ],
  authIdentities: [],
  invites: [],
  ssoProviders: [],
  passkeyChallenges: [],
  passkeys: [],
  devices: [],
  deviceSessions: [],
  forwardingJobs: [],
  oauthStates: [],
  accessTokens: [],
  sessions: [
    {
      token: 'admin-session-token',
      userId: 'admin-user',
      createdAt: timestamp,
      expiresAt: future,
      lastSeenAt: timestamp
    }
  ]
})

const delay = async (durationMs: number) => await new Promise(resolve => setTimeout(resolve, durationMs))

const waitForOpenApiAuditEvents = async (dataPath: string, expectedCount: number) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const store = await readRelayStore(dataPath)
    if ((store.openApiAuditEvents ?? []).length >= expectedCount) return
    await delay(10)
  }
  const store = await readRelayStore(dataPath)
  expect(store.openApiAuditEvents ?? []).toHaveLength(expectedCount)
}

describe('relay profile security routes', () => {
  it('keeps platform admin and current-user OpenAPI path inventories separated', () => {
    const adminSpec = openApiDocument(buildRelayAdminOpenApiDocument('https://relay.example.com'))
    const profileSpec = openApiDocument(buildRelayProfileOpenApiDocument('https://relay.example.com'))

    expect(sortedPathNames(adminSpec)).toEqual([
      '/api/admin/access-groups',
      '/api/admin/access-groups/{accessGroupId}',
      '/api/admin/config-assignments/{assignmentId}',
      '/api/admin/config-assignments/{assignmentId}/documents',
      '/api/admin/config-profiles/{profileId}',
      '/api/admin/config-profiles/{profileId}/assignments',
      '/api/admin/config-profiles/{profileId}/publish',
      '/api/admin/config-profiles/{profileId}/versions',
      '/api/admin/config-secrets/{secretId}',
      '/api/admin/config-secrets/{secretId}/revoke',
      '/api/admin/config-secrets/{secretId}/rotate',
      '/api/admin/invites',
      '/api/admin/invites/{code}',
      '/api/admin/messages',
      '/api/admin/openapi.json',
      '/api/admin/security/tokens/revoke',
      '/api/admin/security/tokens/rotate',
      '/api/admin/sso-providers',
      '/api/admin/sso-providers/{providerId}',
      '/api/admin/team-invitations/{invitationId}/accept',
      '/api/admin/team-invitations/{invitationId}/decline',
      '/api/admin/team-policy',
      '/api/admin/teams',
      '/api/admin/teams/{teamId}',
      '/api/admin/teams/{teamId}/access-groups',
      '/api/admin/teams/{teamId}/access-groups/{accessGroupId}',
      '/api/admin/teams/{teamId}/archive',
      '/api/admin/teams/{teamId}/audit-events',
      '/api/admin/teams/{teamId}/config-profiles',
      '/api/admin/teams/{teamId}/config-secrets',
      '/api/admin/teams/{teamId}/documents',
      '/api/admin/teams/{teamId}/invitations',
      '/api/admin/teams/{teamId}/members',
      '/api/admin/teams/{teamId}/members/{memberId}',
      '/api/admin/teams/{teamId}/restore',
      '/api/admin/users',
      '/api/admin/users/{userId}',
      '/api/auth/logout',
      '/api/auth/me',
      '/api/auth/providers',
      '/api/relay/info',
      '/api/relay/metrics',
      '/health'
    ])
    expect(sortedPathNames(profileSpec)).toEqual([
      '/api/auth/logout',
      '/api/auth/me',
      '/api/auth/providers',
      '/api/profile/access-tokens',
      '/api/profile/access-tokens/{tokenId}',
      '/api/profile/account',
      '/api/profile/openapi-audit',
      '/api/profile/openapi.json',
      '/api/profile/passkeys/register/options',
      '/api/profile/passkeys/register/verify',
      '/api/profile/password',
      '/api/profile/security',
      '/api/relay/config-assignments/{assignmentId}',
      '/api/relay/config-assignments/{assignmentId}/documents',
      '/api/relay/config-profiles/{profileId}',
      '/api/relay/config-profiles/{profileId}/assignments',
      '/api/relay/config-profiles/{profileId}/publish',
      '/api/relay/config-profiles/{profileId}/versions',
      '/api/relay/config-secrets/{secretId}',
      '/api/relay/config-secrets/{secretId}/revoke',
      '/api/relay/config-secrets/{secretId}/rotate',
      '/api/relay/config-snapshot',
      '/api/relay/config/global',
      '/api/relay/info',
      '/api/relay/team-policy',
      '/api/relay/teams',
      '/api/relay/teams/{teamId}',
      '/api/relay/teams/{teamId}/access-groups',
      '/api/relay/teams/{teamId}/access-groups/{accessGroupId}',
      '/api/relay/teams/{teamId}/archive',
      '/api/relay/teams/{teamId}/audit-events',
      '/api/relay/teams/{teamId}/config-profiles',
      '/api/relay/teams/{teamId}/config-secrets',
      '/api/relay/teams/{teamId}/documents',
      '/api/relay/teams/{teamId}/invitations',
      '/api/relay/teams/{teamId}/members',
      '/api/relay/teams/{teamId}/members/{memberId}',
      '/api/relay/teams/{teamId}/restore',
      '/health'
    ])
  })

  it('keeps OpenAPI contracts valid and visibility classes explicit', () => {
    const adminSpec = openApiDocument(buildRelayAdminOpenApiDocument('https://relay.example.com'))
    const profileSpec = openApiDocument(buildRelayProfileOpenApiDocument('https://relay.example.com'))

    expectValidOpenApiContract(adminSpec)
    expectValidOpenApiContract(profileSpec)
    expectVisibilityClasses(adminSpec, ['common-auth', 'platform-admin'])
    expectVisibilityClasses(profileSpec, ['common-auth', 'current-user'])
    expect(Object.keys(adminSpec.components.schemas).some(name => name.startsWith('RelayProfile'))).toBe(false)
    expect(Object.keys(profileSpec.components.schemas).some(name => name.startsWith('RelayAdmin'))).toBe(false)
    for (const forbiddenPrefix of internalRuntimePathPrefixes) {
      expect(sortedPathNames(adminSpec).some(path => path.startsWith(forbiddenPrefix))).toBe(false)
      expect(sortedPathNames(profileSpec).some(path => path.startsWith(forbiddenPrefix))).toBe(false)
    }
  })

  it('resolves login sessions before open admin fallback in local dev mode', async () => {
    const { args, baseUrl } = await listenRelay({ adminToken: '' })
    await writeRelayStore(args.dataPath, createProfileStore())

    const profileSecurity = await requestJson(baseUrl, '/api/profile/security', {
      headers: authHeaders('admin-session-token')
    })
    const adminUsers = await requestJson(baseUrl, '/api/admin/users')

    expect(profileSecurity.response.status).toBe(200)
    expect(profileSecurity.body.accessTokens).toEqual([])
    expect(profileSecurity.body.accountDeletion).toEqual({ available: true })
    expect(profileSecurity.body.password).toEqual({ enabled: false })
    expect(adminUsers.response.status).toBe(200)
    expect(adminUsers.body.users).toMatchObject([
      {
        id: 'admin-user'
      }
    ])
  })

  it('deletes the current profile account and invalidates related login data', async () => {
    const { args, baseUrl } = await listenRelay()
    const store = createProfileStore()
    store.authIdentities.push({
      id: 'identity-1',
      userId: 'admin-user',
      provider: 'password',
      providerUserId: 'admin-user',
      email: 'admin@example.com',
      emailVerified: true,
      createdAt: timestamp
    })
    store.accessTokens.push({
      id: 'access-token-1',
      userId: 'admin-user',
      name: 'Delete Me',
      tokenHash: 'sha256:delete-me',
      tokenPreview: 'owrt_delete',
      createdAt: timestamp
    })
    store.openApiAuditEvents = [
      {
        id: 'audit-1',
        tokenId: 'access-token-1',
        tokenPreview: 'owrt_delete',
        userId: 'admin-user',
        method: 'GET',
        path: '/api/admin/users',
        status: 200,
        createdAt: timestamp
      }
    ]
    store.passkeys.push({
      backedUp: false,
      counter: 0,
      createdAt: timestamp,
      deviceType: 'singleDevice',
      id: 'passkey-1',
      publicKey: 'public-key',
      userId: 'admin-user'
    })
    store.passkeyChallenges.push({
      challenge: 'challenge-1',
      createdAt: timestamp,
      expiresAt: future,
      id: 'challenge-1',
      kind: 'registration',
      origin: 'https://relay.example.com',
      rpId: 'relay.example.com',
      userId: 'admin-user'
    })
    store.devices.push({
      id: 'device-1',
      userId: 'admin-user',
      createdAt: timestamp,
      lastSeenAt: timestamp
    })
    store.deviceSessions.push({
      id: 'device-session-1',
      deviceId: 'device-1',
      userId: 'admin-user',
      title: 'Workspace',
      createdAt: timestamp,
      updatedAt: timestamp
    })
    store.teams.push({
      id: 'team-1',
      name: 'Team 1',
      slug: 'team-1',
      createdByUserId: 'admin-user',
      createdAt: timestamp
    })
    store.teamMembers.push({
      id: 'member-1',
      teamId: 'team-1',
      userId: 'admin-user',
      role: 'owner',
      createdByUserId: 'admin-user',
      createdAt: timestamp
    })
    store.teamInvitations = [
      {
        id: 'team-invitation-1',
        teamId: 'team-1',
        userId: 'admin-user',
        role: 'member',
        status: 'pending',
        createdByUserId: 'system',
        createdAt: timestamp
      }
    ]
    store.messages = [
      {
        id: 'message-1',
        kind: 'personal',
        title: 'Keep for other user',
        body: 'Body',
        audience: { scope: 'users', userIds: ['admin-user', 'other-user'] },
        createdByUserId: 'system',
        createdAt: timestamp
      },
      {
        id: 'message-2',
        kind: 'personal',
        title: 'Only admin',
        body: 'Body',
        audience: { scope: 'users', userIds: ['admin-user'] },
        createdByUserId: 'system',
        createdAt: timestamp
      },
      {
        id: 'message-3',
        kind: 'announcement',
        title: 'Created by admin',
        body: 'Body',
        audience: { scope: 'all' },
        createdByUserId: 'admin-user',
        createdAt: timestamp
      }
    ]
    store.configAssignments.push({
      id: 'assignment-1',
      target: { userIds: ['admin-user', 'other-user'] }
    })
    store.configProfileAssignments.push({
      id: 'profile-assignment-1',
      profileId: 'profile-1',
      priority: 10,
      mode: 'default',
      enabled: true,
      target: { userIds: ['admin-user', 'other-user'] },
      createdAt: timestamp
    })
    await writeRelayStore(args.dataPath, store)

    const deleted = await requestJson(baseUrl, '/api/profile/account', {
      method: 'DELETE',
      headers: authHeaders('admin-session-token')
    })
    const rejected = await requestJson(baseUrl, '/api/profile/security', {
      headers: authHeaders('admin-session-token')
    })
    const nextStore = await readRelayStore(args.dataPath)

    expect(deleted.response.status).toBe(200)
    expect(deleted.body).toEqual({ deleted: true, userId: 'admin-user' })
    expect(rejected.response.status).toBe(401)
    expect(nextStore.users.some(user => user.id === 'admin-user')).toBe(false)
    expect(nextStore.authIdentities.some(identity => identity.userId === 'admin-user')).toBe(false)
    expect(nextStore.sessions.some(session => session.userId === 'admin-user')).toBe(false)
    expect(nextStore.accessTokens.some(token => token.userId === 'admin-user')).toBe(false)
    expect(nextStore.openApiAuditEvents?.some(event => event.userId === 'admin-user')).toBe(false)
    expect(nextStore.passkeys.some(passkey => passkey.userId === 'admin-user')).toBe(false)
    expect(nextStore.passkeyChallenges.some(challenge => challenge.userId === 'admin-user')).toBe(false)
    expect(nextStore.devices.some(device => device.userId === 'admin-user')).toBe(false)
    expect(nextStore.deviceSessions.some(session => session.userId === 'admin-user')).toBe(false)
    expect(nextStore.teamMembers.some(member => member.userId === 'admin-user')).toBe(false)
    expect(nextStore.teamInvitations?.some(invitation => invitation.userId === 'admin-user')).toBe(false)
    expect(nextStore.messages?.map(message => message.id)).toEqual(['message-1'])
    expect(nextStore.messages?.[0].audience).toEqual({ scope: 'users', userIds: ['other-user'] })
    expect(nextStore.configAssignments[0].target?.userIds).toEqual(['other-user'])
    expect(nextStore.configProfileAssignments[0].target?.userIds).toEqual(['other-user'])
  })

  it('allows profile access tokens to delete the current account', async () => {
    const { args, baseUrl } = await listenRelay()
    await writeRelayStore(args.dataPath, createProfileStore())

    const created = await requestJson(baseUrl, '/api/profile/access-tokens', {
      method: 'POST',
      headers: authHeaders('admin-session-token'),
      body: JSON.stringify({ name: 'Self delete', scope: 'user' })
    })
    const accessToken = String(created.body.accessToken)
    const listed = await requestJson(baseUrl, '/api/profile/security', {
      headers: authHeaders(accessToken)
    })
    const deleted = await requestJson(baseUrl, '/api/profile/account', {
      method: 'DELETE',
      headers: authHeaders(accessToken)
    })
    const nextStore = await readRelayStore(args.dataPath)

    expect(created.response.status).toBe(200)
    expect(listed.response.status).toBe(200)
    expect(listed.body.accountDeletion).toEqual({ available: true })
    expect(deleted.response.status).toBe(200)
    expect(deleted.body).toEqual({ deleted: true, userId: 'admin-user' })
    expect(nextStore.users.some(user => user.id === 'admin-user')).toBe(false)
    expect(nextStore.accessTokens.some(token => token.userId === 'admin-user')).toBe(false)
  })

  it('creates platform API access tokens without storing the full token and authorizes admin APIs', async () => {
    const { args, baseUrl } = await listenRelay()
    await writeRelayStore(args.dataPath, createProfileStore())

    const created = await requestJson(baseUrl, '/api/profile/access-tokens', {
      method: 'POST',
      headers: authHeaders('admin-session-token'),
      body: JSON.stringify({ name: 'Codex OpenAPI', scope: 'platform' })
    })
    const accessToken = String(created.body.accessToken)
    const store = await readRelayStore(args.dataPath)
    const listed = await requestJson(baseUrl, '/api/profile/security', {
      headers: authHeaders('admin-session-token')
    })
    const adminUsers = await requestJson(baseUrl, '/api/admin/users', {
      headers: authHeaders(accessToken)
    })
    const recursiveCreate = await requestJson(baseUrl, '/api/profile/access-tokens', {
      method: 'POST',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ name: 'blocked' })
    })
    await waitForOpenApiAuditEvents(args.dataPath, 2)

    expect(created.response.status).toBe(200)
    expect(accessToken).toMatch(/^owrt_/)
    expect(created.body.token).toMatchObject({
      name: 'Codex OpenAPI'
    })
    expect(JSON.stringify(store)).not.toContain(accessToken)
    expect(store.accessTokens[0].tokenHash).toMatch(/^sha256:/)
    expect(listed.body.accessTokens).toMatchObject([
      {
        name: 'Codex OpenAPI'
      }
    ])
    expect(adminUsers.response.status).toBe(200)
    expect(adminUsers.body.users).toMatchObject([
      {
        id: 'admin-user'
      }
    ])
    expect(recursiveCreate.response.status).toBe(403)
    expect(recursiveCreate.body).toEqual({ error: 'Relay login session required.' })
  })

  it('separates user, team, and platform access token scopes', async () => {
    const { args, baseUrl } = await listenRelay()
    const store = createProfileStore()
    store.teams.push(
      {
        id: 'team-a',
        name: 'Team A',
        slug: 'team-a',
        accessGroups: normalizeRelayTeamAccessGroups(undefined),
        createdByUserId: 'admin-user',
        createdAt: timestamp
      },
      {
        id: 'team-b',
        name: 'Team B',
        slug: 'team-b',
        accessGroups: normalizeRelayTeamAccessGroups(undefined),
        createdByUserId: 'admin-user',
        createdAt: timestamp
      }
    )
    store.teamMembers.push(
      {
        id: 'member-a',
        teamId: 'team-a',
        userId: 'admin-user',
        role: 'viewer',
        groupIds: defaultTeamAccessGroupIds('viewer'),
        configEnabled: true,
        defaultForPublishing: false,
        createdByUserId: 'admin-user',
        createdAt: timestamp
      },
      {
        id: 'member-b',
        teamId: 'team-b',
        userId: 'admin-user',
        role: 'owner',
        groupIds: defaultTeamAccessGroupIds('owner'),
        configEnabled: true,
        defaultForPublishing: true,
        createdByUserId: 'admin-user',
        createdAt: timestamp
      }
    )
    await writeRelayStore(args.dataPath, store)

    const userCreated = await requestJson(baseUrl, '/api/profile/access-tokens', {
      method: 'POST',
      headers: authHeaders('admin-session-token'),
      body: JSON.stringify({ name: 'Personal API', scope: 'user' })
    })
    const teamCreated = await requestJson(baseUrl, '/api/profile/access-tokens', {
      method: 'POST',
      headers: authHeaders('admin-session-token'),
      body: JSON.stringify({ name: 'Team A API', scope: 'team', teamId: 'team-a' })
    })
    const userAccessToken = String(userCreated.body.accessToken)
    const teamAccessToken = String(teamCreated.body.accessToken)
    const userProfile = await requestJson(baseUrl, '/api/profile/security', {
      headers: authHeaders(userAccessToken)
    })
    const userAdminUsers = await requestJson(baseUrl, '/api/admin/users', {
      headers: authHeaders(userAccessToken)
    })
    const teamList = await requestJson(baseUrl, '/api/relay/teams', {
      headers: authHeaders(teamAccessToken)
    })
    const otherTeam = await requestJson(baseUrl, '/api/relay/teams/team-b', {
      headers: authHeaders(teamAccessToken)
    })
    await waitForOpenApiAuditEvents(args.dataPath, 4)

    expect(userCreated.body.token).toMatchObject({
      name: 'Personal API',
      permissionGroupIds: [],
      permissionGroupMode: 'all',
      scope: 'user',
      teamId: null
    })
    expect(teamCreated.body.token).toMatchObject({
      name: 'Team A API',
      permissionGroupIds: [],
      permissionGroupMode: 'all',
      scope: 'team',
      teamId: 'team-a'
    })
    expect(userProfile.response.status).toBe(200)
    expect(userAdminUsers.response.status).toBe(403)
    expect(teamList.response.status).toBe(200)
    expect(teamList.body.teams).toMatchObject([{ id: 'team-a' }])
    expect(otherTeam.response.status).toBe(403)
  })

  it('records and filters API access token OpenAPI audit events', async () => {
    const { args, baseUrl } = await listenRelay()
    await writeRelayStore(args.dataPath, createProfileStore())

    const created = await requestJson(baseUrl, '/api/profile/access-tokens', {
      method: 'POST',
      headers: authHeaders('admin-session-token'),
      body: JSON.stringify({ name: 'Audit Key', scope: 'platform' })
    })
    const accessToken = String(created.body.accessToken)
    const token = created.body.token as { id: string; tokenPreview: string }

    await requestJson(baseUrl, '/api/admin/users', {
      headers: {
        ...authHeaders(accessToken),
        'user-agent': 'relay-openapi-audit-test',
        'x-forwarded-for': '203.0.113.7'
      }
    })
    await requestJson(baseUrl, '/api/profile/access-tokens', {
      method: 'POST',
      headers: {
        ...authHeaders(accessToken),
        'user-agent': 'relay-openapi-audit-test',
        'x-forwarded-for': '203.0.113.7'
      },
      body: JSON.stringify({ name: 'blocked' })
    })
    await waitForOpenApiAuditEvents(args.dataPath, 2)

    const successAudit = await requestJson(
      baseUrl,
      `/api/profile/openapi-audit?key=${encodeURIComponent(token.tokenPreview.slice(0, 8))}&path=${
        encodeURIComponent('/api/admin/users')
      }&status=success`,
      {
        headers: authHeaders('admin-session-token')
      }
    )
    const failureAudit = await requestJson(
      baseUrl,
      `/api/profile/openapi-audit?path=${encodeURIComponent('/api/profile/access-tokens')}&status=failure`,
      {
        headers: authHeaders('admin-session-token')
      }
    )
    const tokenAudit = await requestJson(baseUrl, '/api/profile/openapi-audit', {
      headers: authHeaders(accessToken)
    })
    await waitForOpenApiAuditEvents(args.dataPath, 3)
    const successEvents = successAudit.body.events as Array<Record<string, unknown>>
    const failureEvents = failureAudit.body.events as Array<Record<string, unknown>>

    expect(successAudit.response.status).toBe(200)
    expect(successEvents).toHaveLength(1)
    expect(successEvents[0]).toMatchObject({
      tokenId: token.id,
      tokenPreview: token.tokenPreview,
      userId: 'admin-user',
      method: 'GET',
      path: '/api/admin/users',
      status: 200,
      ip: '203.0.113.7',
      userAgent: 'relay-openapi-audit-test',
      permission: 'admin.users.read',
      error: null
    })
    expect(failureEvents[0]).toMatchObject({
      tokenId: token.id,
      tokenPreview: token.tokenPreview,
      userId: 'admin-user',
      method: 'POST',
      path: '/api/profile/access-tokens',
      status: 403,
      ip: '203.0.113.7',
      userAgent: 'relay-openapi-audit-test',
      permission: 'profile.accessTokens.create',
      error: 'Relay login session required.'
    })
    expect(tokenAudit.response.status).toBe(403)
  })

  it('changes the current user password with current password verification', async () => {
    const { args, baseUrl } = await listenRelay()
    const store = createProfileStore()
    store.users[0].passwordHash = await hashPassword('old-password')
    await writeRelayStore(args.dataPath, store)

    const rejected = await requestJson(baseUrl, '/api/profile/password', {
      method: 'POST',
      headers: authHeaders('admin-session-token'),
      body: JSON.stringify({ currentPassword: 'wrong-password', password: 'new-password' })
    })
    const changed = await requestJson(baseUrl, '/api/profile/password', {
      method: 'POST',
      headers: authHeaders('admin-session-token'),
      body: JSON.stringify({ currentPassword: 'old-password', password: 'new-password' })
    })
    const nextStore = await readRelayStore(args.dataPath)

    expect(rejected.response.status).toBe(403)
    expect(rejected.body).toEqual({ error: 'Current password is invalid.' })
    expect(changed.response.status).toBe(200)
    expect(changed.body).toEqual({ password: { enabled: true } })
    expect(await verifyPassword('new-password', nextStore.users[0].passwordHash)).toBe(true)
  })

  it('exposes separated admin and profile OpenAPI documents without requiring auth or leaking tokens', async () => {
    const { baseUrl } = await listenRelay()
    const adminSpec = await requestJson(baseUrl, '/api/admin/openapi.json')
    const profileSpec = await requestJson(baseUrl, '/api/profile/openapi.json')
    const blockedAdminMethod = await requestJson(baseUrl, '/api/admin/openapi.json', {
      method: 'POST'
    })
    const blockedProfileMethod = await requestJson(baseUrl, '/api/profile/openapi.json', {
      method: 'POST'
    })
    const adminDocument = openApiDocument(adminSpec.body)
    const profileDocument = openApiDocument(profileSpec.body)

    expect(adminSpec.response.status).toBe(200)
    expect(adminDocument.openapi).toBe('3.1.0')
    expect(adminDocument.paths).toHaveProperty('/api/admin/users')
    expect(adminDocument.paths).not.toHaveProperty('/api/profile/access-tokens')
    expect(adminDocument.components.schemas).toHaveProperty('RelayAdminUser')
    expect(adminDocument.components.schemas).not.toHaveProperty('RelayProfileAccessToken')
    expect(JSON.stringify(adminSpec.body)).not.toContain('admin-token')
    expect(profileSpec.response.status).toBe(200)
    expect(profileDocument.openapi).toBe('3.1.0')
    expect(profileDocument.paths).toHaveProperty('/api/profile/access-tokens')
    expect(profileDocument.paths).not.toHaveProperty('/api/admin/users')
    expect(profileDocument.components.schemas).toHaveProperty('RelayProfileAccessToken')
    expect(profileDocument.components.schemas).not.toHaveProperty('RelayAdminUser')
    expect(JSON.stringify(profileSpec.body)).not.toContain('admin-token')
    expect(blockedAdminMethod.response.status).toBe(405)
    expect(blockedProfileMethod.response.status).toBe(405)
  })
})
