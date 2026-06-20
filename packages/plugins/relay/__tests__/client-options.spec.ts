import { describe, expect, it } from 'vitest'

import { buildRelayServerOptionsUpdate } from '../src/client/options.js'

describe('relay plugin options update', () => {
  it('builds a scoped multi-server options update for the active relay server', () => {
    const nextOptions = buildRelayServerOptionsUpdate({
      activeServerId: 'local',
      autoConnect: true,
      servers: [
        {
          id: 'local',
          name: 'Local Relay SSO',
          pairingToken: 'secret',
          protocol: 'http',
          server: '127.0.0.1',
          port: 48888
        },
        {
          id: 'prod',
          name: 'Production',
          baseUrl: 'https://relay.example.com'
        }
      ]
    }, {
      id: 'local',
      name: 'Local Lab',
      remoteBaseUrl: 'http://localhost:49000/api/'
    })

    expect(nextOptions).toEqual({
      activeServerId: 'local',
      autoConnect: true,
      servers: [
        {
          id: 'local',
          name: 'Local Lab',
          pairingToken: 'secret',
          path: '/api',
          port: 49000,
          protocol: 'http',
          server: 'localhost'
        },
        {
          id: 'prod',
          name: 'Production',
          baseUrl: 'https://relay.example.com'
        }
      ]
    })
  })

  it('creates a servers list when the relay plugin is not configured yet', () => {
    expect(buildRelayServerOptionsUpdate({}, {
      name: '',
      remoteBaseUrl: 'http://127.0.0.1:48888'
    })).toEqual({
      activeServerId: 'http-127-0-0-1-48888',
      servers: [{
        id: 'http-127-0-0-1-48888',
        name: '127.0.0.1:48888',
        port: 48888,
        protocol: 'http',
        server: '127.0.0.1'
      }]
    })
  })
})
