import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { readRelayStore, writeRelayStore } from '../src/store.js'
import type { RelayDevice } from '../src/types.js'
import { authHeaders, cleanupRelayFixtures, listenRelay, requestJson } from './helpers.js'

const userSessionToken = 'user-1-session-token'

afterEach(cleanupRelayFixtures)

const createInvite = async (dataPath: string, code: string) => {
  const store = await readRelayStore(dataPath)
  if (!store.users.some(user => user.id === 'user-1')) {
    store.users.push({
      createdAt: new Date().toISOString(),
      email: 'user-1@example.com',
      id: 'user-1',
      name: 'User 1',
      role: 'member'
    })
  }
  if (!store.sessions.some(session => session.token === userSessionToken)) {
    store.sessions.push({
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      lastSeenAt: new Date().toISOString(),
      token: userSessionToken,
      userId: 'user-1'
    })
  }
  store.invites.push({
    code,
    createdAt: new Date().toISOString(),
    maxUses: 1,
    role: 'member',
    used: 0,
    userId: 'user-1'
  })
  await writeRelayStore(dataPath, store)
}

const createDevice = (overrides: Partial<RelayDevice>): RelayDevice => ({
  capabilities: {},
  createdAt: new Date().toISOString(),
  deviceToken: `${overrides.id ?? 'device'}-token`,
  id: 'device',
  lastSeenAt: new Date().toISOString(),
  name: 'Device',
  ...overrides
})

