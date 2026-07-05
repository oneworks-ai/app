import type { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { emptyOneWorksAuthStore, writeOneWorksAuthStore } from '@oneworks/utils/auth-store'
import { vi } from 'vitest'

import { activatePlugin } from '../src/server/index.js'
import type { RelayLocalSessionAdapter } from '../src/server/session-types.js'
import type { RelayConfigDistributionStatus } from '../src/server/types.js'

export type CommandHandler = (payload?: unknown) => unknown | Promise<unknown>
export type ApiHandler = (request: { body: Buffer; method: string; path: string }) => unknown | Promise<unknown>
export type ApiRegistration = Record<string, unknown> & { handler?: ApiHandler }

export interface RelayPluginStatus {
  configDistribution?: {
    allowedFields?: string[]
    hash?: string | null
    lastAppliedAt?: string | null
    lastError?: string | null
    lastSyncedAt?: string | null
    matchedProject?: boolean | string | null
    modelServiceKeys?: string[]
    sourceServerId?: string | null
    sources?: Array<{
      assignmentId?: string
      disabledBy?: string[]
      enabled?: boolean
      profileId?: string
      profileName?: string
      teamId?: string
      teamName?: string
    }>
    version?: string | null
  }
  connection: {
    activeServerId?: string
    lastError: string | null
    remoteBaseUrl?: string
    state: string
  }
  device: {
    hasToken: boolean
  }
  options?: {
    activeServerId?: string
    servers?: Array<{
      id: string
      pairingTokenConfigured?: boolean
      remoteBaseUrl: string
    }>
  }
  servers?: Array<{
    account?: {
      avatarUrl?: string
      email?: string
      name?: string
    }
    active?: boolean
    connected?: boolean
    connection?: {
      activeServerId?: string
      lastConnectedAt?: string | null
      lastError?: string | null
      message?: string
      remoteBaseUrl?: string
      state?: string
    }
    devices?: Array<{
      capabilities?: Record<string, unknown>
      id?: string
      name?: string
      status?: string
      workspaceFolder?: string
    }>
    devicesError?: string
    hasToken?: boolean
    id: string
    name?: string
    remoteBaseUrl: string
    sessionAuthenticated?: boolean
    sessionExpiresAt?: string | null
  }>
}

const tempDirs: string[] = []
const tempDisposers: Array<() => void> = []

const removeTempDir = async (dir: string) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true })
      return
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOTEMPTY'
        ) ||
        attempt === 2
      ) {
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
}

export const cleanupPluginFixtures = async () => {
  for (const dispose of tempDisposers.splice(0)) {
    dispose()
  }
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(removeTempDir))
}

export const createPluginHarness = async (
  options: Record<string, unknown>,
  harnessOptions: {
    configDistribution?: {
      getStatus?: () => RelayConfigDistributionStatus | Promise<RelayConfigDistributionStatus>
      refresh?: () => RelayConfigDistributionStatus | Promise<RelayConfigDistributionStatus>
    }
    prepareProjectHome?: (projectHome: string) => Promise<void> | void
    sessions?: RelayLocalSessionAdapter
  } = {}
) => {
  const projectHome = await mkdtemp(join(tmpdir(), 'oneworks-relay-plugin-test-'))
  const homeDir = await mkdtemp(join(tmpdir(), 'oneworks-relay-plugin-home-'))
  tempDirs.push(projectHome)
  tempDirs.push(homeDir)
  vi.stubEnv('HOME', homeDir)
  vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', homeDir)
  vi.stubEnv('__ONEWORKS_RELAY_LOOP_LEASE_ROOT__', join(homeDir, 'relay-loop-leases'))
  await writeOneWorksAuthStore(emptyOneWorksAuthStore())
  await harnessOptions.prepareProjectHome?.(projectHome)
  const commands = new Map<string, CommandHandler>()
  const apis = new Map<string, ApiRegistration>()
  const disposers: Array<() => void> = []
  tempDisposers.push(() => {
    for (const dispose of disposers.splice(0)) {
      dispose()
    }
  })
  const logger = {
    warn: vi.fn()
  }

  activatePlugin({
    scope: 'relay',
    workspaceFolder: '/workspace',
    projectHome,
    options,
    configDistribution: harnessOptions.configDistribution,
    logger,
    registerCommand: (commandId: string, handler: CommandHandler) => commands.set(commandId, handler),
    registerApi: (apiId: string, api: ApiRegistration) => apis.set(apiId, api),
    dispose: (callback: () => void) => {
      let disposed = false
      disposers.push(() => {
        if (disposed) return
        disposed = true
        callback()
      })
    },
    sessions: harnessOptions.sessions
  } as never)

  return {
    apis,
    commands,
    disposers,
    homeDir,
    logger,
    projectHome
  }
}

