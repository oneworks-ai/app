import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import {
  appendFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  openFilesystemAuthorityForTest,
  prepareFilesystemAuthorityTestControlRoot,
  startFilesystemAuthorityBroker
} from '@oneworks/fs-authority-native/testing'
import type { ManagedPluginInstall } from '@oneworks/utils/managed-plugin'
import { getManagedPluginInstallDir, getManagedPluginsRoot } from '@oneworks/utils/managed-plugin'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { withManagedPluginMutationLock } from '../src/managed-plugin-mutation'
import {
  MAX_REMOVAL_JOURNAL_ENTRIES,
  MAX_REMOVAL_RECORD_BYTES,
  readRemovalRecord
} from '../src/managed-plugin-removal-journal'
import {
  commitManagedPluginRemoval,
  recoverManagedPluginRemovals,
  removeManagedPluginInstall,
  restoreManagedPluginRemoval,
  stageManagedPluginRemoval
} from '../src/managed-plugin-remove'
import type { ManagedPluginRemovalRuntime } from '../src/managed-plugin-remove'

const require = createRequire(import.meta.url)
const brokerPath = path.join(
  path.dirname(require.resolve('@oneworks/fs-authority-native/package.json')),
  'broker.cjs'
)

const startCrashBroker = (controlRoot: string) => {
  const child = spawn(process.execPath, [brokerPath, '--test-control-root', controlRoot], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'inherit']
  })
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  const ready = new Promise<void>((resolve, reject) => {
    let output = ''
    child.stdout.on('data', chunk => {
      output += chunk.toString()
      if (output.includes('READY ')) resolve()
    })
    child.once('error', reject)
    child.once('exit', code => reject(new Error(`Broker exited before ready: ${code}`)))
  })
  return {
    exited,
    ready,
    stop: async () => {
      if (child.exitCode == null && child.signalCode == null) child.kill('SIGTERM')
      await exited
    }
  }
}

