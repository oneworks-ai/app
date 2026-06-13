import { Buffer } from 'node:buffer'

import { afterEach, describe, expect, it } from 'vitest'

import { cleanupPluginFixtures, createPluginHarness, readDeviceStore, stubRelayFetch } from './helpers.js'
import type { RelayPluginStatus } from './helpers.js'
import {
  DEFAULT_OFFICIAL_RELAY_SERVER_ID,
  OFFICIAL_RELAY_CLOUDFLARE_BASE_URL
} from '../src/shared/official-services.js'

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
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined

    expect(response.status).toBe(200)
    expect(response.body?.connection.state).toBe('registered')
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer sso-session-token'
    })
    expect(store.servers).toMatchObject({
      prod: {
        deviceToken: 'callback-device-token'
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
