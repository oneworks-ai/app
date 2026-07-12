/* eslint-disable max-lines -- relay scoped API tests cover account, login, config refresh, and team config sharing routes. */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import { ONEWORKS_AUTH_STORE_VERSION, writeOneWorksAuthStore } from '@oneworks/utils/auth-store'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRelayDeviceStore, createRelayServiceInfoStore } from '../src/server/store.js'
import { createRelayConfigSnapshotStore } from '../src/shared/config-cache.js'
import {
  DEFAULT_OFFICIAL_RELAY_SERVER_ID,
  OFFICIAL_RELAY_CLOUDFLARE_BASE_URL
} from '../src/shared/official-services.js'
import { cleanupPluginFixtures, createPluginHarness, readDeviceStore, stubRelayFetch } from './helpers.js'
import type { RelayPluginStatus } from './helpers.js'

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await cleanupPluginFixtures()
})

const createTestRemoteWorkspaceId = (input: {
  deviceId: string
  serverId: string
  workspaceFolder: string
}) =>
  `w_${
    createHash('sha256')
      .update(input.serverId)
      .update('\0')
      .update(input.deviceId)
      .update('\0')
      .update(input.workspaceFolder)
      .digest('base64url')
      .slice(0, 32)
  }`

describe('relay plugin scoped API', () => {
  it('discovers service avatars without blocking status and deduplicates in-flight requests', async () => {
    let resolveInfo: ((response: Response) => void) | undefined
    const pendingInfo = new Promise<Response>(resolve => {
      resolveInfo = resolve
    })
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).endsWith('/api/relay/info')) return pendingInfo
      return Promise.resolve(new Response('{}', { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const { apis } = await createPluginHarness({
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      servers: [{ baseUrl: 'https://relay.example', id: 'prod' }]
    })
    const handler = apis.get('relay')?.handler
    const statusRequest = handler?.({ body: Buffer.alloc(0), method: 'GET', path: 'status' })
    const statusResult = await Promise.race([
      statusRequest,
      new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 50))
    ])

    expect(statusResult).not.toBe('timeout')
    const firstInfo = handler?.({
      body: Buffer.from(JSON.stringify({ serverId: 'prod' })),
      method: 'POST',
      path: 'server-info'
    })
    const secondInfo = handler?.({
      body: Buffer.from(JSON.stringify({ serverId: 'prod' })),
      method: 'POST',
      path: 'server-info'
    })
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/relay/info'))).toHaveLength(1)

    resolveInfo?.(
      new Response(
        JSON.stringify({
          avatarUrl: 'https://cdn.example.com/relay.png',
          name: 'Relay Cloud'
        }),
        { status: 200 }
      )
    )
    await expect(firstInfo).resolves.toMatchObject({
      body: { avatarUrl: 'https://cdn.example.com/relay.png', name: 'Relay Cloud', online: true },
      status: 200
    })
    await expect(secondInfo).resolves.toMatchObject({
      body: { avatarUrl: 'https://cdn.example.com/relay.png', name: 'Relay Cloud', online: true },
      status: 200
    })
    const refreshedStatus = await handler?.({ body: Buffer.alloc(0), method: 'GET', path: 'status' }) as {
      body?: RelayPluginStatus
    }
    expect(refreshedStatus.body?.servers?.[0]?.avatarUrl).toBe('https://cdn.example.com/relay.png')
    expect(refreshedStatus.body?.servers?.[0]?.name).toBe('Relay Cloud')
    expect(refreshedStatus.body?.servers?.[0]?.online).toBe(true)
    await expect(createRelayServiceInfoStore().readStore()).resolves.toMatchObject({
      'https://relay.example': {
        avatarUrl: 'https://cdn.example.com/relay.png',
        lastSuccessfulAt: expect.any(String),
        name: 'Relay Cloud'
      }
    })
  })

  it('restores the last successful service metadata when the next connection fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Unavailable', { status: 503 }))
    )
    const lastSuccessfulAt = '2026-07-11T08:30:00.000Z'
    const { apis } = await createPluginHarness(
      {
        enableOfficialCloudflareRelay: false,
        enableOfficialVercelRelay: false,
        servers: [{ baseUrl: 'https://relay.example', id: 'prod' }]
      },
      {
        prepareHomeDir: async () => {
          await createRelayServiceInfoStore().writeServiceInfo('https://relay.example', {
            avatarUrl: 'https://cdn.example.com/relay.png',
            lastSuccessfulAt,
            name: 'Relay Cloud'
          })
        }
      }
    )

    const handler = apis.get('relay')?.handler
    const restoredStatus = await handler?.({
      body: Buffer.alloc(0),
      method: 'GET',
      path: 'status'
    }) as { body?: RelayPluginStatus }
    expect(restoredStatus.body?.servers?.[0]).toMatchObject({
      avatarUrl: 'https://cdn.example.com/relay.png',
      lastSuccessfulAt,
      name: 'Relay Cloud'
    })

    await expect(
      handler?.({
        body: Buffer.from(JSON.stringify({ serverId: 'prod' })),
        method: 'POST',
        path: 'server-info'
      })
    ).resolves.toMatchObject({
      body: {
        availabilityError: 'HTTP 503',
        avatarUrl: 'https://cdn.example.com/relay.png',
        lastSuccessfulAt,
        name: 'Relay Cloud',
        online: false
      },
      status: 200
    })
    await expect(createRelayServiceInfoStore().readStore()).resolves.toMatchObject({
      'https://relay.example': {
        avatarUrl: 'https://cdn.example.com/relay.png',
        lastSuccessfulAt,
        name: 'Relay Cloud'
      }
    })
  })

  it('times out service avatar discovery without failing the server list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
      )
    )
    const { apis } = await createPluginHarness({
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      servers: [{ baseUrl: 'https://relay.example', id: 'prod' }]
    })
    const responsePromise = apis.get('relay')?.handler?.({
      body: Buffer.from(JSON.stringify({ serverId: 'prod' })),
      method: 'POST',
      path: 'server-info'
    })

    await expect(responsePromise).resolves.toMatchObject({
      body: { availabilityError: 'timeout', online: false },
      status: 200
    })
  }, 6_000)

  it('keeps a reachable service online when optional avatar metadata is malformed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            avatarUrl: 'not-a-url'
          }),
          { status: 200 }
        )
      )
    )
    const { apis } = await createPluginHarness({
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      servers: [{ baseUrl: 'https://relay.example', id: 'prod' }]
    })

    await expect(
      apis.get('relay')?.handler?.({
        body: Buffer.from(JSON.stringify({ serverId: 'prod' })),
        method: 'POST',
        path: 'server-info'
      })
    ).resolves.toMatchObject({
      body: { online: true },
      status: 200
    })
  })

  it('keeps the last service avatar when a refresh fails', async () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            avatarUrl: 'https://cdn.example.com/relay.png'
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response('Unavailable', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    const { apis } = await createPluginHarness({
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      servers: [{ baseUrl: 'https://relay.example', id: 'prod' }]
    })
    const handler = apis.get('relay')?.handler
    const request = () =>
      handler?.({
        body: Buffer.from(JSON.stringify({ serverId: 'prod' })),
        method: 'POST',
        path: 'server-info'
      })

    await expect(request()).resolves.toMatchObject({
      body: { avatarUrl: 'https://cdn.example.com/relay.png', online: true },
      status: 200
    })
    now += 61_000
    await expect(request()).resolves.toMatchObject({
      body: {
        availabilityError: 'HTTP 503',
        avatarUrl: 'https://cdn.example.com/relay.png',
        online: false
      },
      status: 200
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('registers scoped API metadata for the host runtime', async () => {
    const { apis } = await createPluginHarness({})

    expect(apis.get('relay')).toMatchObject({
      title: {
        en: 'Account scoped API',
        'zh-Hans': '账号作用域 API'
      },
      description: {
        en: expect.stringContaining('Controls relay device status'),
        'zh-Hans': expect.stringContaining('查询认证链接设备状态')
      },
      headerSchema: {
        type: 'object'
      },
      inputSchema: {
        type: 'object'
      },
      outputSchema: {
        type: 'object'
      }
    })
  })

  it('previews multiple relay server options', async () => {
    const { apis } = await createPluginHarness({})

    const response = await apis.get('relay')?.handler?.({
      body: Buffer.from(JSON.stringify({
        activeServerId: 'lab',
        enableOfficialCloudflareRelay: false,
        enableOfficialVercelRelay: false,
        servers: [
          {
            id: 'prod',
            pairingToken: 'prod-token',
            server: 'relay.example.com'
          },
          {
            id: 'lab',
            pairingToken: 'lab-token',
            port: 8788,
            protocol: 'http',
            server: '127.0.0.1'
          }
        ]
      })),
      method: 'POST',
      path: 'options-preview'
    }) as { body?: { options?: RelayPluginStatus['options'] }; status?: number }

    expect(response.status).toBe(200)
    expect(response.body?.options).toMatchObject({
      activeServerId: 'lab',
      servers: [
        {
          id: 'prod',
          pairingTokenConfigured: true,
          remoteBaseUrl: 'https://relay.example.com'
        },
        {
          id: 'lab',
          pairingTokenConfigured: true,
          remoteBaseUrl: 'http://127.0.0.1:8788'
        }
      ]
    })
    expect(JSON.stringify(response.body)).not.toContain('prod-token')
    expect(JSON.stringify(response.body)).not.toContain('lab-token')
  })

  it('creates fixture profile access tokens without calling the remote server', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { apis } = await createPluginHarness({
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false
    })
    await writeOneWorksAuthStore({
      accounts: [{
        accountKey: 'team:owner',
        email: 'owner@team.test',
        enabled: true,
        loginId: 'owner',
        name: 'Owner Team',
        role: 'owner',
        serverId: 'team',
        serverUrl: 'https://relay.team.example.test',
        sessionExpiresAt: '2999-01-01T00:00:00.000Z',
        sessionToken: 'relay-fixture:team:owner',
        userId: 'owner'
      }],
      servers: {
        team: {
          id: 'team',
          name: 'Team Workspace',
          platform: 'cloudflare',
          url: 'https://relay.team.example.test'
        }
      },
      version: ONEWORKS_AUTH_STORE_VERSION
    })

    const response = await apis.get('relay')?.handler?.({
      body: Buffer.from(JSON.stringify({
        accountKey: 'team:owner',
        name: 'Codex UI Test Token',
        permissionGroupMode: 'all',
        scope: 'user'
      })),
      method: 'POST',
      path: 'profile/access-tokens'
    }) as {
      body?: {
        result?: {
          accessToken?: string
          token?: { name?: string; tokenPreview?: string }
        }
        security?: { accessTokens?: Array<{ name?: string }> }
      }
      status?: number
    }

    expect(response.status).toBe(200)
    expect(response.body?.result?.accessToken).toMatch(/^owrt_fixture_/u)
    expect(response.body?.result?.token).toMatchObject({
      name: 'Codex UI Test Token'
    })
    expect(response.body?.result?.token?.tokenPreview).not.toBe(response.body?.result?.accessToken)
    expect(response.body?.security?.accessTokens).toEqual([
      expect.objectContaining({ name: 'Codex UI Test Token' })
    ])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('previews relay team config share drafts without echoing plaintext secrets', async () => {
    const { apis } = await createPluginHarness({})

    const response = await apis.get('relay')?.handler?.({
      body: Buffer.from(JSON.stringify({
        config: {
          modelServices: {
            openai: {
              apiBaseUrl: 'https://api.openai.com/v1',
              apiKey: 'sk-local-secret'
            }
          }
        }
      })),
      method: 'POST',
      path: 'config-share-draft'
    }) as {
      body?: {
        configPatch?: Record<string, unknown>
        secretItems?: Array<Record<string, unknown>>
      }
      status?: number
    }

    expect(response.status).toBe(200)
    expect(response.body?.configPatch).toMatchObject({
      modelServices: {
        openai: {
          apiBaseUrl: 'https://api.openai.com/v1'
        }
      }
    })
    expect(response.body?.secretItems).toEqual([
      expect.objectContaining({
        path: 'modelServices.openai.apiKey',
        ref: 'modelServices.openai.apiKey',
        uploadRequired: true
      })
    ])
    expect(JSON.stringify(response.body)).not.toContain('sk-local-secret')
  })

  it('loads relay team config targets through url-matched global auth accounts', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          headers: { 'content-type': 'application/json' },
          status: 200
        })
      if (url.pathname === '/api/relay/teams') {
        return json({
          teams: [
            {
              id: 'team-1',
              name: 'Relay Team Config UI Smoke',
              role: 'owner',
              slug: 'relay-team-config-ui-smoke'
            }
          ]
        })
      }
      if (url.pathname === '/api/relay/teams/team-1/config-profiles') {
        return json({
          profiles: [
            {
              id: 'profile-1',
              name: 'Shared Codex Defaults',
              status: 'published',
              teamId: 'team-1'
            }
          ]
        })
      }
      return new Response(JSON.stringify({ error: `unexpected ${url.pathname}` }), {
        headers: { 'content-type': 'application/json' },
        status: 404
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { apis } = await createPluginHarness({
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      servers: [
        {
          id: 'local',
          baseUrl: 'http://127.0.0.1:48890'
        }
      ]
    })
    await writeOneWorksAuthStore({
      accounts: [
        {
          accountKey: 'http-127-0-0-1-48890:owner',
          email: 'owner@local.test',
          enabled: true,
          loginId: 'owner',
          name: 'Owner Local',
          role: 'owner',
          serverId: 'http-127-0-0-1-48890',
          serverUrl: 'http://127.0.0.1:48890',
          sessionToken: 'global-session-token',
          userId: 'owner'
        }
      ],
      servers: {
        'http-127-0-0-1-48890': {
          id: 'http-127-0-0-1-48890',
          name: 'Local',
          url: 'http://127.0.0.1:48890'
        }
      },
      version: ONEWORKS_AUTH_STORE_VERSION
    })

    const response = await apis.get('relay')?.handler?.({
      body: Buffer.from(JSON.stringify({
        accountKey: 'http-127-0-0-1-48890:owner',
        serverId: 'local'
      })),
      method: 'POST',
      path: 'config-share-targets'
    }) as {
      body?: {
        profilesByTeamId?: Record<string, unknown[]>
        teams?: Array<{ id?: string; name?: string }>
      }
      status?: number
    }
    const calls = fetchMock.mock.calls.map(([url, init]) => ({
      headers: init?.headers as Record<string, string> | undefined,
      path: new URL(String(url)).pathname
    }))

    expect(response.status).toBe(200)
    expect(response.body?.teams).toMatchObject([
      {
        id: 'team-1',
        name: 'Relay Team Config UI Smoke'
      }
    ])
    expect(response.body?.profilesByTeamId?.['team-1']).toMatchObject([
      {
        id: 'profile-1',
        name: 'Shared Codex Defaults'
      }
    ])
    expect(calls.every(call => call.headers?.authorization === 'Bearer global-session-token')).toBe(true)
  })

  it('publishes relay team config drafts through the user session without leaking secrets', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const requestBody = init?.body == null ? {} : JSON.parse(String(init.body)) as Record<string, unknown>
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          headers: { 'content-type': 'application/json' },
          status: 200
        })
      if (url.pathname === '/api/auth/me') {
        return json({
          session: {
            expiresAt: '2999-01-01T00:00:00.000Z',
            lastSeenAt: '2026-06-15T00:00:00.000Z'
          },
          user: {
            email: 'owner@local.test',
            id: 'owner',
            name: 'Owner Local',
            provider: 'local',
            role: 'owner'
          }
        })
      }
      if (url.pathname === '/api/relay/devices/register') {
        return json({
          deviceToken: 'device-token',
          user: {
            email: 'owner@local.test',
            id: 'owner',
            name: 'Owner Local',
            provider: 'local',
            role: 'owner'
          }
        })
      }
      if (url.pathname === '/api/relay/config-snapshot') {
        return json({ assignments: [], hash: 'empty', version: 'empty' })
      }
      if (url.pathname === '/api/relay/config/global') {
        return json({ personalConfigSnapshot: null })
      }
      if (url.pathname === '/api/relay/devices') {
        return json({ devices: [] })
      }
      if (url.pathname === '/api/relay/teams/team-1/config-secrets') {
        expect(requestBody).toMatchObject({
          name: 'openai apiKey',
          value: 'sk-team-secret'
        })
        return json({
          secret: {
            id: 'secret-1',
            name: requestBody.name,
            revokedAt: null,
            secretVersion: 1,
            teamId: 'team-1'
          }
        })
      }
      if (url.pathname === '/api/relay/teams/team-1/config-profiles') {
        expect(requestBody).toMatchObject({ name: 'Team Share' })
        return json({
          profile: {
            id: 'profile-1',
            name: 'Team Share',
            status: 'draft',
            teamId: 'team-1'
          },
          versions: [],
          assignments: []
        })
      }
      if (url.pathname === '/api/relay/config-profiles/profile-1/versions') {
        expect(JSON.stringify(requestBody)).not.toContain('sk-team-secret')
        expect(requestBody).toMatchObject({
          configPatch: {
            modelServices: {
              openai: {
                apiBaseUrl: 'https://api.openai.com/v1'
              }
            }
          },
          secretRefs: {
            'modelServices.openai.apiKey': 'secret-1'
          }
        })
        return json({
          version: {
            id: 'version-1',
            profileId: 'profile-1',
            version: 1
          }
        })
      }
      if (url.pathname === '/api/relay/config-profiles/profile-1/publish') {
        expect(requestBody).toEqual({ versionId: 'version-1' })
        return json({
          profile: {
            activeVersionId: 'version-1',
            id: 'profile-1',
            name: 'Team Share',
            status: 'published',
            teamId: 'team-1'
          }
        })
      }
      if (url.pathname === '/api/relay/config-profiles/profile-1/assignments') {
        expect(requestBody).toMatchObject({
          target: { teamIds: ['team-1'] },
          versionId: 'version-1'
        })
        return json({
          assignment: {
            id: 'assignment-1',
            profileId: 'profile-1',
            target: { teamIds: ['team-1'] },
            versionId: 'version-1'
          }
        })
      }
      return new Response(JSON.stringify({ error: `unexpected ${url.pathname}` }), {
        headers: { 'content-type': 'application/json' },
        status: 404
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { apis, projectHome } = await createPluginHarness({
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      servers: [
        {
          id: 'prod',
          baseUrl: 'https://relay.example'
        }
      ]
    })

    await apis.get('relay')?.handler?.({
      body: Buffer.from(JSON.stringify({
        serverId: 'prod',
        token: 'sso-session-token'
      })),
      method: 'POST',
      path: 'login-callback'
    })
    const response = await apis.get('relay')?.handler?.({
      body: Buffer.from(JSON.stringify({
        assignToTeam: true,
        config: {
          defaultModelService: 'openai',
          modelServices: {
            openai: {
              apiBaseUrl: 'https://api.openai.com/v1',
              apiKey: 'sk-team-secret'
            }
          }
        },
        profileName: 'Team Share',
        serverId: 'prod',
        teamId: 'team-1'
      })),
      method: 'POST',
      path: 'config-share-publish'
    }) as {
      body?: {
        assignment?: unknown
        draft?: unknown
        secretRefs?: Record<string, string>
      }
      status?: number
    }
    const calls = fetchMock.mock.calls.map(([url, init]) => ({
      body: init?.body == null ? '' : String(init.body),
      headers: init?.headers as Record<string, string> | undefined,
      path: new URL(String(url)).pathname
    }))
    const sharedCalls = calls.filter(call =>
      call.path.includes('config-secrets') ||
      call.path.includes('config-profiles')
    )

    expect(response.status).toBe(200)
    expect(response.body?.secretRefs).toEqual({
      'modelServices.openai.apiKey': 'secret-1'
    })
    expect(response.body?.assignment).toMatchObject({
      assignment: {
        id: 'assignment-1',
        versionId: 'version-1'
      }
    })
    expect(JSON.stringify(response.body)).not.toContain('sk-team-secret')
    expect(sharedCalls.every(call => call.headers?.authorization === 'Bearer sso-session-token')).toBe(true)
    expect(calls.find(call => call.path === '/api/relay/config-snapshot')?.headers?.authorization).toBe(
      'Bearer device-token'
    )
  })

  it('includes Relay configuration distribution status in public status and refresh responses', async () => {
    let refreshed = false
    const { apis } = await createPluginHarness({}, {
      configDistribution: {
        getStatus: () => ({
          allowedFields: ['modelServices'],
          hash: 'sha256:before',
          lastAppliedAt: '2026-06-15T08:05:00.000Z',
          lastError: null,
          lastSyncedAt: '2026-06-15T08:00:00.000Z',
          marketplaceKeys: [],
          matchedProject: true,
          modelServiceKeys: ['openai'],
          pluginKeys: [],
          skillKeys: [],
          skillRegistryKeys: [],
          sourceServerId: 'oneworks-cloudflare',
          version: '2026.06.15-a'
        }),
        refresh: () => {
          refreshed = true
          return {
            allowedFields: ['modelServices', 'models'],
            hash: 'sha256:after',
            lastAppliedAt: '2026-06-15T09:05:00.000Z',
            lastError: null,
            lastSyncedAt: '2026-06-15T09:00:00.000Z',
            marketplaceKeys: [],
            matchedProject: true,
            modelServiceKeys: ['openai', 'anthropic'],
            pluginKeys: [],
            skillKeys: [],
            skillRegistryKeys: [],
            sourceServerId: 'oneworks-cloudflare',
            version: '2026.06.15-b'
          }
        }
      }
    })

    const statusResponse = await apis.get('relay')?.handler?.({
      body: Buffer.alloc(0),
      method: 'GET',
      path: 'status'
    }) as { body?: RelayPluginStatus; status?: number }
    const refreshResponse = await apis.get('relay')?.handler?.({
      body: Buffer.alloc(0),
      method: 'POST',
      path: 'config-refresh'
    }) as { body?: RelayPluginStatus; status?: number }

    expect(statusResponse.status).toBe(200)
    expect(statusResponse.body?.configDistribution).toMatchObject({
      hash: 'sha256:before',
      modelServiceKeys: ['openai'],
      version: '2026.06.15-a'
    })
    expect(refreshResponse.status).toBe(200)
    expect(refreshed).toBe(true)
    expect(refreshResponse.body?.configDistribution).toMatchObject({
      allowedFields: ['modelServices', 'models'],
      hash: 'sha256:after',
      modelServiceKeys: ['openai', 'anthropic'],
      version: '2026.06.15-b'
    })
  })

  it('stores local team config source opt-outs without patching remote assignments', async () => {
    const { apis, projectHome } = await createPluginHarness({
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      servers: [
        {
          id: 'prod',
          baseUrl: 'https://relay.example'
        }
      ]
    })
    await createRelayConfigSnapshotStore(projectHome).writeSnapshot({
      assignments: [
        {
          id: 'assignment-1',
          allowedFields: ['modelServices'],
          configPatch: {
            modelServices: {
              relay: {
                apiBaseUrl: 'https://relay.example/v1'
              }
            }
          },
          provenance: {
            assignmentId: 'assignment-1',
            fields: ['modelServices'],
            mode: 'default',
            profileId: 'profile-1',
            profileName: 'Base Profile',
            teamId: 'team-1',
            teamName: 'Team One',
            version: 1,
            versionId: 'version-1'
          }
        }
      ],
      hash: 'sha256:source',
      lastError: null,
      lastSyncedAt: '2026-06-15T00:00:00.000Z',
      sourceServerId: 'prod',
      version: 'v-source'
    })

    const disableResponse = await apis.get('relay')?.handler?.({
      body: Buffer.from(JSON.stringify({
        enabled: false,
        id: 'profile-1',
        kind: 'profile',
        serverId: 'prod'
      })),
      method: 'POST',
      path: 'config-source-enabled'
    }) as { body?: RelayPluginStatus; status?: number }
    const store = await readDeviceStore(projectHome)

    expect(disableResponse.status).toBe(200)
    expect(disableResponse.body?.configDistribution?.modelServiceKeys).toEqual([])
    expect(disableResponse.body?.configDistribution?.sources).toEqual([
      expect.objectContaining({
        disabledBy: ['profile'],
        enabled: false,
        profileId: 'profile-1',
        teamId: 'team-1'
      })
    ])
    expect(store.servers).toMatchObject({
      prod: {
        configDisabledSources: {
          profileIds: ['profile-1']
        }
      }
    })
  })

  it('forgets the stored remote device token', async () => {
    stubRelayFetch()

    const { apis, commands, projectHome } = await createPluginHarness({
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      servers: [
        {
          id: 'prod',
          pairingToken: 'pair-token',
          baseUrl: 'https://relay.example'
        }
      ]
    })

    await commands.get('connect')?.()
    const forgetResponse = await apis.get('relay')?.handler?.({
      body: Buffer.alloc(0),
      method: 'POST',
      path: 'forget'
    }) as { body?: RelayPluginStatus; status?: number }
    const store = await readDeviceStore(projectHome)

    expect(forgetResponse.status).toBe(200)
    expect(forgetResponse.body?.connection.state).toBe('idle')
    expect(forgetResponse.body?.device.hasToken).toBe(false)
    expect(store).not.toHaveProperty('deviceToken')
    expect(store.servers).toMatchObject({
      prod: {
        deviceToken: ''
      }
    })
  })

  it('creates relay login URLs for a selected remote server', async () => {
    const { apis } = await createPluginHarness({
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      servers: [
        {
          id: 'prod',
          baseUrl: 'https://relay.example'
        }
      ]
    })

    const response = await apis.get('relay')?.handler?.({
      body: Buffer.from(JSON.stringify({
        redirectUri: 'https://app.example/plugins/relay/home?relayLogin=1',
        serverId: 'prod'
      })),
      method: 'POST',
      path: 'login-url'
    }) as { body?: { loginUrl?: string; redirectUri?: string; serverId?: string }; status?: number }
    const loginUrl = new URL(String(response.body?.loginUrl))

    expect(response.status).toBe(200)
    expect(response.body?.serverId).toBe('prod')
    expect(response.body?.redirectUri).toBe('https://app.example/plugins/relay/home?relayLogin=1')
    expect(loginUrl.origin).toBe('https://relay.example')
    expect(loginUrl.pathname).toBe('/login')
    expect(loginUrl.searchParams.get('server_id')).toBe('prod')
    expect(loginUrl.searchParams.get('scope')).toBe('relay')
    expect(loginUrl.searchParams.get('redirect_uri')).toBe('https://app.example/plugins/relay/home?relayLogin=1')
  })

  it('proxies native login only to fixed paths on configured Relay servers', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/auth/login-options') {
        expect(url.origin).toBe('https://relay.example')
        expect(url.searchParams.get('redirect_uri')).toBe(
          'oneworks://relay/auth?workspace=%2Fworkspace&scope=relay&serverId=prod'
        )
        expect(url.searchParams.get('server_id')).toBe('prod')
        return new Response(JSON.stringify({ loginMethods: { default: 'password', enabled: ['password'] } }), {
          headers: { 'content-type': 'application/json' }
        })
      }
      expect(url.toString()).toBe('https://relay.example/api/auth/password-login')
      expect(init?.method).toBe('POST')
      expect(JSON.parse(String(init?.body))).toEqual({ loginId: 'owner', password: 'wrong' })
      return new Response(
        JSON.stringify({
          code: 'registration_required',
          error: 'Registration requires an invite.'
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 409
        }
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const { apis } = await createPluginHarness({
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      servers: [{ baseUrl: 'https://relay.example', id: 'prod' }]
    })
    const handler = apis.get('relay')?.handler

    const optionsResponse = await handler?.({
      body: Buffer.from(JSON.stringify({ serverId: 'prod' })),
      method: 'POST',
      path: 'login-options'
    }) as { body?: { options?: { loginMethods?: unknown } }; status?: number }
    const passwordResponse = await handler?.({
      body: Buffer.from(JSON.stringify({
        action: 'password-login',
        body: { loginId: 'owner', password: 'wrong' },
        serverId: 'prod'
      })),
      method: 'POST',
      path: 'native-login'
    }) as { body?: { code?: string; error?: string }; status?: number }

    expect(optionsResponse.status).toBe(200)
    expect(optionsResponse.body?.options?.loginMethods).toEqual({ default: 'password', enabled: ['password'] })
    expect(passwordResponse).toMatchObject({
      body: {
        code: 'registration_required',
        error: 'Registration requires an invite.'
      },
      status: 409
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects arbitrary native login actions and unconfigured server URLs without fetching them', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { apis } = await createPluginHarness({
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      servers: [{ baseUrl: 'https://relay.example', id: 'prod' }]
    })
    const handler = apis.get('relay')?.handler
    const request = async (body: Record<string, unknown>) =>
      await handler?.({
        body: Buffer.from(JSON.stringify(body)),
        method: 'POST',
        path: 'native-login'
      }) as { body?: { error?: string }; status?: number }

    expect(await request({ action: 'arbitrary-path', body: {}, serverId: 'prod' })).toMatchObject({
      status: 400
    })
    expect(
      await request({
        action: 'password-login',
        body: {},
        serverId: 'https://attacker.example'
      })
    ).toMatchObject({
      status: 404
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns manager login callbacks to the Launcher instead of opening the manager directory', async () => {
    const { apis } = await createPluginHarness({
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      servers: [{ baseUrl: 'https://relay.example', id: 'prod' }]
    }, {
      runtimeRole: 'manager',
      workspaceFolder: '/manager-home'
    })

    const response = await apis.get('relay')?.handler?.({
      body: Buffer.from(JSON.stringify({ serverId: 'prod' })),
      method: 'POST',
      path: 'login-url'
    }) as { body?: { redirectUri?: string }; status?: number }
    const redirectUri = new URL(String(response.body?.redirectUri))

    expect(response.status).toBe(200)
    expect(redirectUri.protocol).toBe('oneworks:')
    expect(redirectUri.hostname).toBe('relay')
    expect(redirectUri.pathname).toBe('/auth')
    expect(redirectUri.searchParams.get('launcher')).toBe('1')
    expect(redirectUri.searchParams.get('workspace')).toBeNull()
    expect(redirectUri.searchParams.get('serverId')).toBe('prod')
  })

  it('creates relay login URLs for the default official Cloudflare service', async () => {
    const { apis } = await createPluginHarness({})

    const response = await apis.get('relay')?.handler?.({
      body: Buffer.from(JSON.stringify({
        redirectUri:
          `https://app.example/plugins/relay/home?relayLogin=1&relayLoginServerId=${DEFAULT_OFFICIAL_RELAY_SERVER_ID}`
      })),
      method: 'POST',
      path: 'login-url'
    }) as { body?: { loginUrl?: string; redirectUri?: string; serverId?: string }; status?: number }
    const loginUrl = new URL(String(response.body?.loginUrl))

    expect(response.status).toBe(200)
    expect(response.body?.serverId).toBe(DEFAULT_OFFICIAL_RELAY_SERVER_ID)
    expect(response.body?.redirectUri).toBe(
      `https://app.example/plugins/relay/home?relayLogin=1&relayLoginServerId=${DEFAULT_OFFICIAL_RELAY_SERVER_ID}`
    )
    expect(loginUrl.origin).toBe(new URL(OFFICIAL_RELAY_CLOUDFLARE_BASE_URL).origin)
    expect(loginUrl.pathname).toBe('/login')
    expect(loginUrl.searchParams.get('server_id')).toBe(DEFAULT_OFFICIAL_RELAY_SERVER_ID)
  })

  it('does not reopen remote workspace proxies for offline devices', async () => {
    const workspaceFolder = '/workspaces/offline-app'
    const workspaceId = createTestRemoteWorkspaceId({
      deviceId: 'remote-device',
      serverId: 'prod',
      workspaceFolder
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://relay.example/api/relay/devices') {
        return new Response(
          JSON.stringify({
            devices: [{
              capabilities: { sessions: true, workspaceLauncher: true },
              id: 'remote-device',
              name: 'Linux Docker Smoke',
              status: 'offline',
              workspaceFolder
            }]
          }),
          {
            headers: { 'content-type': 'application/json' },
            status: 200
          }
        )
      }
      return new Response(JSON.stringify({}), {
        headers: { 'content-type': 'application/json' },
        status: 200
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { apis } = await createPluginHarness(
      {
        enableOfficialCloudflareRelay: false,
        enableOfficialVercelRelay: false,
        servers: [
          {
            id: 'prod',
            baseUrl: 'https://relay.example'
          }
        ]
      },
      {
        prepareProjectHome: async projectHome => {
          await createRelayDeviceStore(projectHome).writeStore({
            deviceId: 'local-device',
            deviceName: 'Local Device',
            deviceSecret: 'local-device-secret',
            servers: {
              prod: {
                deviceToken: 'local-device-token',
                id: 'prod',
                registeredAt: '2026-06-15T00:00:00.000Z',
                remoteBaseUrl: 'https://relay.example',
                updatedAt: '2026-06-15T00:00:00.000Z'
              }
            }
          })
        }
      }
    )

    const response = await apis.get('relay')?.handler?.({
      body: Buffer.alloc(0),
      method: 'GET',
      path: `workspaces/${encodeURIComponent(workspaceId)}/connection`
    }) as { body?: { error?: string }; status?: number }

    expect(response.status).toBe(404)
    expect(response.body?.error).toBe('Workspace not found.')
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain(
      'https://relay.example/api/relay/devices/remote-device/workspace/requests'
    )
  })

  it('lists devices for relay servers stored only in the auth store', async () => {
    const relayBaseUrl = 'http://127.0.0.1:48991'
    const workspaceFolder = '/workspaces/linux-remote-a'
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
        status: 200
      })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const authorization = String((init?.headers as Record<string, string> | undefined)?.authorization ?? '')
      if (url.origin === relayBaseUrl && url.pathname === '/api/relay/devices') {
        expect(authorization).toBe('Bearer account-session-token')
        return json({
          devices: [{
            alias: 'Linux Docker Smoke',
            capabilities: { sessions: true, workspaceLauncher: true },
            id: 'docker-device',
            lastSeenAt: '2026-06-29T08:00:00.000Z',
            name: 'linux-remote-a',
            status: 'online',
            workspaceFolder
          }]
        })
      }
      return new Response(JSON.stringify({ error: `Unexpected relay request: ${url.toString()}` }), {
        headers: { 'content-type': 'application/json' },
        status: 404
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { apis } = await createPluginHarness({
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      servers: [
        {
          id: 'local',
          baseUrl: 'http://127.0.0.1:48890'
        }
      ]
    })
    await writeOneWorksAuthStore({
      accounts: [{
        accountKey: 'http-127-0-0-1-48991:docker',
        email: 'docker-smoke@local.test',
        enabled: true,
        loginId: 'docker',
        name: 'Docker Smoke',
        role: 'owner',
        serverId: 'http-127-0-0-1-48991',
        serverUrl: relayBaseUrl,
        sessionExpiresAt: '2999-01-01T00:00:00.000Z',
        sessionToken: 'account-session-token',
        userId: 'docker'
      }],
      servers: {
        'http-127-0-0-1-48991': {
          id: 'http-127-0-0-1-48991',
          name: 'Docker Local',
          url: relayBaseUrl
        }
      },
      version: ONEWORKS_AUTH_STORE_VERSION
    })

    const response = await apis.get('relay')?.handler?.({
      body: Buffer.alloc(0),
      method: 'GET',
      path: 'status'
    }) as { body?: RelayPluginStatus; status?: number }
    const authStoreOnlyServer = response.body?.servers?.find(server => server.id === 'http-127-0-0-1-48991')

    expect(response.status).toBe(200)
    expect(authStoreOnlyServer).toMatchObject({
      account: {
        email: 'docker-smoke@local.test',
        name: 'Docker Smoke'
      },
      devices: [
        expect.objectContaining({
          id: 'docker-device',
          status: 'online',
          workspaceFolder
        })
      ],
      id: 'http-127-0-0-1-48991',
      name: 'Docker Local',
      remoteBaseUrl: relayBaseUrl,
      sessionAuthenticated: true
    })
    expect(fetchMock.mock.calls).toEqual(expect.arrayContaining([
      expect.arrayContaining([
        expect.objectContaining({
          href: `${relayBaseUrl}/api/relay/devices`
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            authorization: 'Bearer account-session-token'
          })
        })
      ])
    ]))
  })

  it('opens remote workspaces through the account session that sees the online device', async () => {
    const relayBaseUrl = 'http://127.0.0.1:48890'
    const workspaceFolder = '/workspaces/linux-remote-a'
    const requests: Array<{ authorization: string; path: string }> = []
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
        status: 200
      })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const authorization = String((init?.headers as Record<string, string> | undefined)?.authorization ?? '')
      requests.push({ authorization, path: url.pathname })
      if (url.pathname === '/api/relay/devices') {
        if (authorization === 'Bearer account-session-token') {
          return json({
            devices: [{
              alias: 'Linux Docker Smoke',
              capabilities: { sessions: true, workspaceLauncher: true },
              id: 'docker-device',
              lastSeenIp: '198.51.100.25',
              lastSeenAt: '2026-06-29T08:00:00.000Z',
              managementServers: [{
                id: 'daemon-main',
                kind: 'daemon',
                lastSeenIp: '198.51.100.25',
                name: 'Daemon Service',
                projects: [{
                  id: 'project-linux-remote-a',
                  status: 'online',
                  title: 'linux-remote-a',
                  workspaceFolder
                }],
                registeredIp: '203.0.113.10',
                status: 'online',
                workspaceFolder
              }],
              name: 'linux-remote-a',
              registeredIp: '203.0.113.10',
              status: 'online',
              workspaceFolder
            }]
          })
        }
        return json({
          devices: [{
            capabilities: { sessions: true, workspaceLauncher: true },
            id: 'stale-device',
            lastSeenAt: '2026-06-20T08:00:00.000Z',
            name: 'Linux Docker Smoke',
            status: 'offline',
            workspaceFolder
          }]
        })
      }
      if (url.pathname === '/api/relay/devices/docker-device/workspace/requests') {
        return json({ job: { id: 'open-workspace-job' } })
      }
      if (url.pathname === '/api/relay/session-jobs/open-workspace-job') {
        return json({ job: { id: 'open-workspace-job', status: 'succeeded' } })
      }
      if (url.pathname === '/api/relay/session-jobs/open-workspace-job/result') {
        return json({
          result: {
            bodyBase64: Buffer.from(JSON.stringify({
              serverBaseUrl: 'http://127.0.0.1:19000',
              workspaceFolder
            })).toString('base64'),
            status: 200
          }
        })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)
    const { apis } = await createPluginHarness(
      {
        activeServerId: 'local',
        enableOfficialCloudflareRelay: false,
        enableOfficialVercelRelay: false,
        servers: [
          {
            id: 'local',
            baseUrl: relayBaseUrl
          }
        ]
      },
      {
        prepareProjectHome: async projectHome => {
          await createRelayDeviceStore(projectHome).writeStore({
            deviceId: 'host-device',
            deviceName: 'Host Device',
            deviceSecret: 'host-device-secret',
            servers: {
              local: {
                deviceToken: 'stale-device-token',
                id: 'local',
                registeredAt: '2026-06-15T00:00:00.000Z',
                remoteBaseUrl: relayBaseUrl,
                sessionToken: 'stale-session-token',
                updatedAt: '2026-06-15T00:00:00.000Z'
              }
            }
          })
        }
      }
    )
    await writeOneWorksAuthStore({
      accounts: [{
        accountKey: 'http-127-0-0-1-48890:docker',
        email: 'docker-smoke@local.test',
        enabled: true,
        loginId: 'docker',
        name: 'Docker Smoke',
        role: 'owner',
        serverId: 'http-127-0-0-1-48890',
        serverUrl: relayBaseUrl,
        sessionExpiresAt: '2999-01-01T00:00:00.000Z',
        sessionToken: 'account-session-token',
        userId: 'docker'
      }],
      servers: {
        'http-127-0-0-1-48890': {
          id: 'http-127-0-0-1-48890',
          name: 'Local Alias',
          url: relayBaseUrl
        }
      },
      version: ONEWORKS_AUTH_STORE_VERSION
    })

    const statusResponse = await apis.get('relay')?.handler?.({
      body: Buffer.alloc(0),
      method: 'GET',
      path: 'status'
    }) as { body?: RelayPluginStatus; status?: number }
    const openResponse = await apis.get('relay')?.handler?.({
      body: Buffer.from(JSON.stringify({
        deviceId: 'docker-device',
        serverId: 'local',
        workspaceFolder
      })),
      method: 'POST',
      path: 'workspaces/open'
    }) as { body?: { workspaceId?: string }; status?: number }
    const workspaceRequest = requests.find(request =>
      request.path === '/api/relay/devices/docker-device/workspace/requests'
    )

    expect(statusResponse.status).toBe(200)
    expect(statusResponse.body?.servers?.find(server => server.id === 'local')?.devices).toEqual([
      expect.objectContaining({
        id: 'stale-device',
        status: 'offline'
      }),
      expect.objectContaining({
        id: 'docker-device',
        lastSeenIp: '198.51.100.25',
        managementServers: [
          expect.objectContaining({
            id: 'daemon-main',
            lastSeenIp: '198.51.100.25',
            projects: [
              expect.objectContaining({
                id: 'project-linux-remote-a',
                workspaceFolder
              })
            ],
            registeredIp: '203.0.113.10'
          })
        ],
        registeredIp: '203.0.113.10',
        status: 'online'
      })
    ])
    expect(openResponse.status).toBe(200)
    expect(openResponse.body?.workspaceId).toBe(createTestRemoteWorkspaceId({
      deviceId: 'docker-device',
      serverId: 'local',
      workspaceFolder
    }))
    expect(workspaceRequest).toMatchObject({
      authorization: 'Bearer account-session-token'
    })
    expect(requests.find(request => request.path === '/api/relay/devices/stale-device/workspace/requests'))
      .toBeUndefined()
  })

  it('uses login callback tokens to register the current device', async () => {
    const fetchMock = stubRelayFetch('callback-device-token')
    const { apis, projectHome } = await createPluginHarness({
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      servers: [
        {
          id: 'prod',
          baseUrl: 'https://relay.example'
        }
      ]
    })

    const response = await apis.get('relay')?.handler?.({
      body: Buffer.from(JSON.stringify({
        serverId: 'prod',
        token: 'sso-session-token'
      })),
      method: 'POST',
      path: 'login-callback'
    }) as { body?: RelayPluginStatus; status?: number }
    const profileResponse = await apis.get('relay')?.handler?.({
      body: Buffer.from(JSON.stringify({
        accountKey: 'prod:owner'
      })),
      method: 'POST',
      path: 'profile'
    }) as { body?: Record<string, unknown>; status?: number }
    const store = await readDeviceStore(projectHome)
    const authMeInit = fetchMock.mock.calls.find(([url]) => String(url) === 'https://relay.example/api/auth/me')
      ?.[1] as RequestInit | undefined
    const registerInit = fetchMock.mock.calls.find(([url]) =>
      String(url) === 'https://relay.example/api/relay/devices/register'
    )?.[1] as RequestInit | undefined
    const profileSecurityInit = fetchMock.mock.calls.find(([url]) =>
      String(url) === 'https://relay.example/api/profile/security'
    )?.[1] as RequestInit | undefined
    const profileMessagesInit = fetchMock.mock.calls.find(([url]) =>
      String(url) === 'https://relay.example/api/admin/messages'
    )?.[1] as RequestInit | undefined

    expect(response.status).toBe(200)
    expect(profileResponse.status).toBe(200)
    expect(response.body?.connection.state).toBe('registered')
    expect(profileResponse.body?.user).toMatchObject({
      email: 'owner@local.test',
      id: 'owner',
      name: 'Owner Local'
    })
    expect(authMeInit?.headers).toMatchObject({
      authorization: 'Bearer sso-session-token'
    })
    expect(registerInit?.headers).toMatchObject({
      authorization: 'Bearer sso-session-token'
    })
    expect(profileSecurityInit?.headers).toMatchObject({
      authorization: 'Bearer sso-session-token'
    })
    expect(profileMessagesInit?.headers).toMatchObject({
      authorization: 'Bearer sso-session-token'
    })
    expect(profileResponse.body?.messages).toEqual([
      expect.objectContaining({
        id: 'message-1',
        metadata: {
          login: {
            ip: '203.0.113.10',
            location: 'Shanghai CN',
            userAgent: 'Vitest Browser'
          }
        },
        title: '新设备登录提醒'
      })
    ])
    expect(profileResponse.body?.invitations).toEqual([
      expect.objectContaining({
        id: 'invite-1',
        teamName: 'Relay Demo Team'
      })
    ])
    expect(JSON.stringify(profileResponse.body)).not.toContain('sso-session-token')
    expect(response.body?.servers?.[0]).toMatchObject({
      sessionAuthenticated: true,
      sessionExpiresAt: '2999-01-01T00:00:00.000Z'
    })
    expect(store.servers).toMatchObject({
      prod: {
        deviceToken: 'callback-device-token',
        sessionExpiresAt: '2999-01-01T00:00:00.000Z',
        sessionToken: 'sso-session-token'
      }
    })
  })

  it('degrades the profile route to local account data when the remote profile is unreachable', async () => {
    let deviceListCalls = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://relay.example/api/relay/devices') {
        deviceListCalls += 1
        if (deviceListCalls === 1) {
          return new Response(
            JSON.stringify({
              devices: [{
                id: 'cached-device',
                lastSeenAt: '2026-06-15T00:00:00.000Z',
                name: 'Cached Device',
                status: 'online',
                workspaceFolder: '/workspace'
              }]
            }),
            {
              headers: { 'content-type': 'application/json' },
              status: 200
            }
          )
        }
        throw new TypeError('fetch failed')
      }
      if (url === 'https://relay.example/api/auth/me') {
        throw new TypeError('fetch failed')
      }
      return new Response(JSON.stringify({ error: `unexpected ${url}` }), {
        headers: { 'content-type': 'application/json' },
        status: 500
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { apis, commands } = await createPluginHarness({
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      servers: [
        {
          id: 'prod',
          baseUrl: 'https://relay.example'
        }
      ]
    })
    await writeOneWorksAuthStore({
      accounts: [{
        accountKey: 'prod:owner',
        email: 'owner@local.test',
        enabled: true,
        loginId: 'owner',
        name: 'Owner Local',
        role: 'owner',
        serverId: 'prod',
        serverUrl: 'https://relay.example',
        sessionExpiresAt: '2999-01-01T00:00:00.000Z',
        sessionToken: 'session-token',
        userId: 'owner'
      }],
      servers: {
        prod: {
          id: 'prod',
          name: 'Production',
          url: 'https://relay.example'
        }
      },
      version: ONEWORKS_AUTH_STORE_VERSION
    })
    await commands.get('status')?.()

    const response = await apis.get('relay')?.handler?.({
      body: Buffer.from(JSON.stringify({ accountKey: 'prod:owner' })),
      method: 'POST',
      path: 'profile'
    }) as {
      body?: {
        auditEvents?: unknown[]
        devices?: Array<Record<string, unknown>>
        errors?: Record<string, string>
        invitations?: unknown[]
        messages?: unknown[]
        ok?: boolean
        security?: { accessTokens?: unknown[] }
        teams?: unknown[]
        user?: Record<string, unknown>
      }
      status?: number
    }

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      auditEvents: [],
      errors: {
        profile: 'fetch failed'
      },
      invitations: [],
      messages: [],
      ok: true,
      security: {
        accessTokens: []
      },
      teams: [],
      user: {
        email: 'owner@local.test',
        id: 'owner',
        name: 'Owner Local',
        role: 'owner'
      }
    })
    expect(response.body?.devices).toMatchObject([
      {
        id: 'cached-device',
        name: 'Cached Device',
        status: 'online'
      }
    ])
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === 'https://relay.example/api/relay/devices'))
      .toHaveLength(1)
  })

  it('passes disconnect request bodies through to the selected relay server', async () => {
    stubRelayFetch()
    const { apis, commands } = await createPluginHarness({
      activeServerId: 'lab',
      servers: [
        {
          id: 'lab',
          pairingToken: 'lab-token',
          port: 8788,
          protocol: 'http',
          server: '127.0.0.1'
        },
        {
          id: 'prod',
          pairingToken: 'prod-token',
          baseUrl: 'https://relay.example'
        }
      ]
    })

    await commands.get('connect')?.()
    await commands.get('connect')?.({ serverId: 'prod' })
    const response = await apis.get('relay')?.handler?.({
      body: Buffer.from(JSON.stringify({ serverId: 'prod' })),
      method: 'POST',
      path: 'disconnect'
    }) as { body?: RelayPluginStatus; status?: number }

    expect(response.status).toBe(200)
    expect(response.body?.servers?.find(server => server.id === 'lab')).toMatchObject({
      connected: true,
      connection: {
        state: 'registered'
      }
    })
    expect(response.body?.servers?.find(server => server.id === 'prod')).toMatchObject({
      connected: false,
      connection: {
        state: 'idle'
      }
    })
  })
})
