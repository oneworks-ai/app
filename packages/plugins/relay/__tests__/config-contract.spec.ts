import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { RELAY_CONFIG_SAFE_FIELDS } from '../src/shared/config-assignment-types.js'
import { resolveRelayConfigPatchForProject } from '../src/shared/config-assignment.js'
import type { RelayConfigSnapshot } from '../src/shared/config-assignment.js'
import { createRelayConfigSnapshotStore } from '../src/shared/config-cache.js'

const tempDirs: string[] = []

const createRelayConfigSnapshotFixture = (workspaceFolder: string): RelayConfigSnapshot => ({
  version: '2026.06.15-smoke',
  hash: 'sha256:relay-config-smoke',
  lastError: null,
  lastSyncedAt: '2026-06-15T00:00:00.000Z',
  sourceServerId: 'corp',
  updatedAt: '2026-06-15T00:00:00.000Z',
  assignments: [
    {
      id: 'matching-workspace',
      allowedFields: ['defaultModelService', 'modelServices'],
      project: {
        allow: [workspaceFolder]
      },
      configPatch: {
        defaultModelService: 'relay-smoke',
        env: {
          RELAY_FORBIDDEN_ENV: 'must-not-merge'
        },
        mcpServers: {
          forbidden: {
            args: ['must-not-merge'],
            command: 'echo'
          }
        },
        modelServices: {
          'relay-smoke': {
            apiBaseUrl: 'https://relay.example.com/v1',
            apiKey: 'relay-secret',
            models: ['relay-smoke-model'],
            title: 'Relay smoke service'
          }
        },
        plugins: [
          {
            id: '@oneworks/plugin-forbidden'
          }
        ],
        recommendedModels: [{ model: 'blocked-by-allowed-fields' }]
      }
    },
    {
      id: 'non-matching-workspace',
      allowedFields: ['defaultModelService', 'modelServices'],
      project: {
        allow: ['/another/workspace']
      },
      configPatch: {
        defaultModelService: 'relay-denied',
        modelServices: {
          'relay-denied': {
            apiBaseUrl: 'https://denied.example.com/v1',
            apiKey: 'denied-secret',
            models: ['denied-model'],
            title: 'Denied relay service'
          }
        }
      }
    }
  ],
  rules: []
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('relay managed config snapshot contract', () => {
  it('writes and reads snapshots under the relay plugin project-home runtime directory', async () => {
    const projectHome = await mkdtemp(join(tmpdir(), 'oneworks-relay-config-snapshot-'))
    tempDirs.push(projectHome)
    const snapshotStore = createRelayConfigSnapshotStore(projectHome)
    const snapshot = createRelayConfigSnapshotFixture('/workspace')

    await snapshotStore.writeSnapshot(snapshot)

    expect(snapshotStore.snapshotPath).toBe(join(projectHome, '.local/plugins/relay/config-snapshot.json'))
    expect(await snapshotStore.readSnapshot()).toMatchObject({
      hash: 'sha256:relay-config-smoke',
      version: '2026.06.15-smoke'
    })
  })

  it('projects only safe allowed fields from matching relay snapshot assignments', () => {
    const result = resolveRelayConfigPatchForProject(
      createRelayConfigSnapshotFixture('/workspace'),
      {
        workspaceFolder: '/workspace'
      }
    )

    expect(RELAY_CONFIG_SAFE_FIELDS).toEqual([
      'defaultModelService',
      'modelServices',
      'recommendedModels',
      'plugins',
      'marketplaces',
      'skills',
      'skillsMeta',
      'skillRegistries'
    ])
    expect(result).toEqual({
      allowedFields: ['defaultModelService', 'modelServices'],
      matchedAssignmentIds: ['matching-workspace'],
      patch: {
        defaultModelService: 'relay-smoke',
        modelServices: {
          'relay-smoke': {
            apiBaseUrl: 'https://relay.example.com/v1',
            apiKey: 'relay-secret',
            models: ['relay-smoke-model'],
            title: 'Relay smoke service'
          }
        }
      }
    })
    expect(JSON.stringify(result)).not.toContain('relay-denied')
    expect(JSON.stringify(result)).not.toContain('RELAY_FORBIDDEN_ENV')
    expect(JSON.stringify(result)).not.toContain('@oneworks/plugin-forbidden')
  })

  it.todo('loads @oneworks/plugin-relay ./config from the local config-snapshot cache during loadConfigState')
  it.todo('keeps startup usable when the relay config snapshot is missing, stale, invalid, or sync failed')
})
