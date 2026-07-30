import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { ManagedPluginInstallConfig, ManagedPluginSource } from '@oneworks/types'
import { resolveManagedPluginInstallIdentity } from '@oneworks/utils/managed-plugin'

import { readManagedPluginInstallState, writeManagedPluginTransactionMarker } from '#~/managed-plugin-install-state.js'
import { getManagedPluginTransactionDirectories } from '#~/managed-plugin-transaction-journal.js'
import {
  ManagedPluginTransactionCrash,
  captureManagedPluginInstallRevision,
  commitManagedPluginInstall
} from '#~/managed-plugin-transaction.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(directory =>
      rm(directory, {
        force: true,
        recursive: true
      })
    )
  )
})

const createRoot = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ow-managed-transaction-'))
  tempDirs.push(root)
  return root
}

const createConfig = (params: {
  installedAt: string
  name?: string
  source: ManagedPluginSource
}): ManagedPluginInstallConfig => ({
  adapter: 'codex',
  installedAt: params.installedAt,
  name: params.name ?? '@scope/docs',
  nativePluginPath: 'native',
  oneworksPluginPath: 'oneworks',
  scope: 'docs',
  source: params.source,
  version: 1
})

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

const identityFor = (config: ManagedPluginInstallConfig) => (
  resolveManagedPluginInstallIdentity({
    adapter: config.adapter,
    name: config.name,
    source: config.source
  })
)

const prepareStaging = async (
  installDir: string,
  config: ManagedPluginInstallConfig,
  sentinel: string
) => {
  const identity = identityFor(config)
  const transactionId = randomUUID()
  const { stagingDir } = getManagedPluginTransactionDirectories(installDir, transactionId)
  await writeInstall(stagingDir, config, sentinel)
  await writeManagedPluginTransactionMarker(stagingDir, {
    identity,
    transactionId,
    version: 1
  })
  const state = await readManagedPluginInstallState(stagingDir)
  return { identity, newRevision: state.revision, stagingDir, transactionId }
}

