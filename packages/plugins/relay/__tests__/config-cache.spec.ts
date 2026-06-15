import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createRelayConfigSnapshotStore } from '../src/shared/config-cache.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('relay config snapshot cache', () => {
  it('writes and reads normalized relay config snapshots under project home', async () => {
    const projectHome = await mkdtemp(join(tmpdir(), 'oneworks-relay-config-cache-'))
    tempDirs.push(projectHome)
    const store = createRelayConfigSnapshotStore(projectHome)

    await store.writeSnapshot({
      assignments: [
        {
          id: 'base',
          configPatch: {
            modelServices: {
              relay: {
                apiBaseUrl: 'https://relay.example/v1',
                apiKey: 'secret'
              }
            }
          }
        }
      ],
      hash: 'hash-1',
      lastAppliedAt: '2026-06-15T00:05:00.000Z',
      lastError: null,
      lastSyncedAt: '2026-06-15T00:00:00.000Z',
      matchedProject: true,
      sourceServerId: 'prod',
      version: 'v1'
    })

    await expect(store.readSnapshot()).resolves.toMatchObject({
      assignments: [
        {
          id: 'base',
          configPatch: {
            modelServices: {
              relay: {
                apiBaseUrl: 'https://relay.example/v1',
                apiKey: 'secret'
              }
            }
          }
        }
      ],
      hash: 'hash-1',
      lastAppliedAt: '2026-06-15T00:05:00.000Z',
      lastError: null,
      lastSyncedAt: '2026-06-15T00:00:00.000Z',
      matchedProject: true,
      sourceServerId: 'prod',
      version: 'v1'
    })
    expect(store.snapshotPath).toBe(join(projectHome, '.local/plugins/relay/config-snapshot.json'))
  })

  it('preserves the previous snapshot while recording sync errors', async () => {
    const projectHome = await mkdtemp(join(tmpdir(), 'oneworks-relay-config-cache-error-'))
    tempDirs.push(projectHome)
    const store = createRelayConfigSnapshotStore(projectHome)

    await store.writeSnapshot({
      assignments: [],
      hash: 'hash-1',
      lastAppliedAt: '2026-06-15T00:05:00.000Z',
      lastError: null,
      lastSyncedAt: '2026-06-15T00:00:00.000Z',
      matchedProject: true,
      sourceServerId: 'prod',
      version: 'v1'
    })
    await store.writeSyncError({
      lastError: 'Relay config snapshot failed with 404.',
      sourceServerId: 'prod'
    })

    await expect(store.readSnapshot()).resolves.toMatchObject({
      hash: 'hash-1',
      lastAppliedAt: '2026-06-15T00:05:00.000Z',
      lastError: 'Relay config snapshot failed with 404.',
      lastSyncedAt: '2026-06-15T00:00:00.000Z',
      matchedProject: true,
      sourceServerId: 'prod',
      version: 'v1'
    })
  })
})
