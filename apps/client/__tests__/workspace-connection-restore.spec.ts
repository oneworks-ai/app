import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getRestorableWorkspaceConnection } from '../src/workspace-connection-restore'

const mocks = vi.hoisted(() => ({
  getLauncherManagerServerBaseUrl: vi.fn(() => 'http://127.0.0.1:8798'),
  getLauncherRelayWorkspaceConnection: vi.fn(),
  getLauncherWorkspaceConnection: vi.fn(),
  openLauncherRelayWorkspace: vi.fn(),
  readRememberedWorkspaceConnectionMetadata: vi.fn()
}))

vi.mock('#~/api/launcher', () => ({
  getLauncherManagerServerBaseUrl: mocks.getLauncherManagerServerBaseUrl,
  getLauncherWorkspaceConnection: mocks.getLauncherWorkspaceConnection
}))
vi.mock('#~/api/launcher-relay', () => ({
  getLauncherRelayWorkspaceConnection: mocks.getLauncherRelayWorkspaceConnection,
  openLauncherRelayWorkspace: mocks.openLauncherRelayWorkspace
}))
vi.mock('#~/workspace-connection-state', () => ({
  readRememberedWorkspaceConnectionMetadata: mocks.readRememberedWorkspaceConnectionMetadata
}))

describe('workspace connection restore target isolation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not probe Relay when the remembered target is explicitly local', async () => {
    mocks.readRememberedWorkspaceConnectionMetadata.mockImplementation((_id, transport) =>
      transport === 'local'
        ? {
          managerServerBaseUrl: 'http://127.0.0.1:8798',
          serverBaseUrl: 'http://127.0.0.1:60090',
          transport: 'local',
          workspaceFolder: '/tmp/app',
          workspaceId: 'w_local0001'
        }
        : undefined
    )
    mocks.getLauncherWorkspaceConnection.mockResolvedValue({
      serverBaseUrl: 'http://127.0.0.1:60090',
      workspaceFolder: '/tmp/app',
      workspaceId: 'w_local0001'
    })

    await expect(getRestorableWorkspaceConnection('w_local0001')).resolves.toMatchObject({
      transport: 'local',
      connection: { serverBaseUrl: 'http://127.0.0.1:60090' }
    })
    expect(mocks.getLauncherRelayWorkspaceConnection).not.toHaveBeenCalled()
    expect(mocks.getLauncherWorkspaceConnection).toHaveBeenCalledOnce()
  })

  it('restores Relay only when Relay is the remembered transport', async () => {
    mocks.readRememberedWorkspaceConnectionMetadata.mockImplementation((_id, transport) =>
      transport === 'relay'
        ? {
          managerServerBaseUrl: 'http://127.0.0.1:8798',
          relay: { deviceId: 'device-1', serverId: 'relay-1', workspaceFolder: '/tmp/app' },
          serverBaseUrl: 'https://relay.example',
          transport: 'relay',
          workspaceFolder: '/tmp/app',
          workspaceId: 'w_remote001'
        }
        : undefined
    )
    mocks.getLauncherRelayWorkspaceConnection.mockResolvedValue({
      serverBaseUrl: 'https://relay.example',
      workspaceFolder: '/tmp/app',
      workspaceId: 'w_remote001'
    })

    await expect(getRestorableWorkspaceConnection('w_remote001')).resolves.toMatchObject({
      transport: 'relay',
      connection: { serverBaseUrl: 'https://relay.example' }
    })
    expect(mocks.getLauncherRelayWorkspaceConnection).toHaveBeenCalledOnce()
    expect(mocks.getLauncherWorkspaceConnection).not.toHaveBeenCalled()
  })
})