describe('managed plugin install transaction', () => {
  it('rejects lossy slug collisions without touching the owned install', async () => {
    const root = await createRoot()
    const installDir = path.join(root, 'foo-bar', 'install')
    const installed = createConfig({
      installedAt: '2026-01-01T00:00:00.000Z',
      name: 'Foo Bar',
      source: { path: '/catalog/foo-bar', type: 'path' }
    })
    const colliding = createConfig({
      installedAt: '2026-01-02T00:00:00.000Z',
      name: 'foo-bar',
      source: { path: '/catalog/other', type: 'path' }
    })
    await writeInstall(installDir, installed, 'owner')

    await expect(captureManagedPluginInstallRevision({
      force: true,
      identity: identityFor(colliding),
      installDir
    })).rejects.toThrow(/different plugin/i)
    await expect(readFile(path.join(installDir, 'native', 'sentinel.txt'), 'utf8'))
      .resolves.toBe('owner')
  })

  it('allows a same-identity package version upgrade', async () => {
    const root = await createRoot()
    const installDir = path.join(root, 'docs', 'install')
    const previous = createConfig({
      installedAt: '2026-01-01T00:00:00.000Z',
      source: {
        registry: 'https://registry.npmjs.org/',
        spec: '@scope/docs@1.0.0',
        type: 'npm'
      }
    })
    const next = createConfig({
      installedAt: '2026-01-02T00:00:00.000Z',
      source: { spec: '@scope/docs@2.0.0', type: 'npm' }
    })
    expect(identityFor(next)).toBe(identityFor(previous))
    await writeInstall(installDir, previous, 'v1')
    const expectedRevision = await captureManagedPluginInstallRevision({
      force: true,
      identity: identityFor(next),
      installDir
    })
    const staged = await prepareStaging(installDir, next, 'v2')

    await commitManagedPluginInstall({
      ...staged,
      expectedRevision,
      installDir
    })

    await expect(readFile(path.join(installDir, 'native', 'sentinel.txt'), 'utf8'))
      .resolves.toBe('v2')
  })

  it('rejects the same npm alias from a different registry authority', async () => {
    const root = await createRoot()
    const installDir = path.join(root, 'docs', 'install')
    const installed = createConfig({
      installedAt: '2026-01-01T00:00:00.000Z',
      source: {
        registry: 'https://registry.example.test/team/',
        spec: 'docs@npm:@scope/docs@1.0.0',
        type: 'npm'
      }
    })
    const colliding = createConfig({
      installedAt: '2026-01-02T00:00:00.000Z',
      source: {
        registry: 'https://other.example.test/team',
        spec: 'docs@npm:@scope/docs@2.0.0',
        type: 'npm'
      }
    })
    await writeInstall(installDir, installed, 'registry owner')

    await expect(captureManagedPluginInstallRevision({
      force: true,
      identity: identityFor(colliding),
      installDir
    })).rejects.toThrow(/different plugin/i)
    await expect(readFile(path.join(installDir, 'native', 'sentinel.txt'), 'utf8'))
      .resolves.toBe('registry owner')
  })

  it('serializes concurrent force commits and rejects the stale loser', async () => {
    const root = await createRoot()
    const installDir = path.join(root, 'docs', 'install')
    const previous = createConfig({
      installedAt: '2026-01-01T00:00:00.000Z',
      source: { spec: '@scope/docs@1.0.0', type: 'npm' }
    })
    await writeInstall(installDir, previous, 'v1')
    const identity = identityFor(previous)
    const expectedRevision = await captureManagedPluginInstallRevision({
      force: true,
      identity,
      installDir
    })
    const first = await prepareStaging(
      installDir,
      createConfig({
        installedAt: '2026-01-02T00:00:00.000Z',
        source: { spec: '@scope/docs@2.0.0', type: 'npm' }
      }),
      'v2'
    )
    const second = await prepareStaging(
      installDir,
      createConfig({
        installedAt: '2026-01-03T00:00:00.000Z',
        source: { spec: '@scope/docs@3.0.0', type: 'npm' }
      }),
      'v3'
    )

    const results = await Promise.allSettled([
      commitManagedPluginInstall({ ...first, expectedRevision, installDir }),
      commitManagedPluginInstall({ ...second, expectedRevision, installDir })
    ])

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason)
      .toMatchObject({ message: expect.stringMatching(/changed during staging/i) })
    await expect(readFile(path.join(installDir, 'native', 'sentinel.txt'), 'utf8'))
      .resolves.toBe(results[0]?.status === 'fulfilled' ? 'v2' : 'v3')
    await expect(readFile(path.join(first.stagingDir, 'native', 'sentinel.txt'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(path.join(second.stagingDir, 'native', 'sentinel.txt'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(
    [
      ['old-quarantined', 'v1'],
      ['new-promoted', 'v2']
    ] as const
  )('recovers a crash after %s', async (crashAfter, expectedSentinel) => {
    const root = await createRoot()
    const installDir = path.join(root, crashAfter, 'install')
    const previous = createConfig({
      installedAt: '2026-01-01T00:00:00.000Z',
      source: { spec: '@scope/docs@1.0.0', type: 'npm' }
    })
    const next = createConfig({
      installedAt: '2026-01-02T00:00:00.000Z',
      source: { spec: '@scope/docs@2.0.0', type: 'npm' }
    })
    await writeInstall(installDir, previous, 'v1')
    const expectedRevision = await captureManagedPluginInstallRevision({
      force: true,
      identity: identityFor(next),
      installDir
    })
    const staged = await prepareStaging(installDir, next, 'v2')

    await expect(commitManagedPluginInstall({
      ...staged,
      crashAfter,
      expectedRevision,
      installDir
    })).rejects.toBeInstanceOf(ManagedPluginTransactionCrash)
    await captureManagedPluginInstallRevision({
      force: true,
      identity: identityFor(next),
      installDir
    })

    await expect(readFile(path.join(installDir, 'native', 'sentinel.txt'), 'utf8'))
      .resolves.toBe(expectedSentinel)
  })

  it('fails closed for mismatched journals, unknown targets, and symlinks', async () => {
    const root = await createRoot()
    const installDir = path.join(root, 'docs', 'install')
    await mkdir(installDir, { recursive: true })
    await writeFile(path.join(installDir, 'sentinel.txt'), 'unknown')
    await expect(captureManagedPluginInstallRevision({
      force: true,
      identity: 'a'.repeat(64),
      installDir
    })).rejects.toThrow(/not a valid managed plugin install/i)
    await expect(readFile(path.join(installDir, 'sentinel.txt'), 'utf8')).resolves.toBe('unknown')

    const symlinkDir = path.join(root, 'symlink-install')
    await symlink(installDir, symlinkDir)
    await expect(captureManagedPluginInstallRevision({
      force: true,
      identity: 'a'.repeat(64),
      installDir: symlinkDir
    })).rejects.toThrow(/not an owned directory/i)

    const metadataDir = path.join(root, 'metadata-symlink')
    const externalConfig = path.join(root, 'external-config.json')
    await mkdir(path.join(metadataDir, 'native'), { recursive: true })
    await mkdir(path.join(metadataDir, 'oneworks'), { recursive: true })
    await writeFile(
      externalConfig,
      JSON.stringify(createConfig({
        installedAt: '2026-01-01T00:00:00.000Z',
        source: { spec: '@scope/docs@1.0.0', type: 'npm' }
      }))
    )
    await symlink(externalConfig, path.join(metadataDir, '.oneworks-plugin.json'))
    await expect(captureManagedPluginInstallRevision({
      force: true,
      identity: 'a'.repeat(64),
      installDir: metadataDir
    })).rejects.toThrow(/metadata is not an owned file/i)

    const occupiedDir = path.join(root, 'occupied-backup', 'install')
    const occupiedConfig = createConfig({
      installedAt: '2026-01-01T00:00:00.000Z',
      source: { spec: '@scope/docs@1.0.0', type: 'npm' }
    })
    await writeInstall(occupiedDir, occupiedConfig, 'owned install')
    const occupiedRevision = await captureManagedPluginInstallRevision({
      force: true,
      identity: identityFor(occupiedConfig),
      installDir: occupiedDir
    })
    const occupiedStage = await prepareStaging(
      occupiedDir,
      createConfig({
        installedAt: '2026-01-02T00:00:00.000Z',
        source: { spec: '@scope/docs@2.0.0', type: 'npm' }
      }),
      'replacement'
    )
    const { backupDir } = getManagedPluginTransactionDirectories(
      occupiedDir,
      occupiedStage.transactionId
    )
    await mkdir(backupDir)
    await writeFile(path.join(backupDir, 'sentinel.txt'), 'unrelated')
    await expect(commitManagedPluginInstall({
      ...occupiedStage,
      expectedRevision: occupiedRevision,
      installDir: occupiedDir
    })).rejects.toThrow(/backup path is already occupied/i)
    await expect(readFile(path.join(occupiedDir, 'native', 'sentinel.txt'), 'utf8'))
      .resolves.toBe('owned install')
    await expect(readFile(path.join(backupDir, 'sentinel.txt'), 'utf8'))
      .resolves.toBe('unrelated')

    const staleDir = path.join(root, 'stale-journal', 'install')
    const previous = createConfig({
      installedAt: '2026-01-01T00:00:00.000Z',
      source: { spec: '@scope/docs@1.0.0', type: 'npm' }
    })
    const next = createConfig({
      installedAt: '2026-01-02T00:00:00.000Z',
      source: { spec: '@scope/docs@2.0.0', type: 'npm' }
    })
    await writeInstall(staleDir, previous, 'v1')
    const expectedRevision = await captureManagedPluginInstallRevision({
      force: true,
      identity: identityFor(next),
      installDir: staleDir
    })
    const staged = await prepareStaging(staleDir, next, 'v2')
    await expect(commitManagedPluginInstall({
      ...staged,
      crashAfter: 'old-quarantined',
      expectedRevision,
      installDir: staleDir
    })).rejects.toBeInstanceOf(ManagedPluginTransactionCrash)

    await expect(captureManagedPluginInstallRevision({
      force: true,
      identity: 'b'.repeat(64),
      installDir: staleDir
    })).rejects.toThrow(/journal belongs to a different plugin/i)
    await captureManagedPluginInstallRevision({
      force: true,
      identity: identityFor(next),
      installDir: staleDir
    })
    await expect(readFile(path.join(staleDir, 'native', 'sentinel.txt'), 'utf8'))
      .resolves.toBe('v1')
  })
})
