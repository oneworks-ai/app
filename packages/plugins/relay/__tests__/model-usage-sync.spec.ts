import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { syncRelayConfigSnapshot } from '../src/server/config-sync.js'
import type { ResolvedRelayServer } from '../src/server/options.js'
import type { RelayPluginContext, RelayStoredServer } from '../src/server/types.js'

const tempDirs: string[] = []

const createFixture = async () => {
  const homeDir = await mkdtemp(join(tmpdir(), 'oneworks-relay-model-usage-'))
  tempDirs.push(homeDir)
  vi.stubEnv('HOME', homeDir)
  vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', homeDir)
  const projectHome = join(homeDir, 'project-home')
  await mkdir(projectHome, { recursive: true })
  const configPath = join(homeDir, '.oneworks', '.oo.config.json')
  const server: ResolvedRelayServer = {
    id: 'local',
    name: 'Local Relay',
    official: false,
    pairingToken: '',
    pairingTokenConfigured: false,
    protocol: 'https',
    remoteBaseUrl: 'https://relay.example',
    server: 'relay.example'
  }
  const storedServer: RelayStoredServer = {
    deviceToken: 'device-token',
    id: server.id,
    remoteBaseUrl: server.remoteBaseUrl
  }
  const ctx = {
    logger: { warn: vi.fn() },
    projectHome,
    scope: 'relay',
    workspaceFolder: homeDir
  } as unknown as RelayPluginContext
  return { configPath, ctx, server, storedServer }
}

const jsonResponse = (value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    status: 200
  })

const dataReportingResponse = (modelUsageReporting: unknown, diagnosticEnabled = true) => ({
  diagnosticReporting: { defaultEnabled: true, enabled: diagnosticEnabled },
  modelUsageReporting
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

describe('relay model usage preference sync', () => {
  it('pulls an opted-out cloud preference into the app global config', async () => {
    const fixture = await createFixture()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input))
        if (url.pathname === '/api/profile/data-reporting-settings') {
          return jsonResponse(dataReportingResponse({
            personal: { enabled: false, updatedAt: '2026-08-09T10:00:00.000Z' },
            teams: []
          }, false))
        }
        if (url.pathname === '/api/relay/config-snapshot') {
          return jsonResponse({ assignments: [], version: 'snapshot-1' })
        }
        return jsonResponse({ personalConfigSnapshot: null })
      })
    )

    const result = await syncRelayConfigSnapshot(fixture)
    const config = JSON.parse(await readFile(fixture.configPath, 'utf8'))

    expect(result.personalModelUsageReporting).toMatchObject({
      appliedRemote: true,
      enabled: false,
      pushedLocal: false
    })
    expect(result.personalDiagnosticReporting).toMatchObject({
      appliedRemote: true,
      enabled: false,
      pushedLocal: false
    })
    expect(config.diagnostics.reporting).toEqual({
      enabled: false
    })
    expect(config.diagnostics.modelUsageReporting).toEqual({
      enabled: false,
      updatedAt: '2026-08-09T10:00:00.000Z'
    })
  })

  it('pushes a newer app preference to Relay and normalizes the server timestamp locally', async () => {
    const fixture = await createFixture()
    await mkdir(dirname(fixture.configPath), { recursive: true })
    await writeFile(
      fixture.configPath,
      JSON.stringify({
        diagnostics: {
          modelUsageReporting: {
            enabled: false,
            updatedAt: '2026-08-09T11:00:00.000Z'
          }
        }
      }),
      'utf8'
    )
    const patches: Record<string, unknown>[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input))
        if (url.pathname === '/api/profile/data-reporting-settings' && init?.method === 'PATCH') {
          patches.push(JSON.parse(String(init.body)))
          return jsonResponse(dataReportingResponse({
            personal: { enabled: false, updatedAt: '2026-08-09T11:00:01.000Z' },
            teams: []
          }))
        }
        if (url.pathname === '/api/profile/data-reporting-settings') {
          return jsonResponse(dataReportingResponse({
            personal: { enabled: true, updatedAt: '2026-08-09T10:00:00.000Z' },
            teams: []
          }))
        }
        if (url.pathname === '/api/relay/config-snapshot') {
          return jsonResponse({ assignments: [], version: 'snapshot-1' })
        }
        return jsonResponse({ personalConfigSnapshot: null })
      })
    )

    const result = await syncRelayConfigSnapshot(fixture)
    const config = JSON.parse(await readFile(fixture.configPath, 'utf8'))

    expect(patches).toEqual([{ personalEnabled: false }])
    expect(result.personalModelUsageReporting).toMatchObject({
      appliedRemote: false,
      enabled: false,
      pushedLocal: true
    })
    expect(config.diagnostics.modelUsageReporting.updatedAt).toBe('2026-08-09T11:00:01.000Z')
  })

  it('locks required teams and pushes newer optional-team member preferences', async () => {
    const fixture = await createFixture()
    await mkdir(dirname(fixture.configPath), { recursive: true })
    await writeFile(
      fixture.configPath,
      JSON.stringify({
        diagnostics: {
          modelUsageReporting: {
            enabled: true,
            teams: {
              'team-optional': {
                enabled: false,
                mode: 'optional',
                updatedAt: '2026-08-09T11:00:00.000Z',
                userCanControl: true
              }
            },
            updatedAt: '2026-08-09T10:00:00.000Z'
          }
        }
      }),
      'utf8'
    )
    const patches: Record<string, unknown>[] = []
    const remoteTeams = (optionalEnabled: boolean) => [
      {
        enabled: true,
        mode: 'required',
        name: 'Required Team',
        slug: 'required-team',
        teamId: 'team-required',
        updatedAt: '2026-08-09T10:00:00.000Z',
        userCanControl: false
      },
      {
        enabled: optionalEnabled,
        mode: 'optional',
        name: 'Optional Team',
        slug: 'optional-team',
        teamId: 'team-optional',
        updatedAt: optionalEnabled ? '2026-08-09T10:00:00.000Z' : '2026-08-09T11:00:01.000Z',
        userCanControl: true
      }
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input))
        if (url.pathname === '/api/profile/data-reporting-settings' && init?.method === 'PATCH') {
          patches.push(JSON.parse(String(init.body)))
          return jsonResponse(dataReportingResponse({
            personal: { enabled: true, updatedAt: '2026-08-09T10:00:00.000Z' },
            teams: remoteTeams(false)
          }))
        }
        if (url.pathname === '/api/profile/data-reporting-settings') {
          return jsonResponse(dataReportingResponse({
            personal: { enabled: true, updatedAt: '2026-08-09T10:00:00.000Z' },
            teams: remoteTeams(true)
          }))
        }
        if (url.pathname === '/api/relay/config-snapshot') {
          return jsonResponse({ assignments: [], version: 'snapshot-1' })
        }
        return jsonResponse({ personalConfigSnapshot: null })
      })
    )

    const result = await syncRelayConfigSnapshot(fixture)
    const config = JSON.parse(await readFile(fixture.configPath, 'utf8'))

    expect(patches).toEqual([{ teamEnabled: false, teamId: 'team-optional' }])
    expect(result.personalModelUsageReporting).toMatchObject({
      pushedLocal: true,
      teams: {
        'team-optional': { enabled: false, userCanControl: true },
        'team-required': { enabled: true, userCanControl: false }
      }
    })
    expect(config.diagnostics.modelUsageReporting.teams).toMatchObject({
      'team-optional': { enabled: false, mode: 'optional' },
      'team-required': { enabled: true, mode: 'required' }
    })
  })
})
