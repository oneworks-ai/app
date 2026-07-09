import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createDeviceInvite as createInvite, userSessionToken } from './device-fixtures.js'
import { authHeaders, cleanupRelayFixtures, listenRelay, requestJson } from './helpers.js'

afterEach(cleanupRelayFixtures)

describe('relay server device management metadata', () => {
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
})
