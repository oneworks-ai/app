/* eslint-disable max-lines -- transaction recovery adversarial cases share one filesystem fixture. */

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, renameSync, rmSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  commitManagedPluginRemoval,
  getManagedPluginMutationLockDir,
  getManagedPluginRemovalCompletion,
  installAdapterPluginWithInstaller,
  isManagedPluginMutationActive,
  recoverManagedPluginRemovals,
  restoreManagedPluginRemoval,
  stageManagedPluginRemoval,
  withManagedPluginMutationLock
} from '#~/index.js'
import { resolveProjectHomePath } from '@oneworks/utils/ai-path'
import {
  getManagedPluginConfigPath,
  getManagedPluginInstallDir,
  getManagedPluginsRoot,
  readManagedPluginInstall
} from '@oneworks/utils/managed-plugin'

const tempDirs: string[] = []
const originalProjectsDir = process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__

afterEach(async () => {
  if (originalProjectsDir == null) {
    delete process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
  } else {
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = originalProjectsDir
  }
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

const createWorkspace = async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'ow-managed-remove-'))
  tempDirs.push(workspace)
  process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(workspace, '.project-homes')
  return workspace
}

const createManagedInstall = async (
  workspace: string,
  options: {
    marketplace?: string
    plugin?: string
    scope?: string
    slug?: string
  } = {}
) => {
  const installDir = getManagedPluginInstallDir(
    workspace,
    'claude',
    options.slug ?? 'team--reviewer',
    process.env
  )
  await mkdir(path.join(installDir, 'native'), { recursive: true })
  await mkdir(path.join(installDir, 'oneworks'), { recursive: true })
  await writeFile(path.join(installDir, 'oneworks', 'plugin.json'), '{}\n')
  await writeFile(
    getManagedPluginConfigPath(installDir),
    `${
      JSON.stringify(
        {
          version: 1,
          adapter: 'claude',
          name: options.plugin ?? 'reviewer',
          scope: options.scope ?? 'review',
          installedAt: '2026-07-30T00:00:00.000Z',
          source: {
            type: 'marketplace',
            marketplace: options.marketplace ?? 'team',
            plugin: options.plugin ?? 'reviewer'
          },
          nativePluginPath: 'native',
          oneworksPluginPath: 'oneworks'
        },
        null,
        2
      )
    }\n`
  )
  const install = await readManagedPluginInstall(installDir)
  if (install == null) throw new Error('Expected managed install fixture')
  return install
}

const token = (character: string) => character.repeat(64)

const createDeferred = () => {
  let settle = () => {}
  const promise = new Promise<void>((resolve) => {
    settle = resolve
  })
  return {
    promise,
    resolve: () => settle()
  }
}

