import { afterEach, describe, expect, it, vi } from 'vitest'

import { cleanupPluginFixtures, createPluginHarness, readDeviceStore, stubRelayFetch } from './helpers.js'
import type { RelayPluginStatus } from './helpers.js'

afterEach(async () => {
  vi.useRealTimers()
  await cleanupPluginFixtures()
})

describe('relay plugin controller', () => {
  it('registers a device with the configured remote relay', async () => {
    const fetchMock = stubRelayFetch()
    const { commands, projectHome } = await createPluginHarness({
      deviceName: 'Office Mac',
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

    expect(status.connection.state).toBe('registered')
    expect(status.device.hasToken).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://relay.example/api/relay/devices/register')
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

  it('reports a local error when relay server config is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { commands } = await createPluginHarness({})

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

  it('starts scheduled heartbeat after connecting', async () => {
    vi.useFakeTimers()
    const fetchMock = stubRelayFetch()
    const { commands, disposers } = await createPluginHarness({
      deviceName: 'Office Mac',
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
