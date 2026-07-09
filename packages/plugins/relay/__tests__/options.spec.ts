import { describe, expect, it } from 'vitest'

import { normalizeOptions, resolveActiveRelayServer } from '../src/server/options.js'
import {
  DEFAULT_OFFICIAL_RELAY_SERVER_ID,
  OFFICIAL_RELAY_CLOUDFLARE_BASE_URL,
  OFFICIAL_RELAY_CLOUDFLARE_DEV_BASE_URL,
  OFFICIAL_RELAY_VERCEL_BASE_URL
} from '../src/shared/official-services.js'

describe('relay plugin options', () => {
  it('enables official OneWorks relay services by default', () => {
    expect(normalizeOptions({})).toMatchObject({
      activeServerId: DEFAULT_OFFICIAL_RELAY_SERVER_ID,
      officialServices: {
        cloudflare: true,
        vercel: true
      },
      servers: [
        {
          id: 'oneworks-cloudflare',
          name: 'OneWorks Relay (Cloudflare)',
          official: true,
          platform: 'Cloudflare',
          remoteBaseUrl: OFFICIAL_RELAY_CLOUDFLARE_BASE_URL
        },
        {
          id: 'oneworks-vercel',
          name: 'OneWorks Relay (Vercel)',
          official: true,
          platform: 'Vercel',
          remoteBaseUrl: OFFICIAL_RELAY_VERCEL_BASE_URL
        }
      ]
    })
  })

  it('allows official relay services to be hidden and disabled', () => {
    expect(normalizeOptions({
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false
    })).toMatchObject({
      activeServerId: '',
      officialServices: {
        cloudflare: false,
        vercel: false
      },
      servers: []
    })
  })

  it('defaults workspace launcher exposure from the plugin runtime role', () => {
    expect(normalizeOptions({}).capabilities.workspaceLauncher).toBe(false)
    expect(normalizeOptions({}, 'manager').capabilities.workspaceLauncher).toBe(true)
    expect(normalizeOptions({ exposeWorkspaceLauncher: false }, 'manager').capabilities.workspaceLauncher).toBe(false)
    expect(normalizeOptions({ exposeWorkspaceLauncher: true }).capabilities.workspaceLauncher).toBe(true)
  })

  it('keeps custom servers alongside enabled official services', () => {
    const options = normalizeOptions({
      servers: [
        {
          id: 'prod',
          name: 'Production',
          baseUrl: 'https://relay.example.com'
        }
      ]
    })

    expect(options.servers.map(server => server.id)).toEqual([
      'oneworks-cloudflare',
      'oneworks-vercel',
      'prod'
    ])
    expect(options.servers[2]).toMatchObject({
      id: 'prod',
      name: 'Production',
      remoteBaseUrl: 'https://relay.example.com'
    })
    expect(options.servers[2]?.official).toBeUndefined()
  })

  it('includes official development relay services in development builds', () => {
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try {
      expect(normalizeOptions({}).servers).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'oneworks-cloudflare-dev',
          name: 'OneWorks Relay (Cloudflare Dev)',
          official: true,
          remoteBaseUrl: OFFICIAL_RELAY_CLOUDFLARE_DEV_BASE_URL
        })
      ]))
    } finally {
      if (previousNodeEnv == null) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = previousNodeEnv
      }
    }
  })

  it('builds a relay URL from server and port fields inside servers', () => {
    expect(normalizeOptions({
      activeServerId: 'local',
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      servers: [
        {
          id: 'local',
          pairingToken: 'secret',
          port: 8788,
          protocol: 'http',
          server: '127.0.0.1'
        }
      ]
    })).toMatchObject({
      activeServerId: 'local',
      servers: [
        {
          id: 'local',
          pairingTokenConfigured: true,
          port: 8788,
          protocol: 'http',
          remoteBaseUrl: 'http://127.0.0.1:8788',
          server: '127.0.0.1'
        }
      ]
    })
  })

  it('resolves local relay server aliases', () => {
    const options = {
      servers: [
        {
          id: 'local',
          baseUrl: 'http://127.0.0.1:48890'
        }
      ]
    }

    expect(resolveActiveRelayServer(options, 'local')).toMatchObject({
      id: 'local',
      remoteBaseUrl: 'http://127.0.0.1:48890'
    })
    expect(resolveActiveRelayServer(options, 'localhost')).toMatchObject({
      id: 'local',
      remoteBaseUrl: 'http://127.0.0.1:48890'
    })
  })

  it('ignores top-level relay server fields', () => {
    expect(normalizeOptions({
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      pairingToken: 'secret',
      port: 8788,
      protocol: 'http',
      server: '127.0.0.1'
    })).toMatchObject({
      activeServerId: '',
      servers: []
    })
  })

  it('normalizes multiple relay servers without exposing pairing tokens', () => {
    const options = normalizeOptions({
      activeServerId: 'lab',
      enableOfficialCloudflareRelay: false,
      enableOfficialVercelRelay: false,
      servers: [
        {
          id: 'prod',
          name: 'Production',
          pairingToken: 'prod-token',
          protocol: 'https',
          server: 'relay.example.com'
        },
        {
          id: 'lab',
          name: 'Lab',
          pairingToken: 'lab-token',
          port: 8788,
          protocol: 'http',
          server: 'localhost'
        }
      ]
    })

    expect(options).toMatchObject({
      activeServerId: 'lab',
      servers: [
        {
          id: 'prod',
          name: 'Production',
          pairingTokenConfigured: true,
          remoteBaseUrl: 'https://relay.example.com'
        },
        {
          id: 'lab',
          name: 'Lab',
          pairingTokenConfigured: true,
          remoteBaseUrl: 'http://localhost:8788'
        }
      ]
    })
    expect(JSON.stringify(options)).not.toContain('prod-token')
    expect(JSON.stringify(options)).not.toContain('lab-token')
  })
})
