import type { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { vi } from 'vitest'

import { activatePlugin } from '../src/server/index.js'
import type { RelayLocalSessionAdapter } from '../src/server/session-types.js'

export type CommandHandler = (payload?: unknown) => unknown | Promise<unknown>
export type ApiHandler = (request: { body: Buffer; method: string; path: string }) => unknown | Promise<unknown>
export type ApiRegistration = Record<string, unknown> & { handler?: ApiHandler }

export interface RelayPluginStatus {
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

export const stubRelayFetch = (deviceToken = 'remote-device-token') => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input)
    const body = url.endsWith('/api/relay/devices')
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
