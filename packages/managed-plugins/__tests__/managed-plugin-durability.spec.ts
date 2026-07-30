import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { ManagedPluginInstallConfig } from '@oneworks/types'
import { resolveManagedPluginInstallIdentity } from '@oneworks/utils/managed-plugin'

import { readManagedPluginInstallState, writeManagedPluginTransactionMarker } from '#~/managed-plugin-install-state.js'
import { getManagedPluginTransactionDirectories } from '#~/managed-plugin-transaction-journal.js'
import type { ManagedPluginRecoveryCleanupPoint } from '#~/managed-plugin-transaction-recovery.js'
import {
  ManagedPluginTransactionCrash,
  commitManagedPluginInstall,
  recoverManagedPluginInstallTransaction
} from '#~/managed-plugin-transaction.js'
import type { ManagedPluginDurabilityPoint } from '#~/managed-plugin-transaction.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

const createConfig = (version: number): ManagedPluginInstallConfig => ({
  adapter: 'codex',
  installedAt: `2026-01-0${version}T00:00:00.000Z`,
  name: '@scope/docs',
  nativePluginPath: 'native',
  oneworksPluginPath: 'oneworks',
  scope: 'docs',
  source: { spec: `@scope/docs@${version}.0.0`, type: 'npm' },
  version: 1
})

const identityFor = (config: ManagedPluginInstallConfig) => (
  resolveManagedPluginInstallIdentity({
    adapter: config.adapter,
    name: config.name,
    source: config.source
  })
)

const writeInstall = async (
  directory: string,
  config: ManagedPluginInstallConfig,
  sentinel: string
) => {
  await mkdir(path.join(directory, 'native'), { recursive: true })
  await mkdir(path.join(directory, 'oneworks'), { recursive: true })
  await writeFile(path.join(directory, 'native', 'sentinel.txt'), sentinel)
  await writeFile(
    path.join(directory, '.oneworks-plugin.json'),
    `${JSON.stringify(config)}\n`
  )
}

const createScenario = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ow-managed-durability-'))
  tempDirs.push(root)
  const installDir = path.join(root, 'docs', 'install')
  const previous = createConfig(1)
  const next = createConfig(2)
  const identity = identityFor(next)
  await writeInstall(installDir, previous, 'v1')
  const previousState = await readManagedPluginInstallState(installDir)
  const transactionId = randomUUID()
  const { backupDir, stagingDir } = getManagedPluginTransactionDirectories(
    installDir,
    transactionId
  )
  await writeInstall(stagingDir, next, 'v2')
  await writeManagedPluginTransactionMarker(stagingDir, {
    identity,
    transactionId,
    version: 1
  })
  const stagedState = await readManagedPluginInstallState(stagingDir)
  return {
    backupDir,
    identity,
    installDir,
    newRevision: stagedState.revision,
    previousRevision: previousState.revision,
    stagingDir,
    transactionId
  }
}

const commitScenario = (
  scenario: Awaited<ReturnType<typeof createScenario>>,
  options: {
    crashAfter?: ManagedPluginDurabilityPoint
    points?: ManagedPluginDurabilityPoint[]
  } = {}
) =>
  commitManagedPluginInstall({
    crashAfter: options.crashAfter,
    expectedRevision: scenario.previousRevision,
    identity: scenario.identity,
    installDir: scenario.installDir,
    newRevision: scenario.newRevision,
    operations: options.points == null
      ? undefined
      : {
        afterDurablePoint: point => {
          options.points?.push(point)
        }
      },
    stagingDir: scenario.stagingDir,
    transactionId: scenario.transactionId
  })

const readPreservedConflict = async (
  scenario: Awaited<ReturnType<typeof createScenario>>,
  relativePath: string
) => {
  const prefix = `.install-conflict-${scenario.transactionId}-`
  const conflicts = (await readdir(path.dirname(scenario.installDir)))
    .filter(name => name.startsWith(prefix))
  expect(conflicts).toHaveLength(1)
  return readFile(path.join(path.dirname(scenario.installDir), conflicts[0]!, relativePath), 'utf8')
}

