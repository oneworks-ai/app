import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  migrateStoredAdapterAccounts,
  persistAdapterAccountArtifacts,
  removeStoredAdapterAccount,
  resolveAdapterAccountReadDirs,
  resolveAdapterAccountReadRoots,
  resolveAdapterAccountsRoot
} from '#~/adapter-account.js'
import { resolveProjectHomePath } from '#~/ai-path.js'

const tempDirs: string[] = []

const createTempDir = async (prefix: string) => {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

const pathExists = async (targetPath: string) => {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('adapter account utils', () => {
  it('stores adapter account snapshots in the primary worktree when one exists', async () => {
    const primaryDir = await createTempDir('ow-account-primary-')
    const worktreeDir = await createTempDir('ow-account-worktree-')
    const homeDir = await createTempDir('ow-account-home-')
    const env = {
      HOME: homeDir,
      __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: primaryDir
    }

    expect(resolveAdapterAccountsRoot(worktreeDir, env, 'codex')).toEqual(
      resolveProjectHomePath(primaryDir, env, '.local', 'adapters', 'codex', 'accounts')
    )
  })

  it('writes adapter account artifacts into the shared primary-worktree directory', async () => {
    const primaryDir = await createTempDir('ow-account-primary-')
    const worktreeDir = await createTempDir('ow-account-worktree-')
    const homeDir = await createTempDir('ow-account-home-')
    const env = {
      HOME: homeDir,
      __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: primaryDir
    }
    const primaryAuthPath = resolveProjectHomePath(
      primaryDir,
      env,
      '.local',
      'adapters',
      'codex',
      'accounts',
      'shared',
      'auth.json'
    )
    const legacyPrimaryAuthPath = join(
      primaryDir,
      '.oo',
      '.local',
      'adapters',
      'codex',
      'accounts',
      'shared',
      'auth.json'
    )
    const worktreeAuthPath = join(
      worktreeDir,
      '.oo',
      '.local',
      'adapters',
      'codex',
      'accounts',
      'shared',
      'auth.json'
    )

    await persistAdapterAccountArtifacts({
      cwd: worktreeDir,
      env,
      adapter: 'codex',
      account: 'shared',
      artifacts: [
        {
          path: 'auth.json',
          content: '{}'
        }
      ]
    })

    expect(await pathExists(primaryAuthPath)).toBe(true)
    expect(await pathExists(legacyPrimaryAuthPath)).toBe(false)
    expect(await pathExists(worktreeAuthPath)).toBe(false)
  })

  it('does not backfill legacy account directories into the shared home root before reading', async () => {
    const primaryDir = await createTempDir('ow-account-primary-')
    const worktreeDir = await createTempDir('ow-account-worktree-')
    const homeDir = await createTempDir('ow-account-home-')
    const env = {
      HOME: homeDir,
      __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: primaryDir
    }
    const primaryAccountDir = join(primaryDir, '.oo', '.local', 'adapters', 'codex', 'accounts', 'shared')
    const currentAccountDir = join(worktreeDir, '.oo', '.local', 'adapters', 'codex', 'accounts', 'current')
    const homeSharedAuthPath = resolveProjectHomePath(
      primaryDir,
      env,
      '.local',
      'adapters',
      'codex',
      'accounts',
      'shared',
      'auth.json'
    )
    const homeCurrentAuthPath = resolveProjectHomePath(
      primaryDir,
      env,
      '.local',
      'adapters',
      'codex',
      'accounts',
      'current',
      'auth.json'
    )

    await mkdir(primaryAccountDir, { recursive: true })
    await mkdir(currentAccountDir, { recursive: true })
    await writeFile(join(primaryAccountDir, 'auth.json'), '{"source":"primary"}')
    await writeFile(join(currentAccountDir, 'auth.json'), '{"source":"current"}')

    await migrateStoredAdapterAccounts(worktreeDir, env)

    expect(resolveAdapterAccountReadRoots(worktreeDir, env, 'codex')).toEqual([
      resolveProjectHomePath(primaryDir, env, '.local', 'adapters', 'codex', 'accounts')
    ])
    expect(resolveAdapterAccountReadDirs(worktreeDir, env, 'codex', 'shared')).toEqual([
      resolveProjectHomePath(primaryDir, env, '.local', 'adapters', 'codex', 'accounts', 'shared')
    ])
    expect(await pathExists(homeSharedAuthPath)).toBe(false)
    expect(await pathExists(homeCurrentAuthPath)).toBe(false)
    expect(await pathExists(join(primaryAccountDir, 'auth.json'))).toBe(true)
    expect(await pathExists(join(currentAccountDir, 'auth.json'))).toBe(true)
  })

  it('removes matching account snapshots only from the shared home root', async () => {
    const primaryDir = await createTempDir('ow-account-primary-')
    const worktreeDir = await createTempDir('ow-account-worktree-')
    const homeDir = await createTempDir('ow-account-home-')
    const env = {
      HOME: homeDir,
      __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: primaryDir
    }
    const currentAccountDir = join(worktreeDir, '.oo', '.local', 'adapters', 'codex', 'accounts', 'shared')
    const primaryAccountDir = join(primaryDir, '.oo', '.local', 'adapters', 'codex', 'accounts', 'shared')
    const homeAccountDir = resolveProjectHomePath(
      primaryDir,
      env,
      '.local',
      'adapters',
      'codex',
      'accounts',
      'shared'
    )

    await mkdir(currentAccountDir, { recursive: true })
    await mkdir(primaryAccountDir, { recursive: true })
    await mkdir(homeAccountDir, { recursive: true })
    await writeFile(join(currentAccountDir, 'auth.json'), '{}')
    await writeFile(join(primaryAccountDir, 'auth.json'), '{}')
    await writeFile(join(homeAccountDir, 'auth.json'), '{}')

    await removeStoredAdapterAccount({
      cwd: worktreeDir,
      env,
      adapter: 'codex',
      account: 'shared'
    })

    expect(await pathExists(currentAccountDir)).toBe(true)
    expect(await pathExists(primaryAccountDir)).toBe(true)
    expect(await pathExists(homeAccountDir)).toBe(false)
  })
})