describe('managed plugin removal transaction', () => {
  it('uses one normalized lock key for equivalent workspace paths', async () => {
    const workspace = await createWorkspace()

    expect(getManagedPluginMutationLockDir(workspace)).toBe(
      getManagedPluginMutationLockDir(path.join(workspace, '.'))
    )
  })

  it('uses one lock key for environment-equivalent workspace authority', async () => {
    const workspace = await createWorkspace()
    const nested = path.join(workspace, 'nested')
    await mkdir(nested)
    const env = {
      ...process.env,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspace
    }

    expect(getManagedPluginMutationLockDir(workspace, env)).toBe(
      getManagedPluginMutationLockDir(nested, env)
    )
  })

  it('restores a quarantined install when the project declaration still exists', async () => {
    const workspace = await createWorkspace()
    const install = await createManagedInstall(workspace)
    await stageManagedPluginRemoval({
      cwd: workspace,
      env: process.env,
      install,
      operationId: token('a')
    })

    await expect(stat(install.installDir)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(recoverManagedPluginRemovals({
      cwd: workspace,
      env: process.env,
      isDeclarationPresent: () => true
    })).resolves.toEqual([
      expect.objectContaining({
        action: 'restored',
        operationId: token('a')
      })
    ])
    await expect(readManagedPluginInstall(install.installDir)).resolves.toEqual(
      expect.objectContaining({
        config: expect.objectContaining({ name: 'reviewer' })
      })
    )
  })

  it('completes cleanup when undeclared while preserving sibling installs, data, accounts, and cache', async () => {
    const workspace = await createWorkspace()
    const install = await createManagedInstall(workspace)
    const siblingInstall = await createManagedInstall(workspace, {
      plugin: 'sibling',
      scope: 'sibling',
      slug: 'team--sibling'
    })
    const dataDir = path.resolve(path.dirname(install.installDir), 'data')
    const accountsDir = resolveProjectHomePath(
      workspace,
      process.env,
      '.local',
      'adapters',
      'claude',
      'accounts'
    )
    const cacheDir = resolveProjectHomePath(workspace, process.env, 'caches', 'plugin-marketplace')
    await mkdir(dataDir, { recursive: true })
    await mkdir(accountsDir, { recursive: true })
    await mkdir(cacheDir, { recursive: true })
    await writeFile(path.join(dataDir, 'account.json'), '{"kept":true}\n')
    await writeFile(path.join(accountsDir, 'account.json'), '{"kept":true}\n')
    await writeFile(path.join(cacheDir, 'catalog.json'), '{"kept":true}\n')
    await stageManagedPluginRemoval({
      cwd: workspace,
      env: process.env,
      install,
      operationId: token('b')
    })

    await expect(recoverManagedPluginRemovals({
      cwd: workspace,
      env: process.env,
      isDeclarationPresent: () => false
    })).resolves.toEqual([
      expect.objectContaining({
        action: 'cleaned',
        operationId: token('b')
      })
    ])
    await expect(stat(install.installDir)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readManagedPluginInstall(siblingInstall.installDir)).resolves.toEqual(
      expect.objectContaining({
        config: expect.objectContaining({ name: 'sibling' })
      })
    )
    await expect(readFile(path.join(dataDir, 'account.json'), 'utf8')).resolves.toContain('"kept":true')
    await expect(readFile(path.join(accountsDir, 'account.json'), 'utf8')).resolves.toContain('"kept":true')
    await expect(readFile(path.join(cacheDir, 'catalog.json'), 'utf8')).resolves.toContain('"kept":true')
  })

  it('restores the exact install after a staged config failure and fails closed on a missing journal', async () => {
    const workspace = await createWorkspace()
    const install = await createManagedInstall(workspace)
    const handle = await stageManagedPluginRemoval({
      cwd: workspace,
      env: process.env,
      install,
      operationId: token('c')
    })

    await restoreManagedPluginRemoval(handle)
    await expect(restoreManagedPluginRemoval(handle)).rejects.toThrow('journal is missing')
    await expect(readManagedPluginInstall(install.installDir)).resolves.toEqual(
      expect.objectContaining({
        config: expect.objectContaining({
          source: {
            marketplace: 'team',
            plugin: 'reviewer',
            type: 'marketplace'
          }
        })
      })
    )
  })

  it('rejects journals with extra fields before using their paths', async () => {
    const workspace = await createWorkspace()
    const install = await createManagedInstall(workspace)
    await stageManagedPluginRemoval({
      cwd: workspace,
      env: process.env,
      install,
      operationId: token('d')
    })
    const journalPath = path.resolve(
      getManagedPluginsRoot(workspace, process.env),
      '.removal-journals',
      `${token('d')}.json`
    )
    const journal = JSON.parse(await readFile(journalPath, 'utf8')) as Record<string, unknown>
    await writeFile(journalPath, `${JSON.stringify({ ...journal, unexpectedPath: '/tmp/escape' })}\n`)

    await expect(recoverManagedPluginRemovals({
      cwd: workspace,
      env: process.env,
      isDeclarationPresent: () => false
    })).rejects.toThrow('journal is invalid')
  })

  it('rejects a symlinked install root without renaming or deleting its target', async () => {
    const workspace = await createWorkspace()
    const install = await createManagedInstall(workspace)
    const outside = await mkdtemp(path.join(tmpdir(), 'ow-managed-outside-'))
    tempDirs.push(outside)
    await rm(install.installDir, { recursive: true })
    await writeFile(path.join(outside, 'sentinel.txt'), 'keep\n')
    await symlink(outside, install.installDir)

    await expect(stageManagedPluginRemoval({
      cwd: workspace,
      env: process.env,
      install,
      operationId: token('e')
    })).rejects.toThrow('must be a real directory')
    await expect(readFile(path.join(outside, 'sentinel.txt'), 'utf8')).resolves.toBe('keep\n')
  })

  it('fails closed when a quarantine entry is swapped for a symlink before recovery', async () => {
    const workspace = await createWorkspace()
    const install = await createManagedInstall(workspace)
    const handle = await stageManagedPluginRemoval({
      cwd: workspace,
      env: process.env,
      install,
      operationId: token('9')
    })
    const outside = await mkdtemp(path.join(tmpdir(), 'ow-managed-swap-'))
    tempDirs.push(outside)
    const quarantineDir = path.join(path.dirname(install.installDir), handle.quarantineName)
    await writeFile(path.join(outside, 'sentinel.txt'), 'keep\n')
    await rename(quarantineDir, path.join(outside, 'quarantine'))
    await symlink(path.join(outside, 'quarantine'), quarantineDir)

    await expect(recoverManagedPluginRemovals({
      cwd: workspace,
      env: process.env,
      isDeclarationPresent: () => false
    })).rejects.toThrow('must be a real directory')
    await expect(readFile(path.join(outside, 'sentinel.txt'), 'utf8')).resolves.toBe('keep\n')
  })

  it('fails closed when a final-boundary quarantine swap preserves the manifest but changes its inode', async () => {
    const workspace = await createWorkspace()
    const install = await createManagedInstall(workspace)
    const handle = await stageManagedPluginRemoval({
      cwd: workspace,
      env: process.env,
      install,
      operationId: token('5')
    })
    const quarantineDir = path.join(path.dirname(install.installDir), handle.quarantineName)
    const outside = await mkdtemp(path.join(tmpdir(), 'ow-managed-final-swap-'))
    tempDirs.push(outside)
    const replacementDir = path.join(outside, 'replacement')
    await mkdir(path.join(replacementDir, 'native'), { recursive: true })
    await mkdir(path.join(replacementDir, 'oneworks'), { recursive: true })
    await writeFile(path.join(replacementDir, 'oneworks', 'plugin.json'), '{}\n')
    await writeFile(
      getManagedPluginConfigPath(replacementDir),
      await readFile(getManagedPluginConfigPath(quarantineDir), 'utf8')
    )

    await expect(recoverManagedPluginRemovals({
      cwd: workspace,
      env: process.env,
      isDeclarationPresent: () => true,
      runtime: {
        beforePathMutation: (operation) => {
          if (operation !== 'rename') return
          renameSync(quarantineDir, path.join(outside, 'original'))
          renameSync(replacementDir, quarantineDir)
        }
      }
    })).rejects.toThrow('changed at the rename boundary')
    await expect(stat(install.installDir)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readManagedPluginInstall(path.join(outside, 'original'))).resolves.toBeDefined()
    await expect(readManagedPluginInstall(quarantineDir)).resolves.toBeDefined()
  })

  it('rejects an equivalent-manifest wrong inode in existing-install recovery without deleting it', async () => {
    const workspace = await createWorkspace()
    const install = await createManagedInstall(workspace)
    const handle = await stageManagedPluginRemoval({
      cwd: workspace,
      env: process.env,
      install,
      operationId: token('0')
    })
    const quarantineDir = path.join(path.dirname(install.installDir), handle.quarantineName)
    const outside = await mkdtemp(path.join(tmpdir(), 'ow-managed-existing-swap-'))
    tempDirs.push(outside)
    await rename(quarantineDir, path.join(outside, 'original'))
    await mkdir(path.join(install.installDir, 'native'), { recursive: true })
    await mkdir(path.join(install.installDir, 'oneworks'), { recursive: true })
    await writeFile(path.join(install.installDir, 'oneworks', 'plugin.json'), '{}\n')
    await writeFile(
      getManagedPluginConfigPath(install.installDir),
      await readFile(getManagedPluginConfigPath(path.join(outside, 'original')), 'utf8')
    )

    await expect(recoverManagedPluginRemovals({
      cwd: workspace,
      env: process.env,
      isDeclarationPresent: () => true
    })).rejects.toThrow('changed before its identity-owned mutation')
    await expect(readManagedPluginInstall(install.installDir)).resolves.toBeDefined()
    await expect(readManagedPluginInstall(path.join(outside, 'original'))).resolves.toBeDefined()
  })

  it('revalidates the quarantine inode at the recursive cleanup boundary', async () => {
    const workspace = await createWorkspace()
    const install = await createManagedInstall(workspace)
    const outside = await mkdtemp(path.join(tmpdir(), 'ow-managed-cleanup-swap-'))
    tempDirs.push(outside)
    let quarantineDir = ''
    const handle = await stageManagedPluginRemoval({
      cwd: workspace,
      env: process.env,
      install,
      operationId: token('4'),
      runtime: {
        beforePathMutation: (operation) => {
          if (operation !== 'remove') return
          renameSync(quarantineDir, path.join(outside, 'quarantine'))
          mkdirSync(quarantineDir)
        }
      }
    })
    quarantineDir = path.join(path.dirname(install.installDir), handle.quarantineName)
    await writeFile(path.join(outside, 'sentinel.txt'), 'keep\n')

    await expect(commitManagedPluginRemoval(handle)).rejects.toThrow('changed at the recursive removal boundary')
    await expect(readFile(path.join(outside, 'sentinel.txt'), 'utf8')).resolves.toBe('keep\n')
    await expect(readManagedPluginInstall(path.join(outside, 'quarantine'))).resolves.toEqual(
      expect.objectContaining({ config: expect.objectContaining({ name: 'reviewer' }) })
    )
    await expect(stat(quarantineDir)).resolves.toBeDefined()
  })

  it('recovers after the production recursive cleanup partially mutates then crashes', async () => {
    const workspace = await createWorkspace()
    const install = await createManagedInstall(workspace)
    let injectedRemovalCalls = 0
    const handle = await stageManagedPluginRemoval({
      cwd: workspace,
      env: process.env,
      install,
      operationId: token('3'),
      runtime: {
        removeDirectory: (targetPath) => {
          injectedRemovalCalls += 1
          rmSync(path.join(targetPath, 'native'), { recursive: true })
          throw new Error('injected cleanup crash')
        }
      }
    })
    await expect(commitManagedPluginRemoval(handle)).rejects.toThrow('injected cleanup crash')
    expect(injectedRemovalCalls).toBe(1)
    const journalPath = path.join(
      getManagedPluginsRoot(workspace, process.env),
      '.removal-journals',
      `${token('3')}.json`
    )
    await expect(stat(journalPath)).resolves.toBeDefined()

    const concurrentInstall = await createManagedInstall(workspace, {
      plugin: 'concurrent',
      scope: 'concurrent',
      slug: 'team--concurrent'
    })
    const concurrentHandle = await stageManagedPluginRemoval({
      cwd: workspace,
      env: process.env,
      install: concurrentInstall,
      operationId: token('2')
    })
    await expect(commitManagedPluginRemoval(concurrentHandle)).resolves.toBeUndefined()
    expect(injectedRemovalCalls).toBe(1)

    await expect(recoverManagedPluginRemovals({
      cwd: workspace,
      env: process.env,
      isDeclarationPresent: () => false
    })).resolves.toEqual([
      expect.objectContaining({ action: 'cleaned', operationId: token('3') })
    ])
    expect(injectedRemovalCalls).toBe(1)
    await expect(stat(journalPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('recovers a real partially removed quarantine after an interrupted cleanup', async () => {
    const workspace = await createWorkspace()
    const install = await createManagedInstall(workspace)
    const handle = await stageManagedPluginRemoval({
      cwd: workspace,
      env: process.env,
      install,
      operationId: token('8')
    })
    const quarantineDir = path.join(path.dirname(install.installDir), handle.quarantineName)
    await rm(path.join(quarantineDir, 'native'), { recursive: true })

    await expect(recoverManagedPluginRemovals({
      cwd: workspace,
      env: process.env,
      isDeclarationPresent: () => false
    })).resolves.toEqual([
      expect.objectContaining({ action: 'cleaned', operationId: token('8') })
    ])
    await commitManagedPluginRemoval(handle)
    await expect(getManagedPluginRemovalCompletion({
      cwd: workspace,
      env: process.env,
      operationId: token('8')
    })).resolves.toEqual(expect.objectContaining({
      identity: expect.objectContaining({ plugin: 'reviewer' }),
      operationId: token('8')
    }))
    await expect(stageManagedPluginRemoval({
      cwd: workspace,
      env: process.env,
      install,
      operationId: token('8')
    })).rejects.toThrow('already complete')
  })

  it('fails closed when a removal journal is missing without a completion receipt', async () => {
    const workspace = await createWorkspace()
    const install = await createManagedInstall(workspace)
    const handle = await stageManagedPluginRemoval({
      cwd: workspace,
      env: process.env,
      install,
      operationId: token('7')
    })
    await rm(path.join(
      getManagedPluginsRoot(workspace, process.env),
      '.removal-journals',
      `${token('7')}.json`
    ))

    await expect(commitManagedPluginRemoval(handle)).rejects.toThrow('journal is missing')
  })

  it('fails closed when a completion receipt is corrupted', async () => {
    const workspace = await createWorkspace()
    const install = await createManagedInstall(workspace)
    const handle = await stageManagedPluginRemoval({
      cwd: workspace,
      env: process.env,
      install,
      operationId: token('6')
    })
    await commitManagedPluginRemoval(handle)
    await writeFile(
      path.join(
        getManagedPluginsRoot(workspace, process.env),
        '.removal-receipts',
        `${token('6')}.json`
      ),
      '{"version":1}\n'
    )

    await expect(getManagedPluginRemovalCompletion({
      cwd: workspace,
      env: process.env,
      operationId: token('6')
    })).rejects.toThrow('completion receipt is invalid')
  })

  it('invalidates async descendant reentrancy after the parent lease releases', async () => {
    const workspace = await createWorkspace()
    const startDescendant = createDeferred()
    const descendantFinished = createDeferred()
    let descendantEntered = false
    let descendantObservedActive = true
    let descendant: Promise<void> | undefined

    await withManagedPluginMutationLock({ cwd: workspace, env: process.env }, async () => {
      descendant = (async () => {
        await startDescendant.promise
        descendantObservedActive = isManagedPluginMutationActive({ cwd: workspace, env: process.env })
        await withManagedPluginMutationLock({ cwd: workspace, env: process.env }, async () => {
          descendantEntered = true
        })
        descendantFinished.resolve()
      })()
    })

    const lockAcquired = createDeferred()
    const releaseLaterLock = createDeferred()
    const laterLock = withManagedPluginMutationLock({ cwd: workspace, env: process.env }, async () => {
      lockAcquired.resolve()
      await releaseLaterLock.promise
    })
    await lockAcquired.promise
    startDescendant.resolve()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(descendantObservedActive).toBe(false)
    expect(descendantEntered).toBe(false)
    releaseLaterLock.resolve()
    await laterLock
    await descendant
    await descendantFinished.promise
    expect(descendantEntered).toBe(true)
  })

  it('serializes remove work behind the canonical workspace mutation lock', async () => {
    const workspace = await createWorkspace()
    const install = await createManagedInstall(workspace)
    const acquired = createDeferred()
    const releaseLock = createDeferred()
    const held = withManagedPluginMutationLock({
      cwd: workspace,
      env: process.env
    }, async () => {
      acquired.resolve()
      await releaseLock.promise
    })
    await acquired.promise

    let staged = false
    const pendingRemoval = stageManagedPluginRemoval({
      cwd: workspace,
      env: process.env,
      install,
      operationId: token('f')
    }).then((handle) => {
      staged = true
      return handle
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(staged).toBe(false)
    releaseLock.resolve()
    await held
    const handle = await pendingRemoval
    expect(staged).toBe(true)
    await commitManagedPluginRemoval(handle)
  })

  it('waits for the canonical lock when another process holds its directory lease', async () => {
    const workspace = await createWorkspace()
    const lockDir = getManagedPluginMutationLockDir(workspace)
    await mkdir(path.dirname(lockDir), { recursive: true })
    const child = spawn(process.execPath, [
      '-e',
      `
      const fs = require('node:fs/promises')
      const lockDir = process.argv[1]
      ;(async () => {
        await fs.mkdir(lockDir)
        await fs.writeFile(require('node:path').join(lockDir, '.oneworks-lock.json'), JSON.stringify({ createdAt: Date.now(), pid: process.pid }))
        process.stdout.write('ready\\n')
        setTimeout(async () => {
          await fs.rm(lockDir, { recursive: true, force: true })
        }, 80)
      })().catch(error => { process.stderr.write(String(error)); process.exitCode = 1 })
    `,
      lockDir
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    if (child.stdout == null) throw new Error('Expected child lock output')
    await once(child.stdout, 'data')
    const childExited = once(child, 'exit')

    let entered = false
    const pending = withManagedPluginMutationLock({ cwd: workspace, env: process.env }, async () => {
      entered = true
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(entered).toBe(false)
    await pending
    await childExited
    expect(entered).toBe(true)
  })

  it('serializes a concurrent install and remove through the same canonical workspace lock', async () => {
    const workspace = await createWorkspace()
    const install = await createManagedInstall(workspace)
    const sourceRoot = path.join(workspace, 'plugin-source')
    await mkdir(sourceRoot, { recursive: true })
    await writeFile(path.join(sourceRoot, 'plugin.json'), '{}\n')
    const conversionStarted = createDeferred()
    const releaseConversion = createDeferred()
    const pendingInstall = installAdapterPluginWithInstaller({
      adapter: 'claude',
      parseSource: async () => ({ path: sourceRoot, type: 'path' }),
      detectPluginRoot: async root => root,
      readManifest: async () => ({ name: 'installed-after-lock' }),
      convertToOneWorks: async ({ oneworksRoot }) => {
        conversionStarted.resolve()
        await releaseConversion.promise
        await writeFile(path.join(oneworksRoot, 'plugin.json'), '{}\n')
      }
    }, {
      cwd: workspace,
      env: process.env,
      silent: true,
      source: sourceRoot
    })
    await conversionStarted.promise

    let staged = false
    const pendingRemoval = stageManagedPluginRemoval({
      cwd: path.join(workspace, '.'),
      env: process.env,
      install,
      operationId: token('1')
    }).then((handle) => {
      staged = true
      return handle
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(staged).toBe(false)
    releaseConversion.resolve()
    await pendingInstall
    const handle = await pendingRemoval
    expect(staged).toBe(true)
    await commitManagedPluginRemoval(handle)
  })
})
