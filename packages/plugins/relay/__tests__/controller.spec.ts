import { Buffer } from 'node:buffer'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRelayConfigSnapshotStore } from '../src/shared/config-cache.js'
import {
  cleanupPluginFixtures,
  createPluginHarness,
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
  it('registers a device with the configured remote relay', async () => {
    const fetchMock = stubRelayFetch()
    const { commands, projectHome } = await createPluginHarness({
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
    const [, init] = fetchMock.mock.calls[0]
    const requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    const store = await readDeviceStore(projectHome)
    const snapshot = await readConfigSnapshot(projectHome)

    expect(status.connection.state).toBe('registered')
    expect(status.device.hasToken).toBe(true)
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://relay.example/api/relay/devices/register')
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://relay.example/api/relay/config-snapshot')
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
      deviceName: 'Office Mac',
      pluginScope: 'relay',
      workspaceFolder: '/workspace'
    })
    expect(store).not.toHaveProperty('deviceToken')
    expect(store).not.toHaveProperty('remoteBaseUrl')
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
        status: 'online'
      }
    ])
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

    expect(requestUrls).toContain('http://127.0.0.1:8788/api/relay/devices/heartbeat')
    expect(requestUrls).toContain('https://relay.example/api/relay/devices/heartbeat')
    expect(requestUrls.some(url => (
      url.startsWith('http://127.0.0.1:8788/api/relay/devices/') &&
      url.endsWith('/sessions/snapshot')
    ))).toBe(true)
    expect(requestUrls.some(url => (
      url.startsWith('https://relay.example/api/relay/devices/') &&
      url.endsWith('/sessions/snapshot')
    ))).toBe(true)
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