describe.runIf(process.platform === 'darwin')('managed plugin authority caller', () => {
  let broker: Awaited<ReturnType<typeof startFilesystemAuthorityBroker>> | undefined
  let controlRoot: string
  let secret: string
  let suiteRoot: string
  let workspace: string
  let env: NodeJS.ProcessEnv
  let runtime: ManagedPluginRemovalRuntime

  const createInstall = async (slug = 'official--airtable'): Promise<ManagedPluginInstall> => {
    const installDir = getManagedPluginInstallDir(workspace, 'codex', slug, env)
    const nativePluginDir = path.join(installDir, 'native')
    const oneworksPluginDir = path.join(installDir, 'oneworks')
    const config = {
      adapter: 'codex' as const,
      installedAt: '2026-08-05T00:00:00.000Z',
      name: 'airtable',
      nativePluginPath: 'native',
      oneworksPluginPath: 'oneworks',
      scope: 'airtable',
      source: {
        marketplace: 'official',
        plugin: 'airtable',
        type: 'marketplace' as const
      },
      version: 1 as const
    }
    await mkdir(nativePluginDir, { recursive: true })
    await mkdir(oneworksPluginDir, { recursive: true })
    await writeFile(path.join(nativePluginDir, 'marker.txt'), 'native')
    await writeFile(path.join(oneworksPluginDir, 'marker.txt'), 'oneworks')
    await writeFile(path.join(installDir, 'managed-plugin.json'), `${JSON.stringify(config)}\n`)
    return { config, installDir, nativePluginDir, oneworksPluginDir }
  }

  const exists = async (target: string) => stat(target).then(() => true, () => false)
  const receiptPath = (handle: Awaited<ReturnType<typeof stageManagedPluginRemoval>>) =>
    path.join(
      getManagedPluginsRoot(workspace, env),
      '.removal-transactions',
      `${handle.operationId}.${handle.receipt.id}.receipt`
    )

  beforeAll(async () => {
    suiteRoot = await mkdtemp(path.join(tmpdir(), 'ow-managed-plugin-caller-'))
    const control = prepareFilesystemAuthorityTestControlRoot(path.join(suiteRoot, 'control'))
    controlRoot = control.controlRoot
    secret = control.secret
    broker = await startFilesystemAuthorityBroker({ controlRoot, secret })
  })

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(suiteRoot, 'workspace-'))
    const projectHome = await mkdtemp(path.join(suiteRoot, 'project-home-'))
    env = { ...process.env, __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: projectHome }
    runtime = {
      mutation: {
        openAuthority: (root: string) =>
          openFilesystemAuthorityForTest(root, {
            autoStart: false,
            controlRoot,
            secret
          })
      }
    }
  })

  afterAll(async () => {
    await broker?.close()
    await rm(suiteRoot, { force: true, recursive: true })
  })

  it('fails before mutation when the authority denies the workspace claim', async () => {
    const install = await createInstall()
    const denied: ManagedPluginRemovalRuntime = {
      mutation: {
        openAuthority: async () => {
          throw new Error('authority denied')
        }
      }
    }
    await expect(stageManagedPluginRemoval({
      cwd: workspace,
      env,
      install,
      operationId: 'a'.repeat(64),
      runtime: denied
    })).rejects.toThrow('authority denied')
    await expect(readFile(path.join(install.oneworksPluginDir, 'marker.txt'), 'utf8')).resolves.toBe('oneworks')
  })

  it('restores the identity-bound tree under a fresh claim generation', async () => {
    const install = await createInstall()
    const handle = await stageManagedPluginRemoval({
      cwd: workspace,
      env,
      install,
      operationId: 'b'.repeat(64),
      runtime
    })
    expect(await exists(install.installDir)).toBe(false)
    await restoreManagedPluginRemoval(handle)
    expect(await exists(install.installDir)).toBe(true)
  })

  it('rejects a terminal transaction replay without changing the restored tree', async () => {
    const install = await createInstall()
    const handle = await stageManagedPluginRemoval({
      cwd: workspace,
      env,
      install,
      operationId: 'c'.repeat(64),
      runtime
    })
    await restoreManagedPluginRemoval(handle)
    await expect(commitManagedPluginRemoval(handle)).rejects.toThrow()
    await expect(readFile(path.join(install.nativePluginDir, 'marker.txt'), 'utf8')).resolves.toBe('native')
  })

  it('allows only one concurrent remove or restore terminal outcome', async () => {
    const install = await createInstall()
    const handle = await stageManagedPluginRemoval({
      cwd: workspace,
      env,
      install,
      operationId: 'd'.repeat(64),
      runtime
    })
    const outcomes = await Promise.allSettled([
      commitManagedPluginRemoval(handle),
      restoreManagedPluginRemoval(handle)
    ])
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1)
  })

  it('acquires a fresh live claim for sequential removals inside one outer lease', async () => {
    const first = await createInstall('official--airtable-first')
    const second = await createInstall('official--airtable-second')
    const leaseEvents: string[] = []
    const sequentialRuntime: ManagedPluginRemovalRuntime = {
      mutation: {
        ...runtime.mutation,
        onLeaseEvent: event => leaseEvents.push(event)
      }
    }
    await withManagedPluginMutationLock({
      cwd: workspace,
      env,
      runtime: sequentialRuntime.mutation
    }, async () => {
      await removeManagedPluginInstall({ cwd: workspace, env, install: first, runtime: sequentialRuntime })
      await removeManagedPluginInstall({ cwd: workspace, env, install: second, runtime: sequentialRuntime })
    })
    expect(leaseEvents).toEqual(['acquired', 'reused', 'reused', 'acquired', 'acquired'])
    expect(await exists(first.installDir)).toBe(false)
    expect(await exists(second.installDir)).toBe(false)
  })

  it('records a durable receipt after a crash following native remove', async () => {
    const install = await createInstall()
    await broker?.close()
    broker = undefined
    const crashBroker = startCrashBroker(controlRoot)
    try {
      await crashBroker.ready
      const handle = await stageManagedPluginRemoval({
        cwd: workspace,
        env,
        install,
        operationId: 'f'.repeat(64),
        runtime
      })
      const crashRuntime: ManagedPluginRemovalRuntime = {
        mutation: {
          openAuthority: (root: string) =>
            openFilesystemAuthorityForTest(root, {
              autoStart: false,
              controlRoot,
              fault: 'crash-after-tree-remove-before-sync',
              secret,
              timeoutMs: 5000
            })
        }
      }
      await expect(commitManagedPluginRemoval({ ...handle, runtime: crashRuntime })).rejects.toMatchObject({
        code: 'managed_tree_mutation_indeterminate',
        committed: 'indeterminate'
      })
      await expect(crashBroker.exited).resolves.toEqual({ code: 86, signal: null })
      broker = await startFilesystemAuthorityBroker({ controlRoot, secret })

      await expect(recoverManagedPluginRemovals({
        cwd: workspace,
        env,
        isDeclarationPresent: async () => false,
        runtime
      })).resolves.toEqual([
        expect.objectContaining({ action: 'cleaned', operationId: 'f'.repeat(64) })
      ])
      await expect(recoverManagedPluginRemovals({
        cwd: workspace,
        env,
        isDeclarationPresent: async () => false,
        runtime
      })).resolves.toEqual([])
      expect(await exists(install.installDir)).toBe(false)
    } finally {
      await crashBroker.stop()
      broker ??= await startFilesystemAuthorityBroker({ controlRoot, secret })
    }
  })

  it('does not let a preexisting legacy receipt marker skip recovery', async () => {
    const install = await createInstall()
    const operationId = '1'.repeat(64)
    await stageManagedPluginRemoval({ cwd: workspace, env, install, operationId, runtime })
    const journal = path.join(getManagedPluginsRoot(workspace, env), '.removal-transactions')
    await writeFile(path.join(journal, `${operationId}.removed`), 'removed\n')

    await expect(recoverManagedPluginRemovals({
      cwd: workspace,
      env,
      isDeclarationPresent: async () => true,
      runtime
    })).resolves.toEqual([
      expect.objectContaining({ action: 'restored', operationId })
    ])
    expect(await exists(install.installDir)).toBe(true)
  })

  it('repairs a fixed-size partial receipt through authoritative replay', async () => {
    const install = await createInstall()
    const handle = await stageManagedPluginRemoval({
      cwd: workspace,
      env,
      install,
      operationId: '2'.repeat(64),
      runtime
    })
    const partial = Buffer.alloc(64)
    partial.write('partial-terminal-phase', 'utf8')
    await writeFile(receiptPath(handle), partial)

    await expect(recoverManagedPluginRemovals({
      cwd: workspace,
      env,
      isDeclarationPresent: async () => true,
      runtime
    })).resolves.toEqual([
      expect.objectContaining({ action: 'restored', operationId: handle.operationId })
    ])
    expect(await exists(install.installDir)).toBe(true)
  })

  it('rejects receipt type, symlink, hardlink, and inode replacement collisions', async () => {
    const install = await createInstall()
    const handle = await stageManagedPluginRemoval({
      cwd: workspace,
      env,
      install,
      operationId: '3'.repeat(64),
      runtime
    })
    const target = receiptPath(handle)
    const reserved = `${target}.reserved`
    const recover = () =>
      recoverManagedPluginRemovals({
        cwd: workspace,
        env,
        isDeclarationPresent: async () => true,
        runtime
      })
    await rename(target, reserved)

    await mkdir(target)
    await expect(recover()).rejects.toThrow()
    await rm(target, { recursive: true })

    await symlink(reserved, target)
    await expect(recover()).rejects.toThrow()
    await unlink(target)

    await link(reserved, target)
    await expect(recover()).rejects.toThrow('receipt identity is invalid')
    await unlink(target)

    await writeFile(target, 'pending\n')
    await expect(recover()).rejects.toThrow('receipt identity is invalid')
    await unlink(target)

    await rename(reserved, target)
    await expect(recover()).resolves.toEqual([
      expect.objectContaining({ action: 'restored', operationId: handle.operationId })
    ])
    expect(await exists(install.installDir)).toBe(true)
  })

  it('ignores a partial unique record temp without blocking later recovery', async () => {
    const journal = path.join(getManagedPluginsRoot(workspace, env), '.removal-transactions')
    await mkdir(journal, { recursive: true })
    await writeFile(
      path.join(journal, `.${'4'.repeat(64)}.${'5'.repeat(64)}.record.tmp`),
      '{"partial":'
    )
    await expect(recoverManagedPluginRemovals({
      cwd: workspace,
      env,
      isDeclarationPresent: async () => true,
      runtime
    })).resolves.toEqual([])

    const install = await createInstall()
    const handle = await stageManagedPluginRemoval({
      cwd: workspace,
      env,
      install,
      operationId: '6'.repeat(64),
      runtime
    })
    await restoreManagedPluginRemoval(handle)
    expect(await exists(install.installDir)).toBe(true)
  })

  it('leaves an oversized install intact without poisoning a later valid removal', async () => {
    const install = await createInstall('official--oversized')
    const oversized = {
      ...install,
      config: { ...install.config, name: 'x'.repeat(MAX_REMOVAL_RECORD_BYTES + 1) }
    }
    let authorityOpened = false
    const guardedRuntime: ManagedPluginRemovalRuntime = {
      mutation: {
        openAuthority: async () => {
          authorityOpened = true
          throw new Error('authority must not open')
        }
      }
    }
    await expect(stageManagedPluginRemoval({
      cwd: workspace,
      env,
      install: oversized,
      operationId: '7'.repeat(64),
      runtime: guardedRuntime
    })).rejects.toThrow('transaction record is invalid')
    expect(authorityOpened).toBe(false)
    expect(await exists(install.installDir)).toBe(true)
    expect(await exists(path.join(getManagedPluginsRoot(workspace, env), '.removal-transactions'))).toBe(false)

    await removeManagedPluginInstall({ cwd: workspace, env, install, runtime })
    expect(await exists(install.installDir)).toBe(false)
    await expect(recoverManagedPluginRemovals({
      cwd: workspace,
      env,
      isDeclarationPresent: async () => false,
      runtime
    })).resolves.toEqual([])
  })

  it('rejects record growth after stat with a fixed bounded read', async () => {
    const install = await createInstall()
    const operationId = 'a'.repeat(64)
    await stageManagedPluginRemoval({ cwd: workspace, env, install, operationId, runtime })
    const root = getManagedPluginsRoot(workspace, env)
    const target = path.join(root, '.removal-transactions', `${operationId}.json`)

    await expect(readRemovalRecord(root, operationId, {
      afterRecordStat: () => appendFile(target, 'growth-after-stat')
    })).rejects.toThrow('transaction record is invalid')
  })

  it('bounds completed history and orphan record reservations without cleanup', async () => {
    const completed = await createInstall('official--completed')
    await removeManagedPluginInstall({ cwd: workspace, env, install: completed, runtime })
    const journal = path.join(getManagedPluginsRoot(workspace, env), '.removal-transactions')
    for (let index = 0; index < MAX_REMOVAL_JOURNAL_ENTRIES - 4; index += 1) {
      const operationId = index.toString(16).padStart(64, '0')
      await writeFile(
        path.join(journal, `.${operationId}.${'a'.repeat(64)}.record.tmp`),
        'orphan'
      )
    }
    const install = await createInstall('official--bounded')
    await expect(stageManagedPluginRemoval({
      cwd: workspace,
      env,
      install,
      operationId: '8'.repeat(64),
      runtime
    })).rejects.toThrow('history is full')
    expect(await exists(install.installDir)).toBe(true)
  })

  it('recovers by declaration while preserving sibling installs and project data', async () => {
    const install = await createInstall()
    const sibling = await createInstall('official--sibling')
    const projectData = path.join(env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__!, '.local', 'plugins', 'data.txt')
    await writeFile(projectData, 'keep')
    await stageManagedPluginRemoval({
      cwd: workspace,
      env,
      install,
      operationId: 'e'.repeat(64),
      runtime
    })
    await expect(recoverManagedPluginRemovals({
      cwd: workspace,
      env,
      isDeclarationPresent: async () => false,
      runtime
    })).resolves.toEqual([
      expect.objectContaining({ action: 'cleaned', operationId: 'e'.repeat(64) })
    ])
    expect(await exists(install.installDir)).toBe(false)
    expect(await exists(sibling.installDir)).toBe(true)
    await expect(readFile(projectData, 'utf8')).resolves.toBe('keep')
  })
})
