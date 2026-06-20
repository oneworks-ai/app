import { afterEach, describe, expect, it } from 'vitest'

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
      '/api/admin/config-assignments/{assignmentId}',
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
      '/api/admin/teams/{teamId}/archive',
      '/api/admin/teams/{teamId}/audit-events',
      '/api/admin/teams/{teamId}/config-profiles',
      '/api/admin/teams/{teamId}/config-secrets',
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
      '/api/profile/openapi-audit',
      '/api/profile/openapi.json',
      '/api/profile/passkeys/register/options',
      '/api/profile/passkeys/register/verify',
      '/api/profile/password',
      '/api/profile/security',
      '/api/relay/config-assignments/{assignmentId}',
      '/api/relay/config-profiles/{profileId}',
      '/api/relay/config-profiles/{profileId}/assignments',
      '/api/relay/config-profiles/{profileId}/publish',
      '/api/relay/config-profiles/{profileId}/versions',
      '/api/relay/config-secrets/{secretId}',
      '/api/relay/config-secrets/{secretId}/revoke',
      '/api/relay/config-secrets/{secretId}/rotate',
      '/api/relay/config-snapshot',
      '/api/relay/info',
      '/api/relay/team-policy',
      '/api/relay/teams',
      '/api/relay/teams/{teamId}',
      '/api/relay/teams/{teamId}/archive',
      '/api/relay/teams/{teamId}/audit-events',
      '/api/relay/teams/{teamId}/config-profiles',
      '/api/relay/teams/{teamId}/config-secrets',
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

  it('creates system access tokens without storing the full token and authorizes admin APIs', async () => {
    const { args, baseUrl } = await listenRelay()
    await writeRelayStore(args.dataPath, createProfileStore())

    const created = await requestJson(baseUrl, '/api/profile/access-tokens', {
      method: 'POST',
      headers: authHeaders('admin-session-token'),
      body: JSON.stringify({ name: 'Codex OpenAPI' })
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

  it('records and filters system access token OpenAPI audit events', async () => {
    const { args, baseUrl } = await listenRelay()
    await writeRelayStore(args.dataPath, createProfileStore())

    const created = await requestJson(baseUrl, '/api/profile/access-tokens', {
      method: 'POST',
      headers: authHeaders('admin-session-token'),
      body: JSON.stringify({ name: 'Audit Key' })
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
