import type { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
    }>
    devicesError?: string
    hasToken?: boolean
    id: string
    remoteBaseUrl: string
    sessionAuthenticated?: boolean
    sessionExpiresAt?: string | null
  }>
}

const tempDirs: string[] = []

export const cleanupPluginFixtures = async () => {
  vi.unstubAllGlobals()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
}

export const createPluginHarness = async (
  options: Record<string, unknown>,
  harnessOptions: {
    configDistribution?: {
      getStatus?: () => RelayConfigDistributionStatus | Promise<RelayConfigDistributionStatus>
      refresh?: () => RelayConfigDistributionStatus | Promise<RelayConfigDistributionStatus>
    }
    sessions?: RelayLocalSessionAdapter
  } = {}
) => {
  const projectHome = await mkdtemp(join(tmpdir(), 'oneworks-relay-plugin-test-'))
  tempDirs.push(projectHome)
  const commands = new Map<string, CommandHandler>()
  const apis = new Map<string, ApiRegistration>()
  const disposers: Array<() => void> = []
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
    dispose: (callback: () => void) => disposers.push(callback),
    sessions: harnessOptions.sessions
  } as never)

  return {
    apis,
    commands,
    disposers,
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
      allowedFields: ['modelServices', 'defaultModelService', 'recommendedModels'],
      configPatch: {
        defaultModelService: 'relay-assigned',
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
        fields: ['modelServices', 'defaultModelService', 'recommendedModels'],
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
          status: 'online'
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
