/* eslint-disable max-lines -- relay scoped API tests cover account, login, config refresh, and team config sharing routes. */
import { Buffer } from 'node:buffer'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRelayConfigSnapshotStore } from '../src/shared/config-cache.js'
import {
  DEFAULT_OFFICIAL_RELAY_SERVER_ID,
  OFFICIAL_RELAY_CLOUDFLARE_BASE_URL
} from '../src/shared/official-services.js'
import { cleanupPluginFixtures, createPluginHarness, readDeviceStore, stubRelayFetch } from './helpers.js'
import type { RelayPluginStatus } from './helpers.js'

afterEach(cleanupPluginFixtures)

describe('relay plugin scoped API', () => {
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
            defaultModelService: 'openai',
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
    const store = await readDeviceStore(projectHome)
    const authMeInit = fetchMock.mock.calls.find(([url]) => String(url) === 'https://relay.example/api/auth/me')
      ?.[1] as RequestInit | undefined
    const registerInit = fetchMock.mock.calls.find(([url]) =>
      String(url) === 'https://relay.example/api/relay/devices/register'
    )?.[1] as RequestInit | undefined

    expect(response.status).toBe(200)
    expect(response.body?.connection.state).toBe('registered')
    expect(authMeInit?.headers).toMatchObject({
      authorization: 'Bearer sso-session-token'
    })
    expect(registerInit?.headers).toMatchObject({
      authorization: 'Bearer sso-session-token'
    })
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
