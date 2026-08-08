import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  compareAdapterCredentialRevisions,
  createAdapterCredentialRevision,
  filterActiveAdapterAccounts,
  migrateStoredAdapterAccounts,
  normalizeAdapterAccountTombstones,
  persistAdapterAccountArtifacts,
  removeStoredAdapterAccount,
  resolveAdapterAccountDir,
  resolveAdapterAccountReadDirs,
  resolveAdapterAccountReadRoots,
  resolveAdapterAccountsRoot,
  resolveGlobalAdapterAccountDir
} from '#~/adapter-account.js'
import { resolveProjectHomePath } from '#~/ai-path.js'

import { createAdapterAccountTestContext } from './adapter-account-test-helpers'

const { cleanup, createTempDir, pathExists } = createAdapterAccountTestContext()
afterEach(cleanup)

describe('adapter account utils', () => {
  it('shares the credential revision domain and fails explicitly on counter overflow', () => {
    const uuid = '00000000-0000-0000-0000-000000000001'
    expect(compareAdapterCredentialRevisions(`0002:${uuid.toUpperCase()}`, `1:${uuid}`)).toBe(1)
    expect(() => createAdapterCredentialRevision(`${Number.MAX_SAFE_INTEGER}:${uuid}`)).toThrow(RangeError)
    expect(createAdapterCredentialRevision(`not-a-revision:${uuid}`)).toMatch(
      /^1:[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u
    )
  })

  it('filters stale accounts with generic deletion revisions', () => {
    const tombstones = normalizeAdapterAccountTombstones({
      deleted: 'generation-deleted',
      recreated: 'generation-old',
      invalid: 20,
      empty: ''
    })

    expect(tombstones).toEqual({
      deleted: ['generation-deleted'],
      recreated: ['generation-old']
    })
    expect(filterActiveAdapterAccounts({
      deleted: { generation: 'generation-deleted' },
      recreated: { generation: 'generation-new' },
      legacy: { title: 'Legacy' }
    }, tombstones)).toEqual({
      recreated: { generation: 'generation-new' },
      legacy: { title: 'Legacy' }
    })

    expect(normalizeAdapterAccountTombstones({
      deleted: ['generation-one', 'generation-two', 'generation-one']
    })).toEqual({ deleted: ['generation-one', 'generation-two'] })
  })

  it('resolves global adapter account directories and rejects traversal segments', async () => {
    const homeDir = await createTempDir('ow-account-global-home-')
    const env = { __ONEWORKS_PROJECT_REAL_HOME__: homeDir }

    expect(resolveGlobalAdapterAccountDir(env, 'claude-code', 'work')).toMatch(
      /\/\.oneworks\/adapters\/v1-[0-9a-f]{64}\/accounts\/v1-[0-9a-f]{64}$/u
    )
    expect(() => resolveGlobalAdapterAccountDir(env, '../claude', 'work')).toThrow(/adapter path segment/i)
    expect(() => resolveGlobalAdapterAccountDir(env, 'claude-code', '../work')).toThrow(/account path segment/i)
    expect(() => resolveGlobalAdapterAccountDir(env, 'C:claude', 'work')).toThrow(/adapter path segment/i)
    expect(() => resolveGlobalAdapterAccountDir(env, 'NUL', 'work')).toThrow(/adapter path segment/i)
    expect(() => resolveAdapterAccountsRoot(homeDir, env, 'codex/other')).toThrow(/adapter path segment/i)
    expect(() => resolveAdapterAccountReadDirs(homeDir, env, 'codex', '..\\work')).toThrow(/account path segment/i)
  })

  it('stores adapter account snapshots in the primary worktree when one exists', async () => {
    const primaryDir = await createTempDir('ow-account-primary-')
    const worktreeDir = await createTempDir('ow-account-worktree-')
    const homeDir = await createTempDir('ow-account-home-')
    const env = {
      HOME: homeDir,
      __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: primaryDir
    }

    expect(resolveAdapterAccountsRoot(worktreeDir, env, 'codex')).toMatch(
      /\/\.local\/adapters\/v1-[0-9a-f]{64}\/accounts$/u
    )
    expect(resolveAdapterAccountsRoot(worktreeDir, env, 'codex')).toContain(
      resolveProjectHomePath(primaryDir, env)
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

    const persisted = await persistAdapterAccountArtifacts({
      cwd: worktreeDir,
      env,
      adapter: 'codex',
      account: 'shared',
      artifacts: [{ path: 'auth.json', content: '{}' }]
    })

    expect(persisted.accountDir.startsWith(await realpath(resolveProjectHomePath(primaryDir, env)))).toBe(true)
    expect(resolveAdapterAccountReadDirs(worktreeDir, env, 'codex', 'shared')).toEqual([persisted.accountDir])
    expect(await readFile(join(persisted.accountDir, 'auth.json'), 'utf8')).toBe('{}')
    expect(await pathExists(primaryAuthPath)).toBe(false)
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
      resolveAdapterAccountsRoot(worktreeDir, env, 'codex')
    ])
    expect(resolveAdapterAccountReadDirs(worktreeDir, env, 'codex', 'shared')).toEqual([
      resolveAdapterAccountDir(worktreeDir, env, 'codex', 'shared')
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

    await removeStoredAdapterAccount({ cwd: worktreeDir, env, adapter: 'codex', account: 'shared' })

    expect(await pathExists(currentAccountDir)).toBe(true)
    expect(await pathExists(primaryAccountDir)).toBe(true)
    expect(await pathExists(homeAccountDir)).toBe(false)
  })
})
