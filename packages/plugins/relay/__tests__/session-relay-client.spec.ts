import { afterEach, describe, expect, it, vi } from 'vitest'

import { pollRelaySessionForwardingJobs } from '../src/server/session-relay-client.js'
import type { RelaySessionClientAuth } from '../src/server/session-types.js'

afterEach(() => vi.unstubAllGlobals())

const auth: RelaySessionClientAuth = {
  apiBaseUrl: 'https://device-api.example/',
  deviceId: 'device-1',
  deviceToken: 'device-secret',
  remoteBaseUrl: 'https://public-relay.example/'
}

describe('relay session client polling wire contract', () => {
  it('uses a credential-free v2 POST URL and keeps every poll control in the JSON body', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ jobs: [] })))
    vi.stubGlobal('fetch', fetchMock)

    await pollRelaySessionForwardingJobs(auth, {
      heartbeat: {
        capabilities: {
          sessions: true,
          terminal: false,
          workspaceFiles: false,
          workspaceLauncher: false
        },
        deviceId: 'device-1',
        deviceToken: 'device-secret',
        managementServerId: 'manager-1',
        managementServerKind: 'daemon',
        pluginScope: 'manager',
        remoteBaseUrl: 'https://public-relay.example/',
        workspaceFolder: '/workspace'
      },
      limit: 50,
      status: 'queued',
      waitMs: 50_000
    })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toBe('https://device-api.example/api/relay/devices/device-1/session-jobs')
    expect(String(url)).not.toContain('device-secret')
    expect(new URL(String(url)).search).toBe('')
    expect(init).toMatchObject({
      headers: {
        authorization: 'Bearer device-secret',
        'content-type': 'application/json'
      },
      method: 'POST'
    })
    expect(init?.headers).toEqual({
      authorization: 'Bearer device-secret',
      'content-type': 'application/json'
    })
    expect(JSON.parse(String(init?.body))).toMatchObject({
      heartbeat: { deviceId: 'device-1', managementServerId: 'manager-1' },
      limit: 50,
      status: 'queued',
      waitMs: 50_000
    })
  })

  it('preserves the legacy GET query wire format without a heartbeat body', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ jobs: [] })))
    vi.stubGlobal('fetch', fetchMock)

    await pollRelaySessionForwardingJobs(auth, { limit: 50, status: 'queued', waitMs: 10_000 })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toBe(
      'https://device-api.example/api/relay/devices/device-1/session-jobs?status=queued&limit=50&waitMs=10000'
    )
    expect(init).toMatchObject({ method: 'GET' })
    expect(init?.body).toBeUndefined()
  })
})
