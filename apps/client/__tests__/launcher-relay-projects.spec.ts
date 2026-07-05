import { describe, expect, it } from 'vitest'

import {
  normalizeLauncherRelayDirectoryTargets,
  normalizeLauncherRelayProjectGroups
} from '#~/routes/launcher-relay-projects'

describe('launcher relay projects', () => {
  it('groups online remote workspaces by device', () => {
    expect(
      normalizeLauncherRelayProjectGroups({
        device: { id: 'current-device' },
        servers: [
          {
            connected: true,
            id: 'cf',
            name: 'Official',
            devices: [
              {
                capabilities: { sessions: true },
                id: 'current-device',
                name: 'This Mac',
                status: 'online',
                workspaceFolder: '/work/local'
              },
              {
                alias: 'Studio Laptop',
                capabilities: { sessions: true, workspaceLauncher: true },
                id: 'lab-device',
                name: 'Lab Linux',
                status: 'online',
                workspaceFolder: '/srv/projects/relay app'
              },
              {
                capabilities: { sessions: true },
                id: 'session-only-device',
                name: 'Session Only',
                status: 'online',
                workspaceFolder: '/srv/session-only'
              },
              {
                capabilities: { sessions: true },
                id: 'offline-device',
                name: 'Offline',
                status: 'offline',
                workspaceFolder: '/srv/offline'
              },
              {
                capabilities: { sessions: false },
                id: 'files-only-device',
                name: 'Files Only',
                status: 'online',
                workspaceFolder: '/srv/files'
              }
            ]
          }
        ]
      })
    ).toEqual([
      {
        deviceId: 'lab-device',
        deviceName: 'Studio Laptop',
        id: 'relay-device:lab-device',
        projects: [
          {
            deviceId: 'lab-device',
            deviceName: 'Studio Laptop',
            id: 'relay-project:cf:lab-device:%2Fsrv%2Fprojects%2Frelay%20app',
            name: 'relay app',
            serverId: 'cf',
            serverName: 'Official',
            workspaceFolder: '/srv/projects/relay app'
          }
        ]
      }
    ])
  })

  it('deduplicates the same device workspace across connected servers', () => {
    const groups = normalizeLauncherRelayProjectGroups({
      servers: [
        {
          active: true,
          id: 'cf',
          name: 'Official',
          devices: [{
            capabilities: { sessions: true, workspaceLauncher: true },
            id: 'device-1',
            name: 'Office Mac',
            status: 'online',
            workspaceFolder: '/workspace/app'
          }]
        },
        {
          connected: true,
          id: 'vc',
          name: 'Official-vc',
          devices: [{
            capabilities: { sessions: true, workspaceLauncher: true },
            id: 'device-1',
            name: 'Office Mac',
            status: 'online',
            workspaceFolder: '/workspace/app'
          }]
        }
      ]
    })

    expect(groups).toHaveLength(1)
    expect(groups[0]?.projects).toHaveLength(1)
    expect(groups[0]?.projects[0]?.serverId).toBe('cf')
    expect(groups[0]?.projects[0]?.serverName).toBe('Official')
  })

  it('uses authenticated relay servers that are only present in the auth store', () => {
    expect(
      normalizeLauncherRelayProjectGroups({
        device: { id: 'current-device' },
        servers: [
          {
            active: false,
            connected: false,
            devices: [{
              alias: 'Linux Docker Smoke',
              capabilities: { sessions: true, workspaceLauncher: true },
              id: 'docker-device',
              name: 'linux-remote-a',
              status: 'online',
              workspaceFolder: '/workspaces/linux-remote-a'
            }],
            id: 'http-127-0-0-1-48991',
            name: 'Docker Local',
            sessionAuthenticated: true
          }
        ]
      })
    ).toEqual([
      {
        deviceId: 'docker-device',
        deviceName: 'Linux Docker Smoke',
        id: 'relay-device:docker-device',
        projects: [
          {
            deviceId: 'docker-device',
            deviceName: 'Linux Docker Smoke',
            id: 'relay-project:http-127-0-0-1-48991:docker-device:%2Fworkspaces%2Flinux-remote-a',
            name: 'linux-remote-a',
            serverId: 'http-127-0-0-1-48991',
            serverName: 'Docker Local',
            workspaceFolder: '/workspaces/linux-remote-a'
          }
        ]
      }
    ])
  })

  it('creates remote directory targets only for online workspace launcher devices', () => {
    expect(
      normalizeLauncherRelayDirectoryTargets({
        device: { id: 'current-device' },
        servers: [
          {
            connected: true,
            id: 'local',
            name: 'Local',
            devices: [
              {
                alias: 'Docker Linux',
                capabilities: { sessions: true, workspaceLauncher: true },
                id: 'linux-device',
                name: 'linux-host',
                status: 'online',
                workspaceFolder: '/workspaces/linux-remote-a'
              },
              {
                capabilities: { sessions: true, workspaceLauncher: true },
                id: 'current-device',
                name: 'This Mac',
                status: 'online',
                workspaceFolder: '/Users/me/app'
              },
              {
                capabilities: { sessions: true },
                id: 'session-only',
                name: 'Session Only',
                status: 'online',
                workspaceFolder: '/workspaces/session-only'
              },
              {
                capabilities: { sessions: true, workspaceLauncher: true },
                id: 'offline-device',
                name: 'Offline',
                status: 'offline',
                workspaceFolder: '/workspaces/offline'
              }
            ]
          }
        ]
      })
    ).toEqual([
      {
        deviceId: 'linux-device',
        deviceName: 'Docker Linux',
        id: 'relay:local:linux-device',
        initialDirectory: '/workspaces/linux-remote-a',
        serverId: 'local',
        serverName: 'Local'
      }
    ])
  })
})