describe('relay server device routes', () => {
  it('registers devices with invites and redacts device tokens', async () => {
    const { args, baseUrl } = await listenRelay()
    await createInvite(args.dataPath, 'pair-one')

    const registered = await requestJson(baseUrl, '/api/relay/devices/register', {
      method: 'POST',
      headers: authHeaders('pair-one'),
      body: JSON.stringify({
        capabilities: { sessions: true },
        deviceId: 'device-1',
        deviceName: 'Phone',
        pluginScope: 'relay',
        workspaceFolder: '/workspace'
      })
    })
    const devices = await requestJson(baseUrl, '/api/relay/devices', {
      headers: authHeaders(userSessionToken)
    })
    const rawStore = await readFile(args.dataPath, 'utf8')
    const store = await readRelayStore(args.dataPath)

    expect(registered.response.status).toBe(200)
    expect(registered.body.device).toMatchObject({
      capabilities: { sessions: true },
      id: 'device-1',
      name: 'Phone',
      pluginScope: 'relay',
      userId: 'user-1',
      workspaceFolder: '/workspace'
    })
    expect(registered.body.device).not.toHaveProperty('deviceToken')
    expect(typeof registered.body.deviceToken).toBe('string')
    expect(devices.response.status).toBe(200)
    expect(devices.body.devices).toMatchObject([
      {
        id: 'device-1',
        name: 'Phone',
        userId: 'user-1'
      }
    ])
    expect(store.invites[0].used).toBe(1)
    expect(store.devices[0]).toMatchObject({
      deviceTokenHash: expect.stringMatching(/^sha256:/),
      encryptedMetadata: expect.objectContaining({ algorithm: 'aes-256-gcm' }),
      id: 'device-1',
      userId: 'user-1'
    })
    expect(store.devices[0]).not.toHaveProperty('deviceToken')
    expect(rawStore).not.toContain('Phone')
    expect(rawStore).not.toContain('/workspace')
    expect(rawStore).not.toContain('pluginScope')
  })

  it('allows a registered device token to refresh after the invite is consumed', async () => {
    const { args, baseUrl } = await listenRelay()
    await createInvite(args.dataPath, 'pair-once')
    const firstRegistration = await requestJson(baseUrl, '/api/relay/devices/register', {
      method: 'POST',
      headers: authHeaders('pair-once'),
      body: JSON.stringify({ deviceId: 'device-1', deviceName: 'First Name' })
    })
    const secondRegistration = await requestJson(baseUrl, '/api/relay/devices/register', {
      method: 'POST',
      headers: authHeaders(String(firstRegistration.body.deviceToken)),
      body: JSON.stringify({ deviceId: 'device-1', deviceName: 'Updated Name' })
    })
    const store = await readRelayStore(args.dataPath)

    expect(firstRegistration.response.status).toBe(200)
    expect(secondRegistration.response.status).toBe(200)
    expect(secondRegistration.body.device).toMatchObject({
      id: 'device-1',
      name: 'Updated Name'
    })
    expect(secondRegistration.body.deviceToken).toBe(firstRegistration.body.deviceToken)
    expect(store.invites[0].used).toBe(1)
    expect(store.devices).toHaveLength(1)
  })

  it('allows a registered device token to list devices for the same user', async () => {
    const { args, baseUrl } = await listenRelay()
    await createInvite(args.dataPath, 'pair-account')
    const firstRegistration = await requestJson(baseUrl, '/api/relay/devices/register', {
      method: 'POST',
      headers: authHeaders('pair-account'),
      body: JSON.stringify({ deviceId: 'device-1', deviceName: 'Office Mac' })
    })
    const secondRegistration = await requestJson(baseUrl, '/api/relay/devices/register', {
      method: 'POST',
      headers: authHeaders(userSessionToken),
      body: JSON.stringify({ deviceId: 'device-2', deviceName: 'Desk Mini' })
    })

    const devices = await requestJson(baseUrl, '/api/relay/devices', {
      headers: authHeaders(String(firstRegistration.body.deviceToken))
    })

    expect(firstRegistration.response.status).toBe(200)
    expect(secondRegistration.response.status).toBe(200)
    expect(devices.response.status).toBe(200)
    expect(devices.body.devices).toMatchObject([
      { id: 'device-1', name: 'Office Mac', userId: 'user-1' },
      { id: 'device-2', name: 'Desk Mini', userId: 'user-1' }
    ])
    expect(JSON.stringify(devices.body.devices)).not.toContain('deviceToken')
  })

  it('stores account-scoped device aliases without replacing the machine name', async () => {
    const { args, baseUrl } = await listenRelay()
    await createInvite(args.dataPath, 'pair-alias')
    const registered = await requestJson(baseUrl, '/api/relay/devices/register', {
      method: 'POST',
      headers: authHeaders('pair-alias'),
      body: JSON.stringify({ deviceId: 'device-1', deviceName: 'YiJie-MBP-14.local' })
    })
    const aliasUpdate = await requestJson(baseUrl, '/api/relay/devices/device-1', {
      method: 'PATCH',
      headers: authHeaders(userSessionToken),
      body: JSON.stringify({ alias: 'Studio Laptop' })
    })
    const heartbeat = await requestJson(baseUrl, '/api/relay/devices/heartbeat', {
      method: 'POST',
      headers: authHeaders(String(registered.body.deviceToken)),
      body: JSON.stringify({ deviceName: 'YiJie-MBP-14.local', workspaceFolder: '/workspace-a' })
    })
    const devices = await requestJson(baseUrl, '/api/relay/devices', {
      headers: authHeaders(userSessionToken)
    })
    const rawStore = await readFile(args.dataPath, 'utf8')

    expect(registered.response.status).toBe(200)
    expect(aliasUpdate.response.status).toBe(200)
    expect(aliasUpdate.body.device).toMatchObject({
      alias: 'Studio Laptop',
      id: 'device-1',
      name: 'YiJie-MBP-14.local'
    })
    expect(heartbeat.body.device).toMatchObject({
      alias: 'Studio Laptop',
      name: 'YiJie-MBP-14.local',
      workspaceFolder: '/workspace-a'
    })
    expect(devices.body.devices).toMatchObject([
      {
        alias: 'Studio Laptop',
        id: 'device-1',
        name: 'YiJie-MBP-14.local'
      }
    ])
    expect(rawStore).not.toContain('Studio Laptop')
  })

  it('binds device registration to a logged-in SSO session user', async () => {
    const { args, baseUrl } = await listenRelay()
    const store = await readRelayStore(args.dataPath)
    const now = new Date().toISOString()
    store.users.push({
      avatarUrl: 'https://example.com/avatar.png',
      id: 'member-user',
      email: 'member@example.com',
      name: 'Member',
      provider: 'google',
      providerUserId: 'google-member',
      role: 'member',
      createdAt: now
    })
    store.sessions.push({
      token: 'member-session-token',
      userId: 'member-user',
      createdAt: now,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      lastSeenAt: now
    })
    await writeRelayStore(args.dataPath, store)

    const registered = await requestJson(baseUrl, '/api/relay/devices/register', {
      method: 'POST',
      headers: authHeaders('member-session-token'),
      body: JSON.stringify({
        deviceId: 'member-device',
        deviceName: 'Member Phone'
      })
    })
    const nextStore = await readRelayStore(args.dataPath)

    expect(registered.response.status).toBe(200)
    expect(registered.body.device).toMatchObject({
      id: 'member-device',
      name: 'Member Phone',
      userId: 'member-user'
    })
    expect(registered.body.user).toMatchObject({
      avatarUrl: 'https://example.com/avatar.png',
      email: 'member@example.com',
      id: 'member-user',
      name: 'Member'
    })
    expect(nextStore.devices[0]).toMatchObject({
      id: 'member-device',
      userId: 'member-user'
    })
  })

  it('rejects device registration without a valid pairing token', async () => {
    const { baseUrl } = await listenRelay()
    const registered = await requestJson(baseUrl, '/api/relay/devices/register', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ deviceId: 'device-1' })
    })

    expect(registered.response.status).toBe(401)
    expect(registered.body).toEqual({ error: 'Invalid pairing token.' })
  })

  it('refreshes device heartbeat metadata with a device token', async () => {
    const { args, baseUrl } = await listenRelay()
    await createInvite(args.dataPath, 'pair-heartbeat')
    const registered = await requestJson(baseUrl, '/api/relay/devices/register', {
      method: 'POST',
      headers: authHeaders('pair-heartbeat'),
      body: JSON.stringify({
        capabilities: { sessions: true },
        deviceId: 'device-1',
        workspaceFolder: '/workspace'
      })
    })
    const staleStore = await readRelayStore(args.dataPath)
    staleStore.devices[0].lastSeenAt = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    await writeRelayStore(args.dataPath, staleStore)

    const heartbeat = await requestJson(baseUrl, '/api/relay/devices/heartbeat', {
      method: 'POST',
      headers: authHeaders(String(registered.body.deviceToken)),
      body: JSON.stringify({
        capabilities: { sessions: true, terminal: true },
        pluginScope: 'relay',
        workspaceFolder: '/workspace-next'
      })
    })
    const store = await readRelayStore(args.dataPath)

    expect(heartbeat.response.status).toBe(200)
    expect(heartbeat.body).toMatchObject({
      ok: true,
      device: {
        capabilities: { sessions: true, terminal: true },
        id: 'device-1',
        pluginScope: 'relay',
        status: 'online',
        workspaceFolder: '/workspace-next'
      }
    })
    expect(heartbeat.body.device).not.toHaveProperty('deviceToken')
    expect(Date.parse(store.devices[0].lastSeenAt)).toBeGreaterThan(Date.parse(staleStore.devices[0].lastSeenAt))
    expect(store.devices[0]).toMatchObject({
      deviceTokenHash: expect.stringMatching(/^sha256:/),
      encryptedMetadata: expect.objectContaining({ algorithm: 'aes-256-gcm' })
    })
    expect(store.devices[0]).not.toHaveProperty('deviceToken')
    expect(store.devices[0]).not.toHaveProperty('capabilities')
    expect(store.devices[0]).not.toHaveProperty('workspaceFolder')
  })

  it('stores structured device environment and management server IP in private metadata', async () => {
    const { args, baseUrl } = await listenRelay()
    await createInvite(args.dataPath, 'pair-env')

    const registered = await requestJson(baseUrl, '/api/relay/devices/register', {
      method: 'POST',
      headers: {
        ...authHeaders('pair-env'),
        'x-forwarded-for': '203.0.113.10, 10.0.0.10'
      },
      body: JSON.stringify({
        deviceId: 'device-env',
        deviceInfo: {
          arch: 'arm64',
          deviceType: 'computer',
          ignored: 'do-not-store',
          os: {
            name: 'macOS',
            platform: 'darwin',
            release: '23.6.0',
            version: '14.6.1'
          },
          runtime: {
            kind: 'node',
            version: '22.0.0'
          }
        },
        deviceName: 'Studio Mac',
        managementServer: {
          environment: {
            osPlatform: 'darwin',
            runtime: 'electron',
            runtimeVersion: '31.0.0',
            secret: 'drop-me'
          },
          id: 'electron-main',
          kind: 'electron',
          name: 'Electron Main'
        }
      })
    })

    const heartbeat = await requestJson(baseUrl, '/api/relay/devices/heartbeat', {
      method: 'POST',
      headers: {
        ...authHeaders(String(registered.body.deviceToken)),
        'x-forwarded-for': '198.51.100.25'
      },
      body: JSON.stringify({
        deviceId: 'device-env',
        deviceInfo: {
          osRelease: '23.6.1'
        },
        managementServer: {
          environment: {
            osRelease: '23.6.1',
            runtimeVersion: '31.1.0'
          },
          id: 'electron-main'
        }
      })
    })
    const devices = await requestJson(baseUrl, '/api/relay/devices', {
      headers: authHeaders(userSessionToken)
    })
    const rawStore = await readFile(args.dataPath, 'utf8')
    const [device] = devices.body.devices as Array<Record<string, unknown>>
    const [managementServer] = device.managementServers as Array<Record<string, unknown>>

    expect(registered.response.status).toBe(200)
    expect(heartbeat.response.status).toBe(200)
    expect(device).toMatchObject({
      deviceInfo: {
        arch: 'arm64',
        deviceType: 'computer',
        osName: 'macOS',
        osPlatform: 'darwin',
        osRelease: '23.6.1',
        osVersion: '14.6.1',
        runtime: 'node',
        runtimeVersion: '22.0.0'
      },
      id: 'device-env',
      lastSeenIp: '198.51.100.25',
      registeredIp: '203.0.113.10',
      name: 'Studio Mac'
    })
    expect(device.deviceInfo).not.toHaveProperty('ignored')
    expect(managementServer).toMatchObject({
      environment: {
        osPlatform: 'darwin',
        osRelease: '23.6.1',
        runtime: 'electron',
        runtimeVersion: '31.1.0'
      },
      id: 'electron-main',
      kind: 'electron',
      lastSeenIp: '198.51.100.25',
      name: 'Electron Main',
      registeredIp: '203.0.113.10'
    })
    expect(managementServer.environment).not.toHaveProperty('secret')
    expect(rawStore).not.toContain('Studio Mac')
    expect(rawStore).not.toContain('203.0.113.10')
    expect(rawStore).not.toContain('198.51.100.25')
    expect(rawStore).not.toContain('macOS')
  })

  it('keeps multiple management servers under the same real device without replacing other devices', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'oneworks-relay-device-workspaces-'))
    const workspaceA = join(workspaceRoot, 'workspace-a')
    const workspaceB = join(workspaceRoot, 'workspace-b')
    const workspaceC = join(workspaceRoot, 'workspace-c')
    const workspaceD = join(workspaceRoot, 'workspace-d')
    await mkdir(workspaceA, { recursive: true })
    await mkdir(workspaceB, { recursive: true })
    await mkdir(workspaceC, { recursive: true })
    await mkdir(workspaceD, { recursive: true })
    const { args, baseUrl } = await listenRelay()
    try {
      await createInvite(args.dataPath, 'pair-management')
      const firstRegistration = await requestJson(baseUrl, '/api/relay/devices/register', {
        method: 'POST',
        headers: authHeaders('pair-management'),
        body: JSON.stringify({
          capabilities: { sessions: true },
          deviceId: 'system-user-device',
          deviceName: 'Studio Mac',
          managementServer: {
            id: 'daemon-main',
            kind: 'daemon',
            name: 'Daemon Service',
            projects: [{
              id: 'workspace-a',
              title: 'workspace-a',
              workspaceFolder: workspaceA
            }]
          },
          pluginScope: 'relay',
          workspaceFolder: workspaceA
        })
      })
      const secondRegistration = await requestJson(baseUrl, '/api/relay/devices/register', {
        method: 'POST',
        headers: authHeaders(userSessionToken),
        body: JSON.stringify({
          deviceId: 'remote-user-device',
          deviceName: 'Remote Linux',
          managementServerId: 'web-main',
          managementServerKind: 'web',
          managementServerName: 'Web Session',
          managementServerProjects: [{
            id: 'workspace-c',
            title: 'workspace-c',
            workspaceFolder: workspaceC
          }],
          pluginScope: 'relay',
          workspaceFolder: workspaceC
        })
      })
      const daemonProjectHeartbeat = await requestJson(baseUrl, '/api/relay/devices/heartbeat', {
        method: 'POST',
        headers: authHeaders(String(firstRegistration.body.deviceToken)),
        body: JSON.stringify({
          deviceId: 'system-user-device',
          managementServerId: 'daemon-main',
          managementServerKind: 'daemon',
          managementServerName: 'Daemon Service',
          managementServerProjects: [{
            id: 'workspace-d',
            title: 'workspace-d',
            workspaceFolder: workspaceD
          }],
          pluginScope: 'relay',
          workspaceFolder: workspaceD
        })
      })
      const daemonDuplicateProjectHeartbeat = await requestJson(baseUrl, '/api/relay/devices/heartbeat', {
        method: 'POST',
        headers: authHeaders(String(firstRegistration.body.deviceToken)),
        body: JSON.stringify({
          deviceId: 'system-user-device',
          managementServerId: 'daemon-main',
          managementServerKind: 'daemon',
          managementServerName: 'Daemon Service',
          managementServerProjects: [{
            id: 'workspace-d-renamed',
            title: 'workspace-d renamed',
            workspaceFolder: workspaceD
          }],
          pluginScope: 'relay',
          workspaceFolder: workspaceD
        })
      })
      const heartbeat = await requestJson(baseUrl, '/api/relay/devices/heartbeat', {
        method: 'POST',
        headers: authHeaders(String(firstRegistration.body.deviceToken)),
        body: JSON.stringify({
          deviceId: 'system-user-device',
          managementServerId: 'electron-dev',
          managementServerKind: 'electron',
          managementServerName: 'Electron Dev',
          managementServerProjects: [{
            id: 'workspace-b',
            title: 'workspace-b',
            workspaceFolder: workspaceB
          }],
          pluginScope: 'relay',
          workspaceFolder: workspaceB
        })
      })
      const devices = await requestJson(baseUrl, '/api/relay/devices', {
        headers: authHeaders(userSessionToken)
      })
      const rawStore = await readFile(args.dataPath, 'utf8')
      const listedDevices = devices.body.devices as Array<Record<string, unknown>>
      const localDevice = listedDevices.find(device => device.id === 'system-user-device')
      const remoteDevice = listedDevices.find(device => device.id === 'remote-user-device')
      const localManagementServers = localDevice?.managementServers as Array<Record<string, unknown>> | undefined
      const remoteManagementServers = remoteDevice?.managementServers as Array<Record<string, unknown>> | undefined

      expect(firstRegistration.response.status).toBe(200)
      expect(secondRegistration.response.status).toBe(200)
      expect(daemonProjectHeartbeat.response.status).toBe(200)
      expect(daemonDuplicateProjectHeartbeat.response.status).toBe(200)
      expect(heartbeat.response.status).toBe(200)
      expect(devices.response.status).toBe(200)
      expect(localDevice).toMatchObject({
        id: 'system-user-device',
        name: 'Studio Mac',
        status: 'online',
        workspaceFolder: workspaceB
      })
      expect(localManagementServers).toHaveLength(2)
      expect(localManagementServers).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'electron-dev',
          kind: 'electron',
          name: 'Electron Dev',
          projects: [
            expect.objectContaining({
              id: 'workspace-b',
              status: 'online',
              workspaceFolder: workspaceB
            })
          ],
          status: 'online',
          workspaceFolder: workspaceB
        }),
        expect.objectContaining({
          id: 'daemon-main',
          kind: 'daemon',
          name: 'Daemon Service',
          projects: expect.arrayContaining([
            expect.objectContaining({
              id: 'workspace-a',
              status: 'online',
              workspaceFolder: workspaceA
            }),
            expect.objectContaining({
              id: 'workspace-d',
              status: 'online',
              workspaceFolder: workspaceD
            })
          ]),
          status: 'online',
          workspaceFolder: workspaceD
        })
      ]))
      const daemonProjects = localManagementServers
        ?.find(server => server.id === 'daemon-main')
        ?.projects as Array<Record<string, unknown>> | undefined
      expect(daemonProjects?.filter(project => project.workspaceFolder === workspaceD)).toHaveLength(1)
      expect(daemonProjects?.map(project => project.workspaceFolder).sort()).toEqual([
        workspaceA,
        workspaceD
      ].sort())
      expect(remoteDevice).toMatchObject({
        id: 'remote-user-device',
        name: 'Remote Linux',
        status: 'online'
      })
      expect(remoteManagementServers).toEqual([
        expect.objectContaining({
          id: 'web-main',
          kind: 'web',
          name: 'Web Session',
          projects: [
            expect.objectContaining({
              id: 'workspace-c',
              status: 'online',
              workspaceFolder: workspaceC
            })
          ],
          status: 'online',
          workspaceFolder: workspaceC
        })
      ])
      expect(rawStore).not.toContain('Daemon Service')
      expect(rawStore).not.toContain('Electron Dev')
      expect(rawStore).not.toContain('Remote Linux')
      expect(rawStore).not.toContain(workspaceB)
      expect(rawStore).not.toContain(workspaceD)
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('rejects device heartbeat with an invalid device token', async () => {
    const { args, baseUrl } = await listenRelay()
    await createInvite(args.dataPath, 'pair-heartbeat')
    await requestJson(baseUrl, '/api/relay/devices/register', {
      method: 'POST',
      headers: authHeaders('pair-heartbeat'),
      body: JSON.stringify({ deviceId: 'device-1' })
    })

    const heartbeat = await requestJson(baseUrl, '/api/relay/devices/heartbeat', {
      method: 'POST',
      headers: authHeaders('wrong-token'),
      body: JSON.stringify({ deviceId: 'device-1' })
    })

    expect(heartbeat.response.status).toBe(401)
    expect(heartbeat.body).toEqual({ error: 'Invalid device token.' })
  })

  it('derives online stale and offline device statuses from heartbeat age', async () => {
    const { args, baseUrl } = await listenRelay({ deviceOnlineTtlMs: 10_000 })
    const nowMs = Date.now()
    const store = await readRelayStore(args.dataPath)
    store.users.push({
      createdAt: new Date().toISOString(),
      email: 'user-1@example.com',
      id: 'user-1',
      name: 'User 1',
      role: 'member'
    })
    store.sessions.push({
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      lastSeenAt: new Date().toISOString(),
      token: userSessionToken,
      userId: 'user-1'
    })
    store.devices = [
      createDevice({
        id: 'online-device',
        lastSeenAt: new Date(nowMs - 1000).toISOString(),
        name: 'Online',
        userId: 'user-1'
      }),
      createDevice({
        id: 'stale-device',
        lastSeenAt: new Date(nowMs - 15_000).toISOString(),
        name: 'Stale',
        userId: 'user-1'
      }),
      createDevice({
        id: 'offline-device',
        lastSeenAt: new Date(nowMs - 35_000).toISOString(),
        name: 'Offline',
        userId: 'user-1'
      })
    ]
    await writeRelayStore(args.dataPath, store)

    const devices = await requestJson(baseUrl, '/api/relay/devices', {
      headers: authHeaders(userSessionToken)
    })

    expect(devices.response.status).toBe(200)
    const listedDevices = devices.body.devices as Array<Record<string, unknown>>
    expect(listedDevices).toMatchObject([
      { id: 'online-device', status: 'online' },
      { id: 'stale-device', status: 'stale' },
      { id: 'offline-device', status: 'offline' }
    ])
    expect(listedDevices[0]).not.toHaveProperty('deviceInfo')
  })

  it('includes login source IP metadata in message API responses', async () => {
    const { baseUrl } = await listenRelay()
    const created = await requestJson(baseUrl, '/api/admin/users', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({
        email: 'login-record@example.com',
        loginId: 'login-record',
        name: 'Login Record',
        password: 'correct-password',
        role: 'member'
      })
    })
    const login = await requestJson(baseUrl, '/api/auth/password-login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Vitest Browser',
        'x-forwarded-for': '203.0.113.10, 10.0.0.10',
        'x-vercel-ip-city': 'Shanghai',
        'x-vercel-ip-country': 'CN'
      },
      body: JSON.stringify({
        loginId: 'login-record',
        password: 'correct-password'
      })
    })
    const token = String(login.body.token)
    const messages = await requestJson(baseUrl, '/api/admin/messages', {
      headers: authHeaders(token)
    })
    const loginMessages = messages.body.messages as Array<Record<string, unknown>>
    const loginMessage = loginMessages.find(message => message.title === '新设备登录提醒')

    expect(created.response.status).toBe(200)
    expect(login.response.status).toBe(200)
    expect(messages.response.status).toBe(200)
    expect(loginMessage).toMatchObject({
      body: expect.stringContaining('203.0.113.10'),
      metadata: {
        login: {
          ip: '203.0.113.10',
          location: 'Shanghai CN',
          userAgent: 'Vitest Browser'
        }
      }
    })
  })

  it('exposes device counts to admins and enforces per-user device limits', async () => {
    const { args, baseUrl } = await listenRelay()
    const store = await readRelayStore(args.dataPath)
    const timestamp = new Date().toISOString()
    store.users.push({
      createdAt: timestamp,
      email: 'limited@example.com',
      id: 'limited-user',
      maxDevices: 1,
      name: 'Limited',
      role: 'member'
    })
    store.sessions.push({
      createdAt: timestamp,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      lastSeenAt: timestamp,
      token: 'limited-session-token',
      userId: 'limited-user'
    })
    await writeRelayStore(args.dataPath, store)

    const first = await requestJson(baseUrl, '/api/relay/devices/register', {
      method: 'POST',
      headers: authHeaders('limited-session-token'),
      body: JSON.stringify({ deviceId: 'limited-device-1', deviceName: 'Limited One' })
    })
    const second = await requestJson(baseUrl, '/api/relay/devices/register', {
      method: 'POST',
      headers: authHeaders('limited-session-token'),
      body: JSON.stringify({ deviceId: 'limited-device-2', deviceName: 'Limited Two' })
    })
    const users = await requestJson(baseUrl, '/api/admin/users', {
      headers: authHeaders('admin-token')
    })

    expect(first.response.status).toBe(200)
    expect(second.response.status).toBe(403)
    expect(second.body).toEqual({ error: 'Device limit reached.' })
    expect(users.body.users).toMatchObject([
      {
        deviceCount: 1,
        id: 'limited-user',
        maxDevices: 1
      }
    ])
  })
})
