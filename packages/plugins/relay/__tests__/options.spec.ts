import { describe, expect, it } from 'vitest'

import { normalizeOptions } from '../src/server/options.js'

describe('relay plugin options', () => {
  it('builds a relay URL from server and port fields inside servers', () => {
    expect(normalizeOptions({
      activeServerId: 'local',
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

  it('ignores top-level relay server fields', () => {
    expect(normalizeOptions({
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