export const readDeviceStore = async (projectHome: string) =>
  JSON.parse(
    await readFile(join(projectHome, '.local/plugins/relay/device.json'), 'utf8')
  ) as Record<string, unknown>

export const readConfigSnapshot = async (projectHome: string) =>
  JSON.parse(
    await readFile(join(projectHome, '.local/plugins/relay/config-snapshot.json'), 'utf8')
  ) as Record<string, unknown>

export const createRelayConfigSnapshotFixture = () => ({
  assignments: [
    {
      id: 'base',
      allowedFields: ['modelServices', 'recommendedModels'],
      configPatch: {
        modelServices: {
          'relay-assigned': {
            apiBaseUrl: 'https://relay.example/v1',
            models: ['relay-model']
          }
        },
        permissions: {
          allow: ['not-safe']
        },
        recommendedModels: [
          {
            model: 'relay-model',
            service: 'relay-assigned'
          }
        ]
      },
      project: {
        allow: ['workspace']
      },
      provenance: {
        assignmentId: 'base',
        fields: ['modelServices', 'recommendedModels'],
        mode: 'default',
        profileId: 'profile-1',
        profileName: 'Base Profile',
        teamId: 'team-1',
        teamName: 'Team One',
        version: 1,
        versionId: 'version-1'
      }
    }
  ],
  hash: 'snapshot-hash',
  team: {
    id: 'team-1',
    name: 'Team One'
  },
  updatedAt: '2026-06-15T00:00:00.000Z',
  version: 'snapshot-v1'
})

export const stubRelayFetch = (deviceToken = 'remote-device-token') => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input)
    const body = url.endsWith('/api/relay/config-snapshot')
      ? createRelayConfigSnapshotFixture()
      : url.endsWith('/api/relay/config/global')
      ? {
        personalConfigSnapshot: null
      }
      : url.endsWith('/api/auth/me')
      ? {
        session: {
          expiresAt: '2999-01-01T00:00:00.000Z',
          lastSeenAt: '2026-06-15T00:00:00.000Z'
        },
        user: {
          avatarUrl: '',
          email: 'owner@local.test',
          id: 'owner',
          name: 'Owner Local',
          provider: 'local',
          role: 'owner'
        }
      }
      : url.endsWith('/api/relay/devices')
      ? {
        devices: [{
          capabilities: { sessions: true, terminal: true, workspaceFiles: false },
          id: 'device-1',
          name: 'Office Mac',
          status: 'online',
          workspaceFolder: '/workspace'
        }]
      }
      : url.endsWith('/api/admin/messages')
      ? {
        invitations: [{
          configEnabled: true,
          createdAt: '2026-06-17T09:20:00.000Z',
          createdByUserId: 'admin-1',
          defaultForPublishing: false,
          email: 'owner@local.test',
          groupIds: ['team:member'],
          id: 'invite-1',
          inviter: {
            avatarUrl: null,
            email: 'admin@example.com',
            id: 'admin-1',
            name: 'Relay Admin',
            provider: null,
            role: 'admin'
          },
          respondedAt: null,
          role: 'member',
          status: 'pending',
          teamAvatarUrl: null,
          teamId: 'team-1',
          teamName: 'Relay Demo Team',
          teamSlug: 'relay-demo-team',
          updatedAt: null,
          user: null,
          userId: 'owner'
        }],
        messages: [{
          audience: {
            scope: 'users',
            team: null,
            teamId: null,
            userIds: ['owner'],
            users: []
          },
          body: '你的账号刚刚在新设备完成登录。',
          createdAt: '2026-06-17T09:12:00.000Z',
          createdBy: null,
          createdByUserId: 'system',
          id: 'message-1',
          kind: 'personal',
          title: '新设备登录提醒',
          updatedAt: null
        }]
      }
      : {
        deviceToken,
        user: {
          avatarUrl: '',
          email: 'owner@local.test',
          id: 'owner',
          name: 'Owner Local',
          provider: 'local',
          role: 'owner'
        }
      }
    return new Response(
      JSON.stringify(body),
      {
        headers: {
          'content-type': 'application/json'
        },
        status: 200
      }
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
