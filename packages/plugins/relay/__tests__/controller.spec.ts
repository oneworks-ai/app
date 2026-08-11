/* eslint-disable max-lines -- relay controller coverage keeps account, config, and document sync scenarios together. */
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SharedAgentRoomDirectoryEntry } from '@oneworks/types'
import { ONEWORKS_AUTH_STORE_VERSION, readOneWorksAuthStore, writeOneWorksAuthStore } from '@oneworks/utils/auth-store'

import { createRelayDeviceStore } from '../src/server/store.js'
import { createRelayConfigSnapshotStore } from '../src/shared/config-cache.js'
import {
  cleanupPluginFixtures,
  createPluginHarness,
  createRelayConfigSnapshotFixture,
  readConfigSnapshot,
  readDeviceStore,
  stubRelayFetch
} from './helpers.js'
import type { RelayPluginStatus } from './helpers.js'

afterEach(async () => {
  vi.useRealTimers()
  await cleanupPluginFixtures()
})

const flushAsyncWork = async () => {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve()
  }
}

describe('relay plugin controller', () => {
  it('qualifies Room tunnel ownership and live requests with the Relay server id', async () => {
    stubRelayFetch('remote-device-token', {
      deviceTransport: {
        apiBaseUrl: 'http://127.0.0.1:1/',
        controlWebSocketUrl: 'ws://127.0.0.1:1/api/relay/devices/control',
        version: 1
      }
    })
    const registerTunnel = vi.fn()
    const handleRequest = vi.fn(async () => ({ handled: true }))
    const { commands, disposers } = await createPluginHarness(
      {
        autoConnect: false,
        enableOfficialCloudflareRelay: false,
        enableOfficialVercelRelay: false,
        servers: [{ baseUrl: 'https://relay.example/', id: 'prod', pairingToken: 'pair-token' }]
      },
      { roomTunnel: { handleRequest, registerTunnel } }
    )

    await commands.get('connect')?.()
    const ownerSourceId = registerTunnel.mock.calls[0]?.[1]?.ownerSourceId
    expect(registerTunnel).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ownerSourceId: expect.stringMatching(/^relay:[a-f0-9]{64}$/u),
        ownerUserId: 'owner'
      })
    )

    const tunnel = registerTunnel.mock.calls[0]?.[0]
    const frames: string[] = []
    tunnel.setTransport((frame: string) => frames.push(frame))
    tunnel.handleFrame({
      action: 'view',
      operationId: 'operation-1',
      principal: { id: 'viewer', type: 'user' },
      requestId: 'request-1',
      shareId: 'share-1',
      type: 'room-request'
    })
    await flushAsyncWork()

    expect(handleRequest).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'request-1' }), ownerSourceId)
    expect(frames).toContainEqual(expect.stringContaining('"type":"room-response"'))
    disposers.forEach(dispose => dispose())
  })

  it('keeps the relay device identity in the user-level store across project homes', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'oneworks-relay-plugin-home-'))
    const firstProjectHome = await mkdtemp(join(tmpdir(), 'oneworks-relay-plugin-project-a-'))
    const secondProjectHome = await mkdtemp(join(tmpdir(), 'oneworks-relay-plugin-project-b-'))
    try {
      vi.stubEnv('HOME', homeDir)
      vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', homeDir)

      const firstStore = createRelayDeviceStore(firstProjectHome)
      const secondStore = createRelayDeviceStore(secondProjectHome)
      const first = await firstStore.readStore()
      await firstStore.writeStore({
        ...first,
        deviceName: 'System User Device'
      })
      const second = await secondStore.readStore()

      expect(second.deviceId).toBe(first.deviceId)
      expect(second.deviceSecret).toBe(first.deviceSecret)
      expect(second.deviceName).toBe('System User Device')
      expect(firstStore.storePath).toBe(join(homeDir, '.oneworks', 'relay', 'device.json'))
      expect(secondStore.storePath).toBe(firstStore.storePath)
      expect(firstStore.storePath).not.toContain(firstProjectHome)
      expect(secondStore.storePath).not.toContain(secondProjectHome)
    } finally {
      await Promise.all([
        rm(homeDir, { force: true, recursive: true }),
        rm(firstProjectHome, { force: true, recursive: true }),
        rm(secondProjectHome, { force: true, recursive: true })
      ])
    }
  })

  it('uses discovered device transport without moving public APIs or persisting the transport', async () => {
    const fetchMock = stubRelayFetch('remote-device-token', {
      deviceTransport: {
        apiBaseUrl: 'http://127.0.0.1:1/',
        controlWebSocketUrl: 'ws://127.0.0.1:1/api/relay/devices/control',
        version: 1
      }
    })
    const { commands, homeDir, projectHome } = await createPluginHarness({
      deviceName: 'Office Mac',
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      exposeSessions: true,
      exposeTerminal: false,
      exposeWorkspaceFiles: false,
      servers: [
        {
          id: 'prod',
          pairingToken: 'pair-token',
          baseUrl: 'https://relay.example/'
        }
      ]
    })

    const status = await commands.get('connect')?.() as RelayPluginStatus
    const [, init] = fetchMock.mock.calls.find(([url]) => (
      String(url) === 'http://127.0.0.1:1/api/relay/devices/register'
    )) ?? []
    const requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    const store = await readDeviceStore(projectHome)
    const snapshot = await readConfigSnapshot(projectHome)

    expect(status.connection.state).toBe('registered')
    expect(status.device.hasToken).toBe(true)
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://relay.example/api/relay/info')
    expect(fetchMock.mock.calls.some(([url]) => (
      String(url) === 'http://127.0.0.1:1/api/relay/devices/register'
    ))).toBe(true)
    expect(fetchMock.mock.calls.some(([url]) => String(url) === 'https://relay.example/api/relay/config/global'))
      .toBe(true)
    expect(fetchMock.mock.calls.some(([url]) => String(url) === 'https://relay.example/api/relay/config-snapshot'))
      .toBe(true)
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer pair-token',
      'content-type': 'application/json'
    })
    expect(requestBody).toMatchObject({
      capabilities: {
        sessions: true,
        terminal: false,
        workspaceFiles: false
      },
      deviceInfo: {
        deviceType: 'computer',
        runtime: 'node'
      },
      deviceName: 'Office Mac',
      managementServerEnvironment: {
        deviceType: 'computer',
        runtime: 'node'
      },
      managementServerKind: 'web',
      managementServerName: 'workspace',
      managementServerProjects: [
        expect.objectContaining({
          title: 'workspace',
          workspaceFolder: '/workspace'
        })
      ],
      pluginScope: 'relay',
      workspaceFolder: '/workspace'
    })
    expect(typeof requestBody.managementServerId).toBe('string')
    expect(requestBody.managementServerId).not.toBe('')
    expect(status.device.id).toBe(store.deviceId)
    expect(status.storePath).toBe(join(homeDir, '.oneworks', 'relay', 'device.json'))
    expect(status.storePath).not.toContain(projectHome)
    expect(store).not.toHaveProperty('deviceToken')
    expect(store).not.toHaveProperty('remoteBaseUrl')
    const persistedServiceInfo = await readFile(
      join(homeDir, '.oneworks', 'relay', 'service-info-cache.json'),
      'utf8'
    )
    expect(persistedServiceInfo).not.toContain('deviceTransport')
    expect(persistedServiceInfo).not.toContain('127.0.0.1:1')
    expect(store.servers).toMatchObject({
      prod: {
        account: {
          email: 'owner@local.test',
          name: 'Owner Local'
        },
        deviceToken: 'remote-device-token',
        remoteBaseUrl: 'https://relay.example'
      }
    })
    expect(snapshot).toMatchObject({
      hash: 'snapshot-hash',
      lastError: null,
      sourceServerId: 'prod',
      version: 'snapshot-v1'
    })
    expect(status.configDistribution).toMatchObject({
      hash: 'snapshot-hash',
      modelServiceKeys: ['relay-assigned'],
      sourceServerId: 'prod',
      sources: [
        expect.objectContaining({
          enabled: true,
          profileName: 'Base Profile',
          teamName: 'Team One'
        })
      ],
      version: 'snapshot-v1'
    })
    expect(status.servers?.[0]).toMatchObject({
      account: {
        email: 'owner@local.test',
        name: 'Owner Local'
      },
      id: 'prod'
    })
    expect(status.servers?.[0]?.devices).toMatchObject([
      {
        capabilities: { sessions: true, terminal: true, workspaceFiles: false },
        id: 'device-1',
        name: 'Office Mac',
        status: 'online',
        workspaceFolder: '/workspace'
      }
    ])
  })

  it('reuses the relay device list while public status is fresh', async () => {
    const fetchMock = stubRelayFetch()
    const { commands } = await createPluginHarness({
      deviceName: 'Office Mac',
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      servers: [
        {
          id: 'prod',
          pairingToken: 'pair-token',
          baseUrl: 'https://relay.example/'
        }
      ]
    })

    await commands.get('connect')?.()
    const deviceListCallsAfterConnect =
      fetchMock.mock.calls.filter(([url]) => String(url) === 'https://relay.example/api/relay/devices').length
    await commands.get('status')?.()
    await commands.get('status')?.()

    expect(fetchMock.mock.calls.filter(([url]) => String(url) === 'https://relay.example/api/relay/devices').length)
      .toBe(deviceListCallsAfterConnect)
  })

  it('backs off relay device list failures in public status', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === 'https://relay.example/api/relay/devices') {
        throw new TypeError('fetch failed')
      }
      return new Response(JSON.stringify({}), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { commands, disposers, logger } = await createPluginHarness(
      {
        enableOfficialCloudflareRelay: false,
        enableOfficialVercelRelay: false,
        servers: [
          {
            id: 'prod',
            baseUrl: 'https://relay.example/'
          }
        ]
      },
      {
        prepareProjectHome: async projectHome => {
          await createRelayDeviceStore(projectHome).writeStore({
            deviceId: 'stored-device-id',
            deviceName: 'Office Mac',
            deviceSecret: 'stored-device-secret',
            servers: {
              prod: {
                deviceToken: 'stored-device-token',
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
    await flushAsyncWork()
    fetchMock.mockClear()
    logger.warn.mockClear()

    const firstStatus = await commands.get('status')?.() as RelayPluginStatus
    const secondStatus = await commands.get('status')?.() as RelayPluginStatus

    expect(firstStatus.servers?.[0]?.devicesError).toBe('fetch failed')
    expect(secondStatus.servers?.[0]?.devicesError).toBe('fetch failed')
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === 'https://relay.example/api/relay/devices').length)
      .toBe(1)
    expect(logger.warn.mock.calls.filter(([, message]) => message === '[relay] device list failed')).toHaveLength(1)
    disposers.forEach(dispose => dispose())
  })

  it('uses a valid stored account session instead of probing a stale device token', async () => {
    const deviceListTokens: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get('authorization') ?? ''
      if (String(input) === 'https://relay.example/api/relay/devices') {
        deviceListTokens.push(authorization)
        return new Response(JSON.stringify({ devices: [] }), { status: 200 })
      }
      if (String(input) === 'https://relay.example/api/relay/devices/register') {
        return new Response(JSON.stringify({ deviceToken: 'fresh-device-token' }), { status: 200 })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { commands, disposers } = await createPluginHarness(
      {
        enableOfficialCloudflareRelay: false,
        enableOfficialVercelRelay: false,
        servers: [
          {
            id: 'prod',
            baseUrl: 'https://relay.example/'
          }
        ]
      },
      {
        prepareProjectHome: async projectHome => {
          await createRelayDeviceStore(projectHome).writeStore({
            deviceId: 'stored-device-id',
            deviceName: 'Office Mac',
            deviceSecret: 'stored-device-secret',
            servers: {
              prod: {
                deviceToken: 'stale-device-token',
                id: 'prod',
                registeredAt: '2026-06-15T00:00:00.000Z',
                remoteBaseUrl: 'https://relay.example',
                sessionExpiresAt: '2999-01-01T00:00:00.000Z',
                sessionToken: 'account-session-token',
                updatedAt: '2026-06-15T00:00:00.000Z'
              }
            }
          })
        }
      }
    )
    let status: RelayPluginStatus | undefined
    for (let index = 0; index < 20; index += 1) {
      status = await commands.get('status')?.() as RelayPluginStatus
      if (status.connection.state === 'registered') break
      await new Promise(resolve => setTimeout(resolve, 5))
    }

    expect(deviceListTokens.length).toBeGreaterThan(0)
    expect(new Set(deviceListTokens)).toEqual(new Set(['Bearer account-session-token']))
    const registerInit = fetchMock.mock.calls.find(([url]) =>
      String(url) === 'https://relay.example/api/relay/devices/register'
    )?.[1]
    expect(new Headers(registerInit?.headers).get('authorization')).toBe('Bearer account-session-token')
    disposers.forEach(dispose => dispose())
  })

  it('restores stored relay device connections when the plugin starts', async () => {
    const fetchMock = stubRelayFetch('restored-device-token')
    const { commands, disposers, projectHome } = await createPluginHarness(
      {
        deviceName: 'Office Mac',
        enableOfficialCloudflareRelay: false,
        enableOfficialVercelRelay: false,
        exposeSessions: true,
        servers: [
          {
            id: 'prod',
            baseUrl: 'https://relay.example/'
          }
        ]
      },
      {
        prepareProjectHome: async projectHome => {
          await createRelayDeviceStore(projectHome).writeStore({
            deviceId: 'stored-device-id',
            deviceName: 'Office Mac',
            deviceSecret: 'stored-device-secret',
            servers: {
              prod: {
                deviceToken: 'stored-device-token',
                id: 'prod',
                registeredAt: '2026-06-15T00:00:00.000Z',
                remoteBaseUrl: 'https://relay.example',
                updatedAt: '2026-06-15T00:00:00.000Z'
              }
            }
          })
        },
        sessions: {
          listSessions: vi.fn(() => [{ id: 'local-session' }]),
          submitMessage: vi.fn()
        }
      }
    )

    let status: RelayPluginStatus | undefined
    for (let index = 0; index < 20; index += 1) {
      status = await commands.get('status')?.() as RelayPluginStatus
      if (
        status.connection.state === 'registered' &&
        status.servers?.some(server => server.id === 'prod' && server.hasToken)
      ) break
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    const restoredStatus = status ?? (await commands.get('status')?.() as RelayPluginStatus)

    const registerInit = fetchMock.mock.calls.find(([url]) =>
      String(url) === 'https://relay.example/api/relay/devices/register'
    )?.[1] as RequestInit | undefined
    const requestBody = JSON.parse(String(registerInit?.body)) as Record<string, unknown>
    const store = await readDeviceStore(projectHome)
    disposers.forEach(dispose => dispose())

    expect(registerInit?.headers).toMatchObject({
      authorization: 'Bearer stored-device-token'
    })
    expect(requestBody.deviceId).toBe('stored-device-id')
    expect(restoredStatus.connection.state).toBe('registered')
    expect(restoredStatus.servers?.[0]).toMatchObject({
      connected: true,
      hasToken: true,
      id: 'prod'
    })
    expect(store.servers).toMatchObject({
      prod: {
        deviceToken: 'restored-device-token',
        remoteBaseUrl: 'https://relay.example'
      }
    })
  })

  it('applies the relay personal global config into the local global config file', async () => {
    const token = Buffer.from(JSON.stringify({ refresh_token: 'codex-refresh-token' })).toString('base64')
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.endsWith('/api/relay/config/global')
        ? {
          personalConfigSnapshot: {
            allowedFields: ['adapters'],
            configPatch: {
              adapters: {
                codex: {
                  accounts: {
                    default: {
                      auth: {
                        encoding: 'base64',
                        token,
                        type: 'codex-auth-json'
                      },
                      email: 'owner@example.test'
                    }
                  }
                }
              }
            },
            hash: 'sha256:personal-global',
            updatedAt: '2026-06-20T00:00:00.000Z',
            userId: 'owner',
            version: 'personal-global-v1'
          }
        }
        : url.endsWith('/api/relay/config-snapshot')
        ? createRelayConfigSnapshotFixture()
        : url.endsWith('/api/relay/devices')
        ? { devices: [] }
        : {
          deviceToken: 'remote-device-token',
          user: {
            avatarUrl: '',
            email: 'owner@local.test',
            id: 'owner',
            name: 'Owner Local',
            provider: 'local',
            role: 'owner'
          }
        }
      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
        status: 200
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { commands, homeDir } = await createPluginHarness({
      deviceName: 'Office Mac',
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      servers: [
        {
          id: 'prod',
          pairingToken: 'pair-token',
          baseUrl: 'https://relay.example/'
        }
      ]
    })

    const status = await commands.get('connect')?.() as RelayPluginStatus
    const config = JSON.parse(
      await readFile(join(homeDir, '.oneworks/.oo.config.json'), 'utf8')
    ) as Record<string, unknown>

    expect(status.connection.state).toBe('registered')
    expect(config).toMatchObject({
      adapters: {
        codex: {
          accounts: {
            default: {
              auth: {
                encoding: 'base64',
                token,
                type: 'codex-auth-json'
              },
              email: 'owner@example.test'
            }
          }
        }
      }
    })
  })

  it('publishes the local personal global config when relay has no snapshot yet', async () => {
    const token = Buffer.from(JSON.stringify({ refresh_token: 'local-codex-refresh-token' })).toString('base64')
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = url.endsWith('/api/relay/config/global') && method === 'PUT'
        ? {
          personalConfigSnapshot: {
            allowedFields: ['adapters'],
            configPatch: JSON.parse(String(init?.body)).configPatch,
            hash: 'sha256:published-personal-global',
            updatedAt: '2026-06-20T00:01:00.000Z',
            userId: 'owner',
            version: 'personal-global-v1'
          }
        }
        : url.endsWith('/api/relay/config/global')
        ? {
          personalConfigSnapshot: null
        }
        : url.endsWith('/api/relay/config-snapshot')
        ? createRelayConfigSnapshotFixture()
        : url.endsWith('/api/relay/devices')
        ? { devices: [] }
        : {
          deviceToken: 'remote-device-token',
          user: {
            avatarUrl: '',
            email: 'owner@local.test',
            id: 'owner',
            name: 'Owner Local',
            provider: 'local',
            role: 'owner'
          }
        }
      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
        status: 200
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { commands, homeDir } = await createPluginHarness({
      deviceName: 'Office Mac',
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      servers: [
        {
          id: 'prod',
          pairingToken: 'pair-token',
          baseUrl: 'https://relay.example/'
        }
      ]
    })
    await mkdir(join(homeDir, '.oneworks'), { recursive: true })
    await writeFile(
      join(homeDir, '.oneworks/.oo.config.json'),
      `${
        JSON.stringify(
          {
            adapters: {
              codex: {
                accounts: {
                  default: {
                    auth: {
                      encoding: 'base64',
                      token,
                      type: 'codex-auth-json'
                    },
                    email: 'local@example.test'
                  }
                },
                defaultAccount: 'default'
              }
            },
            appearance: {
              theme: 'dark'
            }
          },
          null,
          2
        )
      }\n`
    )

    const status = await commands.get('connect')?.() as RelayPluginStatus
    const putCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url) === 'https://relay.example/api/relay/config/global' && init?.method === 'PUT'
    )
    const requestBody = JSON.parse(String(putCall?.[1]?.body)) as Record<string, unknown>

    expect(status.connection.state).toBe('registered')
    expect(requestBody).toMatchObject({
      allowedFields: ['adapters'],
      configPatch: {
        adapters: {
          codex: {
            accounts: {
              default: {
                auth: {
                  encoding: 'base64',
                  token,
                  type: 'codex-auth-json'
                },
                email: 'local@example.test'
              }
            }
          }
        }
      }
    })
    expect(requestBody).not.toHaveProperty('configPatch.appearance')
  })

  it('merges newer local adapter accounts with the existing remote snapshot before publishing', async () => {
    const remoteToken = Buffer.from('remote-codex').toString('base64')
    const stateToken = Buffer.from('{"oauthAccount":{"displayName":"Ada"}}').toString('base64')
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = url.endsWith('/api/relay/config/global') && method === 'PUT'
        ? {
          personalConfigSnapshot: {
            allowedFields: ['adapters'],
            configPatch: JSON.parse(String(init?.body)).configPatch,
            hash: 'sha256:merged',
            updatedAt: new Date().toISOString(),
            userId: 'owner',
            version: 'merged'
          }
        }
        : url.endsWith('/api/relay/config/global')
        ? {
          personalConfigSnapshot: {
            allowedFields: ['adapters'],
            configPatch: {
              adapters: {
                codex: {
                  accounts: {
                    work: {
                      auth: { encoding: 'base64', token: remoteToken, type: 'codex-auth-json' }
                    }
                  }
                }
              }
            },
            hash: 'sha256:remote',
            updatedAt: '2020-01-01T00:00:00.000Z',
            userId: 'owner',
            version: 'remote'
          }
        }
        : url.endsWith('/api/relay/config-snapshot')
        ? createRelayConfigSnapshotFixture()
        : url.endsWith('/api/relay/devices')
        ? { devices: [] }
        : {
          deviceToken: 'remote-device-token',
          user: {
            email: 'owner@local.test',
            id: 'owner',
            name: 'Owner Local',
            provider: 'local',
            role: 'owner'
          }
        }
      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
        status: 200
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { commands, homeDir } = await createPluginHarness({
      deviceName: 'Office Mac',
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      servers: [{ id: 'prod', pairingToken: 'pair-token', baseUrl: 'https://relay.example/' }]
    })
    await mkdir(join(homeDir, '.oneworks'), { recursive: true })
    await writeFile(
      join(homeDir, '.oneworks/.oo.config.json'),
      JSON.stringify(
        {
          adapters: {
            'claude-code': {
              accounts: {
                personal: {
                  auth: {
                    binding: 'device',
                    portability: 'device-bound',
                    storage: 'device',
                    type: 'claude-native-credential-store'
                  },
                  state: {
                    encoding: 'base64',
                    portability: 'portable',
                    token: stateToken,
                    type: 'claude-account-state-json'
                  }
                }
              }
            }
          }
        },
        null,
        2
      )
    )

    await commands.get('connect')?.()
    const putCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url) === 'https://relay.example/api/relay/config/global' && init?.method === 'PUT'
    )
    const requestBody = JSON.parse(String(putCall?.[1]?.body)) as Record<string, unknown>
    const localConfig = JSON.parse(
      await readFile(join(homeDir, '.oneworks/.oo.config.json'), 'utf8')
    ) as Record<string, unknown>

    expect(requestBody).toHaveProperty('configPatch.adapters.codex.accounts.work.auth.token', remoteToken)
    expect(requestBody).toHaveProperty(
      'configPatch.adapters.claude-code.accounts.personal.state.token',
      stateToken
    )
    expect(localConfig).toHaveProperty('adapters.codex.accounts.work.auth.token', remoteToken)
    expect(localConfig).toHaveProperty('adapters.claude-code.accounts.personal.state.token', stateToken)
    if (process.platform !== 'win32') {
      expect((await stat(join(homeDir, '.oneworks/.oo.config.json'))).mode & 0o777).toBe(0o600)
    }
  })

  it('does not overwrite relay personal global config with a local config that has no auth snapshot', async () => {
    const remoteToken = Buffer.from(JSON.stringify({ refresh_token: 'remote-codex-refresh-token' })).toString('base64')
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = url.endsWith('/api/relay/config/global') && method === 'PUT'
        ? {
          personalConfigSnapshot: {
            allowedFields: ['adapters'],
            configPatch: JSON.parse(String(init?.body)).configPatch,
            hash: 'sha256:unexpected-local',
            updatedAt: '2026-06-30T00:01:00.000Z',
            userId: 'owner',
            version: 'personal-global-v1'
          }
        }
        : url.endsWith('/api/relay/config/global')
        ? {
          personalConfigSnapshot: {
            allowedFields: ['adapters'],
            configPatch: {
              adapters: {
                codex: {
                  accounts: {
                    default: {
                      auth: {
                        encoding: 'base64',
                        token: remoteToken,
                        type: 'codex-auth-json'
                      },
                      email: 'remote@example.test'
                    }
                  },
                  defaultAccount: 'default'
                }
              }
            },
            hash: 'sha256:remote-personal-global',
            updatedAt: '2026-06-20T00:01:00.000Z',
            userId: 'owner',
            version: 'personal-global-v1'
          }
        }
        : url.endsWith('/api/relay/config-snapshot')
        ? createRelayConfigSnapshotFixture()
        : url.endsWith('/api/relay/devices')
        ? { devices: [] }
        : {
          deviceToken: 'remote-device-token',
          user: {
            avatarUrl: '',
            email: 'owner@local.test',
            id: 'owner',
            name: 'Owner Local',
            provider: 'local',
            role: 'owner'
          }
        }
      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
        status: 200
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { commands, homeDir } = await createPluginHarness({
      deviceName: 'Linux Docker Smoke',
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      servers: [
        {
          id: 'prod',
          pairingToken: 'pair-token',
          baseUrl: 'https://relay.example/'
        }
      ]
    })
    await mkdir(join(homeDir, '.oneworks'), { recursive: true })
    await writeFile(
      join(homeDir, '.oneworks/.oo.config.json'),
      `${
        JSON.stringify(
          {
            adapters: {
              codex: {
                accounts: {
                  local: {
                    email: 'local-without-auth@example.test'
                  }
                },
                defaultAccount: 'local'
              }
            }
          },
          null,
          2
        )
      }\n`
    )

    const status = await commands.get('connect')?.() as RelayPluginStatus
    const putCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url) === 'https://relay.example/api/relay/config/global' && init?.method === 'PUT'
    )
    const putBody = JSON.parse(String(putCall?.[1]?.body)) as Record<string, unknown>
    const config = JSON.parse(
      await readFile(join(homeDir, '.oneworks/.oo.config.json'), 'utf8')
    ) as Record<string, unknown>

    expect(status.connection.state).toBe('registered')
    expect(putBody).toHaveProperty(
      'configPatch.adapters.codex.accounts.default.auth.token',
      remoteToken
    )
    expect(putBody).not.toHaveProperty('configPatch.adapters.codex.accounts.local.auth')
    expect(config).toMatchObject({
      adapters: {
        codex: {
          accounts: {
            default: {
              auth: {
                encoding: 'base64',
                token: remoteToken,
                type: 'codex-auth-json'
              },
              email: 'remote@example.test'
            }
          }
        }
      }
    })
  })

  it('reports applied Relay config distribution metadata from the local snapshot cache', async () => {
    const { commands, projectHome } = await createPluginHarness({
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false
    })
    await createRelayConfigSnapshotStore(projectHome).writeSnapshot({
      assignments: [
        {
          id: 'base',
          allowedFields: ['modelServices'],
          configPatch: {
            modelServices: {
              relay: {
                apiBaseUrl: 'https://relay.example/v1'
              }
            }
          }
        }
      ],
      hash: 'sha256:cache',
      lastAppliedAt: '2026-06-15T00:05:00.000Z',
      lastError: null,
      lastSyncedAt: '2026-06-15T00:00:00.000Z',
      matchedProject: true,
      sourceServerId: 'prod',
      version: 'v1'
    })

    const status = await commands.get('status')?.() as RelayPluginStatus

    expect(status.configDistribution).toMatchObject({
      allowedFields: ['modelServices'],
      hash: 'sha256:cache',
      lastAppliedAt: '2026-06-15T00:05:00.000Z',
      lastSyncedAt: '2026-06-15T00:00:00.000Z',
      matchedProject: true,
      modelServiceKeys: ['relay'],
      sourceServerId: 'prod',
      version: 'v1'
    })
  })

  it('reports a local error when relay server config is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { commands } = await createPluginHarness({
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false
    })

    const status = await commands.get('connect')?.() as RelayPluginStatus

    expect(status.connection).toMatchObject({
      lastError: 'missing_relay_server',
      state: 'error'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('includes auth store server metadata in public status for account grouping', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    vi.stubGlobal('fetch', fetchMock)
    const { commands } = await createPluginHarness({
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false
    })
    await writeOneWorksAuthStore({
      accounts: [
        {
          accountKey: 'team:owner',
          email: 'owner@team.test',
          enabled: true,
          loginId: 'owner',
          name: 'Owner Team',
          role: 'owner',
          serverId: 'team',
          serverUrl: 'https://relay.team.example.test',
          sessionToken: 'session-token',
          userId: 'owner'
        }
      ],
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

    const status = await commands.get('status')?.() as RelayPluginStatus

    expect(status.servers?.find(server => server.id === 'team')).toMatchObject({
      connected: false,
      hasToken: false,
      id: 'team',
      name: 'Team Workspace',
      remoteBaseUrl: 'https://relay.team.example.test',
      sessionAuthenticated: true
    })
  })

  it('lists shared Rooms across authenticated accounts without exposing account credentials', async () => {
    let listVisible: (() => Promise<SharedAgentRoomDirectoryEntry[]>) | undefined
    const unregister = vi.fn()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === 'https://offline.example.test/api/relay/rooms') {
        throw new TypeError('relay unavailable')
      }
      if (url === 'https://team.example.test/api/relay/rooms') {
        expect(init?.headers).toMatchObject({ authorization: 'Bearer team-session-secret' })
        return new Response(
          JSON.stringify({
            rooms: [{
              availability: 'online',
              createdAt: '2026-08-01T08:00:00.000Z',
              ownerDeviceId: 'private-device-id',
              ownerUserId: 'private-owner-id',
              roomId: 'private-local-room-id',
              shareId: 'shared-room-1',
              status: 'active',
              title: 'Product review',
              updatedAt: '2026-08-02T09:30:00.000Z'
            }]
          }),
          { status: 200 }
        )
      }
      return new Response(JSON.stringify({ rooms: [] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { disposers } = await createPluginHarness(
      {
        autoConnect: false,
        enableOfficialCloudflareRelay: false,
        enableOfficialVercelRelay: false
      },
      {
        roomTunnel: {
          handleRequest: vi.fn(),
          registerDirectoryClient: client => {
            listVisible = client.listVisible
            return unregister
          }
        }
      }
    )
    await writeOneWorksAuthStore({
      accounts: [
        {
          accountKey: 'team:owner',
          email: 'owner@team.example.test',
          enabled: true,
          name: 'Team Workspace',
          serverId: 'team',
          serverUrl: 'https://team.example.test',
          sessionToken: 'team-session-secret',
          userId: 'owner'
        },
        {
          accountKey: 'offline:owner',
          enabled: true,
          serverId: 'offline',
          serverUrl: 'https://offline.example.test',
          sessionToken: 'offline-session-secret',
          userId: 'owner'
        }
      ],
      servers: {
        offline: { id: 'offline', name: 'Offline Relay', url: 'https://offline.example.test' },
        team: { id: 'team', name: 'Team Relay', url: 'https://team.example.test' }
      },
      version: ONEWORKS_AUTH_STORE_VERSION
    })

    await expect(listVisible?.()).resolves.toEqual([
      {
        room: {
          availability: 'online',
          createdAt: '2026-08-01T08:00:00.000Z',
          shareId: 'shared-room-1',
          status: 'active',
          title: 'Product review',
          updatedAt: '2026-08-02T09:30:00.000Z'
        },
        sourceLabel: 'Team Workspace',
        sourceRef: expect.stringMatching(/^[a-f0-9]{24}$/u)
      }
    ])
    const serialized = JSON.stringify(await listVisible?.())
    expect(serialized).not.toContain('team:owner')
    expect(serialized).not.toContain('team-session-secret')
    expect(serialized).not.toContain('private-device-id')
    expect(serialized).not.toContain('private-owner-id')
    expect(serialized).not.toContain('private-local-room-id')
    disposers.forEach(dispose => dispose())
    expect(unregister).toHaveBeenCalledOnce()
  })

  it('matches configured relay servers to auth accounts by remote url', async () => {
    const { commands } = await createPluginHarness({
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      servers: [
        {
          id: 'local',
          name: 'Local',
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
          sessionToken: 'session-token',
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

    const result = await commands.get('users')?.({ serverId: 'local' }) as {
      accounts: Array<{ accountKey: string; email?: string }>
    }

    expect(result.accounts).toMatchObject([
      {
        accountKey: 'http-127-0-0-1-48890:owner',
        email: 'owner@local.test'
      }
    ])
  })

  it('registers account sessions with the system-user device identity', async () => {
    const fetchMock = stubRelayFetch('workspace-device-token')
    const { commands, projectHome } = await createPluginHarness({
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      servers: [
        {
          id: 'prod',
          baseUrl: 'https://relay.example/'
        }
      ]
    })
    await writeOneWorksAuthStore({
      accounts: [
        {
          accountKey: 'prod:owner',
          deviceId: 'legacy-global-device',
          deviceToken: 'legacy-global-device-token',
          email: 'owner@local.test',
          enabled: true,
          name: 'Owner Local',
          serverId: 'prod',
          serverUrl: 'https://relay.example',
          sessionToken: 'session-token',
          userId: 'owner'
        }
      ],
      servers: {
        prod: {
          id: 'prod',
          name: 'Production',
          url: 'https://relay.example'
        }
      },
      version: ONEWORKS_AUTH_STORE_VERSION
    })

    const status = await commands.get('connect')?.({
      accountKey: 'prod:owner',
      serverId: 'prod'
    }) as RelayPluginStatus
    const registerInit = fetchMock.mock.calls.find(([url]) =>
      String(url) === 'https://relay.example/api/relay/devices/register'
    )?.[1] as RequestInit | undefined
    const requestBody = JSON.parse(String(registerInit?.body)) as Record<string, unknown>
    const store = await readDeviceStore(projectHome)
    const authStore = await readOneWorksAuthStore()
    const account = authStore.accounts.find(item => item.accountKey === 'prod:owner')

    expect(status.connection.state).toBe('registered')
    expect(registerInit?.headers).toMatchObject({
      authorization: 'Bearer session-token'
    })
    expect(requestBody.deviceId).toBe(store.deviceId)
    expect(requestBody.deviceId).not.toBe('legacy-global-device')
    expect(store.servers).toMatchObject({
      prod: {
        deviceToken: 'workspace-device-token'
      }
    })
    expect(account).toMatchObject({
      accountKey: 'prod:owner',
      enabled: true,
      sessionToken: 'session-token'
    })
    expect(account).not.toHaveProperty('deviceId')
    expect(account).not.toHaveProperty('deviceToken')
  })

  it('connects to the requested relay server and stores tokens per server', async () => {
    const fetchMock = stubRelayFetch()
    const { commands, projectHome } = await createPluginHarness({
      activeServerId: 'lab',
      deviceName: 'Office Mac',
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      servers: [
        {
          id: 'prod',
          name: 'Production',
          pairingToken: 'prod-token',
          port: 443,
          protocol: 'https',
          server: 'relay.example.com'
        },
        {
          id: 'lab',
          name: 'Lab',
          pairingToken: 'lab-token',
          port: 8788,
          protocol: 'http',
          server: '127.0.0.1'
        }
      ]
    })

    const labStatus = await commands.get('connect')?.() as RelayPluginStatus
    const prodStatus = await commands.get('connect')?.({ serverId: 'prod' }) as RelayPluginStatus
    const store = await readDeviceStore(projectHome)
    const requestUrls = fetchMock.mock.calls.map(([url]) => String(url))

    expect(requestUrls).toContain('http://127.0.0.1:8788/api/relay/devices/register')
    expect(requestUrls).toContain('http://127.0.0.1:8788/api/relay/devices')
    expect(
      fetchMock.mock.calls.find(([url]) => String(url) === 'http://127.0.0.1:8788/api/relay/devices/register')?.[1]
        ?.headers
    ).toMatchObject({
      authorization: 'Bearer lab-token'
    })
    expect(labStatus.connection).toMatchObject({
      activeServerId: 'lab',
      remoteBaseUrl: 'http://127.0.0.1:8788',
      state: 'registered'
    })
    expect(requestUrls).toContain('https://relay.example.com/api/relay/devices/register')
    expect(requestUrls).toContain('https://relay.example.com/api/relay/devices')
    expect(
      fetchMock.mock.calls.find(([url]) => String(url) === 'https://relay.example.com/api/relay/devices/register')?.[1]
        ?.headers
    ).toMatchObject({
      authorization: 'Bearer prod-token'
    })
    expect(prodStatus.connection).toMatchObject({
      activeServerId: 'prod',
      remoteBaseUrl: 'https://relay.example.com',
      state: 'registered'
    })
    expect(prodStatus.servers?.find(server => server.id === 'lab')).toMatchObject({
      connected: true,
      connection: {
        activeServerId: 'lab',
        remoteBaseUrl: 'http://127.0.0.1:8788',
        state: 'registered'
      }
    })
    expect(prodStatus.servers?.find(server => server.id === 'prod')).toMatchObject({
      connected: true,
      connection: {
        activeServerId: 'prod',
        remoteBaseUrl: 'https://relay.example.com',
        state: 'registered'
      }
    })
    expect(store.servers).toMatchObject({
      lab: {
        deviceToken: 'remote-device-token',
        remoteBaseUrl: 'http://127.0.0.1:8788'
      },
      prod: {
        deviceToken: 'remote-device-token',
        remoteBaseUrl: 'https://relay.example.com'
      }
    })
  })

  it('keeps per-server heartbeat and session worker loops when connecting another relay server', async () => {
    vi.useFakeTimers()
    const fetchMock = stubRelayFetch()
    const { commands, disposers } = await createPluginHarness(
      {
        activeServerId: 'lab',
        deviceName: 'Office Mac',
        exposeSessions: true,
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
      },
      {
        sessions: {
          listSessions: vi.fn(() => [{ id: 'local-session' }]),
          submitMessage: vi.fn()
        }
      }
    )

    await commands.get('connect')?.()
    await commands.get('connect')?.({ serverId: 'prod' })
    await flushAsyncWork()
    fetchMock.mockClear()
    await vi.advanceTimersByTimeAsync(30_000)
    disposers.forEach(dispose => dispose())
    const requestUrls = fetchMock.mock.calls.map(([url]) => String(url))

    expect(requestUrls.filter(url => url.endsWith('/devices/heartbeat'))).toHaveLength(0)
    expect(requestUrls.filter(url => url.endsWith('/sessions/snapshot'))).toHaveLength(2)
  })

  it('deduplicates relay loops for different local server ids that point to the same remote url', async () => {
    vi.useFakeTimers()
    const fetchMock = stubRelayFetch()
    const { commands, disposers } = await createPluginHarness(
      {
        activeServerId: 'local-a',
        deviceName: 'Office Mac',
        exposeSessions: true,
        servers: [
          {
            id: 'local-a',
            pairingToken: 'token-a',
            baseUrl: 'https://relay.example'
          },
          {
            id: 'local-b',
            pairingToken: 'token-b',
            baseUrl: 'https://relay.example/'
          }
        ]
      },
      {
        sessions: {
          listSessions: vi.fn(() => [{ id: 'local-session' }]),
          submitMessage: vi.fn()
        }
      }
    )

    await commands.get('connect')?.()
    await commands.get('connect')?.({ serverId: 'local-b' })
    await flushAsyncWork()
    fetchMock.mockClear()
    await vi.advanceTimersByTimeAsync(30_000)
    disposers.forEach(dispose => dispose())
    const requestUrls = fetchMock.mock.calls.map(([url]) => String(url))
    const heartbeatUrls = requestUrls.filter(url => url === 'https://relay.example/api/relay/devices/heartbeat')
    const snapshotUrls = requestUrls.filter(url =>
      url.startsWith('https://relay.example/api/relay/devices/') &&
      url.endsWith('/sessions/snapshot')
    )

    expect(heartbeatUrls).toHaveLength(0)
    expect(snapshotUrls.length).toBeLessThanOrEqual(1)
  })

  it('replaces account-scoped loops when reconnecting the same relay server without an account', async () => {
    vi.useFakeTimers()
    const fetchMock = stubRelayFetch()
    const { commands, disposers } = await createPluginHarness(
      {
        deviceName: 'Office Mac',
        enableOfficialCloudflareRelay: false,
        enableOfficialVercelRelay: false,
        exposeSessions: true,
        servers: [
          {
            id: 'prod',
            baseUrl: 'https://relay.example'
          }
        ]
      },
      {
        sessions: {
          listSessions: vi.fn(() => [{ id: 'local-session' }]),
          submitMessage: vi.fn()
        }
      }
    )
    await writeOneWorksAuthStore({
      accounts: [
        {
          accountKey: 'prod:owner',
          email: 'owner@local.test',
          enabled: true,
          name: 'Owner Local',
          serverId: 'prod',
          serverUrl: 'https://relay.example',
          sessionToken: 'session-token',
          userId: 'owner'
        }
      ],
      servers: {
        prod: {
          id: 'prod',
          name: 'Production',
          url: 'https://relay.example'
        }
      },
      version: ONEWORKS_AUTH_STORE_VERSION
    })

    await commands.get('connect')?.({
      accountKey: 'prod:owner',
      serverId: 'prod'
    })
    await commands.get('connect')?.({ serverId: 'prod' })
    const registerCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url) === 'https://relay.example/api/relay/devices/register'
    )
    expect(registerCalls).toHaveLength(2)
    expect(registerCalls[1]?.[1]?.headers).toMatchObject({
      authorization: 'Bearer session-token'
    })
    const authStore = await readOneWorksAuthStore()
    await writeOneWorksAuthStore({
      ...authStore,
      accounts: authStore.accounts.map(account => ({
        ...account,
        sessionExpiresAt: '2000-01-01T00:00:00.000Z'
      }))
    })
    await commands.get('connect')?.({ serverId: 'prod' })
    const registerCallsAfterExpiry = fetchMock.mock.calls.filter(([url]) =>
      String(url) === 'https://relay.example/api/relay/devices/register'
    )
    expect(registerCallsAfterExpiry).toHaveLength(3)
    expect(registerCallsAfterExpiry[2]?.[1]?.headers).toMatchObject({
      authorization: 'Bearer remote-device-token'
    })
    await flushAsyncWork()
    fetchMock.mockClear()
    await vi.advanceTimersByTimeAsync(30_000)
    disposers.forEach(dispose => dispose())
    const requestUrls = fetchMock.mock.calls.map(([url]) => String(url))
    const heartbeatUrls = requestUrls.filter(url => url === 'https://relay.example/api/relay/devices/heartbeat')
    const snapshotUrls = requestUrls.filter(url =>
      url.startsWith('https://relay.example/api/relay/devices/') &&
      url.endsWith('/sessions/snapshot')
    )

    expect(heartbeatUrls).toHaveLength(0)
    expect(snapshotUrls.length).toBeLessThanOrEqual(1)
  })

  it('disconnects one relay server without stopping other active connections', async () => {
    vi.useFakeTimers()
    const fetchMock = stubRelayFetch()
    const { commands, disposers } = await createPluginHarness({
      activeServerId: 'lab',
      deviceName: 'Office Mac',
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
    const status = await commands.get('disconnect')?.({ serverId: 'prod' }) as RelayPluginStatus
    fetchMock.mockClear()
    await vi.advanceTimersByTimeAsync(30_000)
    disposers.forEach(dispose => dispose())
    const requestUrls = fetchMock.mock.calls.map(([url]) => String(url))

    expect(status.servers?.find(server => server.id === 'lab')).toMatchObject({
      connected: true,
      connection: {
        state: 'registered'
      }
    })
    expect(status.servers?.find(server => server.id === 'prod')).toMatchObject({
      connected: false,
      connection: {
        state: 'idle'
      }
    })
    expect(requestUrls).toContain('http://127.0.0.1:8788/api/relay/devices/heartbeat')
    expect(requestUrls).not.toContain('https://relay.example/api/relay/devices/heartbeat')
  })

  it('forgets one relay server without stopping other active connections', async () => {
    vi.useFakeTimers()
    const fetchMock = stubRelayFetch()
    const { apis, commands, disposers, projectHome } = await createPluginHarness({
      activeServerId: 'lab',
      deviceName: 'Office Mac',
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
    const forgetResponse = await apis.get('relay')?.handler?.({
      body: Buffer.from(JSON.stringify({ serverId: 'prod' })),
      method: 'POST',
      path: 'forget'
    }) as { body?: RelayPluginStatus; status?: number }
    const store = await readDeviceStore(projectHome)
    fetchMock.mockClear()
    await vi.advanceTimersByTimeAsync(30_000)
    disposers.forEach(dispose => dispose())
    const requestUrls = fetchMock.mock.calls.map(([url]) => String(url))

    expect(forgetResponse.status).toBe(200)
    expect(forgetResponse.body?.servers?.find(server => server.id === 'lab')).toMatchObject({
      connected: true,
      connection: {
        state: 'registered'
      }
    })
    expect(forgetResponse.body?.servers?.find(server => server.id === 'prod')).toMatchObject({
      connected: false,
      connection: {
        state: 'idle'
      },
      hasToken: false
    })
    expect(store.servers).toMatchObject({
      lab: {
        deviceToken: 'remote-device-token'
      },
      prod: {
        deviceToken: ''
      }
    })
    expect(requestUrls).toContain('http://127.0.0.1:8788/api/relay/devices/heartbeat')
    expect(requestUrls).not.toContain('https://relay.example/api/relay/devices/heartbeat')
  })

  it('starts scheduled heartbeat after connecting', async () => {
    vi.useFakeTimers()
    const fetchMock = stubRelayFetch()
    const { commands, disposers } = await createPluginHarness({
      deviceName: 'Office Mac',
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
    await vi.advanceTimersByTimeAsync(30_000)
    disposers.forEach(dispose => dispose())
    const requestUrls = fetchMock.mock.calls.map(([url]) => String(url))

    expect(requestUrls).toContain('https://relay.example/api/relay/devices/register')
    expect(requestUrls).toContain('https://relay.example/api/relay/devices')
    expect(requestUrls).toContain('https://relay.example/api/relay/devices/heartbeat')
  })
})