describe('managed plugin durable transaction', () => {
  it('orders payload and directory durability before transaction phases', async () => {
    const scenario = await createScenario()
    const points: ManagedPluginDurabilityPoint[] = []

    await commitScenario(scenario, { points })

    expect(points).toEqual([
      'payload-synced',
      'prepared',
      'old-renamed',
      'old-quarantined',
      'new-renamed',
      'new-promoted',
      'cleanup-started',
      'cleanup-complete'
    ])
  })

  it.each(
    [
      ['payload-synced', 'v1', true],
      ['prepared', 'v1', false],
      ['old-renamed', 'v1', false],
      ['old-quarantined', 'v1', false],
      ['new-renamed', 'v2', false],
      ['new-promoted', 'v2', false],
      ['cleanup-started', 'v2', false]
    ] as const
  )(
    'recovers deterministically after the %s durability window',
    async (crashAfter, expectedSentinel, stagedPreserved) => {
      const scenario = await createScenario()
      await expect(commitScenario(scenario, { crashAfter }))
        .rejects.toBeInstanceOf(ManagedPluginTransactionCrash)

      await recoverManagedPluginInstallTransaction({
        identity: scenario.identity,
        installDir: scenario.installDir
      })

      await expect(readFile(
        path.join(scenario.installDir, 'native', 'sentinel.txt'),
        'utf8'
      )).resolves.toBe(expectedSentinel)
      const stagingStat = stat(scenario.stagingDir).catch(() => undefined)
      if (stagedPreserved) {
        await expect(stagingStat).resolves.toBeDefined()
      } else {
        await expect(stagingStat).resolves.toBeUndefined()
      }
    }
  )

  it('detects content mutation after capture without replacing it', async () => {
    const scenario = await createScenario()
    await writeFile(
      path.join(scenario.installDir, 'native', 'sentinel.txt'),
      'externally changed'
    )

    await expect(commitScenario(scenario)).rejects.toThrow(/changed during staging/i)
    await expect(readFile(
      path.join(scenario.installDir, 'native', 'sentinel.txt'),
      'utf8'
    )).resolves.toBe('externally changed')
  })

  it('preserves an altered quarantined backup and staged generation', async () => {
    const scenario = await createScenario()
    await expect(commitScenario(scenario, { crashAfter: 'old-quarantined' }))
      .rejects.toBeInstanceOf(ManagedPluginTransactionCrash)
    await writeFile(path.join(scenario.backupDir, 'sentinel-added.txt'), 'external')

    await expect(recoverManagedPluginInstallTransaction({
      identity: scenario.identity,
      installDir: scenario.installDir
    })).rejects.toThrow(/backup cannot be restored/i)
    await expect(readFile(
      path.join(scenario.backupDir, 'sentinel-added.txt'),
      'utf8'
    )).resolves.toBe('external')
    await expect(readFile(
      path.join(scenario.stagingDir, 'native', 'sentinel.txt'),
      'utf8'
    )).resolves.toBe('v2')
  })

  it('isolates an altered promotion and restores the exact previous install', async () => {
    const scenario = await createScenario()
    await expect(commitScenario(scenario, { crashAfter: 'new-promoted' }))
      .rejects.toBeInstanceOf(ManagedPluginTransactionCrash)
    await writeFile(path.join(scenario.installDir, 'sentinel-added.txt'), 'external')

    await expect(recoverManagedPluginInstallTransaction({
      identity: scenario.identity,
      installDir: scenario.installDir
    })).rejects.toThrow(/preserved.*restored/i)
    await expect(readFile(
      path.join(scenario.installDir, 'native', 'sentinel.txt'),
      'utf8'
    )).resolves.toBe('v1')
    await expect(readPreservedConflict(scenario, 'sentinel-added.txt')).resolves.toBe('external')
  })

  it('restores the previous install when promoted metadata is corrupt', async () => {
    const scenario = await createScenario()
    await expect(commitScenario(scenario, { crashAfter: 'new-promoted' }))
      .rejects.toBeInstanceOf(ManagedPluginTransactionCrash)
    await writeFile(
      path.join(scenario.installDir, '.oneworks-plugin.json'),
      '{"corrupt":true}\n'
    )

    await expect(recoverManagedPluginInstallTransaction({
      identity: scenario.identity,
      installDir: scenario.installDir
    })).rejects.toThrow(/preserved.*restored/i)
    await expect(readFile(
      path.join(scenario.installDir, 'native', 'sentinel.txt'),
      'utf8'
    )).resolves.toBe('v1')
    await expect(readPreservedConflict(scenario, '.oneworks-plugin.json'))
      .resolves.toContain('"corrupt":true')
  })

  it('restores an exact backup without touching an occupied staging path', async () => {
    const scenario = await createScenario()
    await expect(commitScenario(scenario, { crashAfter: 'new-promoted' }))
      .rejects.toBeInstanceOf(ManagedPluginTransactionCrash)
    await mkdir(scenario.stagingDir)
    await writeFile(path.join(scenario.stagingDir, 'unrelated.txt'), 'keep me')
    await writeFile(
      path.join(scenario.installDir, '.oneworks-plugin.json'),
      '{"corrupt":true}\n'
    )

    await expect(recoverManagedPluginInstallTransaction({
      identity: scenario.identity,
      installDir: scenario.installDir
    })).rejects.toThrow(/preserved.*restored/i)
    await expect(readFile(
      path.join(scenario.installDir, 'native', 'sentinel.txt'),
      'utf8'
    )).resolves.toBe('v1')
    await expect(readFile(path.join(scenario.stagingDir, 'unrelated.txt'), 'utf8'))
      .resolves.toBe('keep me')
    await expect(readPreservedConflict(scenario, '.oneworks-plugin.json'))
      .resolves.toContain('"corrupt":true')

    await expect(recoverManagedPluginInstallTransaction({
      identity: scenario.identity,
      installDir: scenario.installDir
    })).rejects.toThrow(/staging ownership is invalid/i)
    await expect(readFile(path.join(scenario.stagingDir, 'unrelated.txt'), 'utf8'))
      .resolves.toBe('keep me')
  })

  it('does not delete a backup changed before final cleanup', async () => {
    const scenario = await createScenario()
    await expect(commitScenario(scenario, { crashAfter: 'new-promoted' }))
      .rejects.toBeInstanceOf(ManagedPluginTransactionCrash)
    await writeFile(path.join(scenario.backupDir, 'sentinel-added.txt'), 'external')

    await expect(recoverManagedPluginInstallTransaction({
      identity: scenario.identity,
      installDir: scenario.installDir
    })).rejects.toThrow(/backup revision changed/i)
    await expect(readFile(
      path.join(scenario.installDir, 'native', 'sentinel.txt'),
      'utf8'
    )).resolves.toBe('v2')
    await expect(readFile(
      path.join(scenario.backupDir, 'sentinel-added.txt'),
      'utf8'
    )).resolves.toBe('external')
  })

  it('never removes a directory swapped after cleanup ownership proof', async () => {
    const scenario = await createScenario()
    await expect(commitScenario(scenario, { crashAfter: 'new-promoted' }))
      .rejects.toBeInstanceOf(ManagedPluginTransactionCrash)
    const preservedBackup = `${scenario.backupDir}.preserved`
    const unrelated = path.join(path.dirname(scenario.installDir), 'unrelated')
    await mkdir(unrelated)
    await writeFile(path.join(unrelated, 'sentinel.txt'), 'unrelated')
    let swapped = false

    await expect(recoverManagedPluginInstallTransaction({
      identity: scenario.identity,
      installDir: scenario.installDir,
      operations: {
        beforeQuarantine: async (directory) => {
          if (swapped || directory !== scenario.backupDir) return
          swapped = true
          await rename(scenario.backupDir, preservedBackup)
          await rename(unrelated, scenario.backupDir)
        }
      }
    })).rejects.toThrow(/changed before mutation/i)

    expect(swapped).toBe(true)
    await expect(readFile(path.join(scenario.backupDir, 'sentinel.txt'), 'utf8'))
      .resolves.toBe('unrelated')
    await expect(readFile(
      path.join(preservedBackup, 'native', 'sentinel.txt'),
      'utf8'
    )).resolves.toBe('v1')
  })

  it.each(
    [
      'marker-removed',
      'backup-cleaned',
      'staging-cleaned'
    ] as const
  )(
    'resumes cleanup after interruption at %s',
    async (interruptedAt: ManagedPluginRecoveryCleanupPoint) => {
      const scenario = await createScenario()
      await expect(commitScenario(scenario, { crashAfter: 'new-promoted' }))
        .rejects.toBeInstanceOf(ManagedPluginTransactionCrash)

      await expect(recoverManagedPluginInstallTransaction({
        identity: scenario.identity,
        installDir: scenario.installDir,
        operations: {
          afterCleanupPoint: (point) => {
            if (point === interruptedAt) throw new Error('simulated cleanup interruption')
          }
        }
      })).rejects.toThrow(/simulated cleanup interruption/i)
      await recoverManagedPluginInstallTransaction({
        identity: scenario.identity,
        installDir: scenario.installDir
      })

      await expect(readFile(
        path.join(scenario.installDir, 'native', 'sentinel.txt'),
        'utf8'
      )).resolves.toBe('v2')
    }
  )
})
