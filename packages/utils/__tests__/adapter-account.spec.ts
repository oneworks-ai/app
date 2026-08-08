import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

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
      artifacts: [
        {
          path: 'auth.json',
          content: '{}'
        }
      ]
    })

    expect(persisted.accountDir.startsWith(await realpath(resolveProjectHomePath(primaryDir, env)))).toBe(true)
    expect(resolveAdapterAccountReadDirs(worktreeDir, env, 'codex', 'shared')).toEqual([
      persisted.accountDir
    ])
    expect(await readFile(join(persisted.accountDir, 'auth.json'), 'utf8')).toBe('{}')
    expect(await pathExists(primaryAuthPath)).toBe(false)
    expect(await pathExists(legacyPrimaryAuthPath)).toBe(false)
    expect(await pathExists(worktreeAuthPath)).toBe(false)
  })

  it('rejects unsafe, duplicate, and prefix-colliding artifact paths', async () => {
    const workspace = await createTempDir('ow-account-artifact-paths-')
    const homeDir = await createTempDir('ow-account-artifact-home-')
    const base = { cwd: workspace, env: { HOME: homeDir }, adapter: 'codex', account: 'work' }
    const unsafePaths = [
      '/tmp/auth.json',
      'C:/auth.json',
      '\\\\server\\auth.json',
      'nested\\auth.json',
      'nested//auth.json',
      './auth.json',
      'nested/../auth.json',
      'auth.json\0suffix',
      'NUL',
      'nested/CON.json',
      'nested/auth:.json',
      'nested./auth.json',
      'nested /auth.json'
    ]

    for (const path of unsafePaths) {
      await expect(persistAdapterAccountArtifacts({
        ...base,
        artifacts: [{ path, content: '{}' }]
      })).rejects.toThrow(/artifact path/i)
    }
    await expect(persistAdapterAccountArtifacts({
      ...base,
      artifacts: [
        { path: 'Auth.json', content: 'one' },
        { path: 'auth.json', content: 'two' }
      ]
    })).rejects.toThrow(/collide/i)
    await expect(persistAdapterAccountArtifacts({
      ...base,
      artifacts: [
        { path: 'auth', content: 'file' },
        { path: 'auth/token.json', content: 'nested' }
      ]
    })).rejects.toThrow(/collide/i)
  })

  it('reserves internal store and lock names with portable case folding', async () => {
    const workspace = await createTempDir('ow-account-artifact-reserved-')
    const homeDir = await createTempDir('ow-account-artifact-home-')
    const env = { HOME: homeDir }
    const work = await persistAdapterAccountArtifacts({
      cwd: workspace,
      env,
      adapter: 'codex',
      account: 'work',
      artifacts: [{ path: 'auth.json', content: 'work-stable' }]
    })
    const other = await persistAdapterAccountArtifacts({
      cwd: workspace,
      env,
      adapter: 'codex',
      account: 'other',
      artifacts: [{ path: 'auth.json', content: 'other-stable' }]
    })

    const storeVariants = [
      '.OneWorks-Account-Store',
      '.ONEWORKS-ACCOUNT-STORE',
      '.ＯＮＥＷＯＲＫＳ-ＡＣＣＯＵＮＴ-ＳＴＯＲＥ',
      '.OneWorks-Account-Locks'
    ]
    for (const reserved of storeVariants) {
      await expect(persistAdapterAccountArtifacts({
        cwd: workspace,
        env,
        adapter: 'codex',
        account: reserved,
        artifacts: [{ path: 'auth.json', content: 'must-not-write' }]
      })).rejects.toThrow(/account path segment/i)
      await expect(removeStoredAdapterAccount({
        cwd: workspace,
        env,
        adapter: 'codex',
        account: reserved
      })).rejects.toThrow(/account path segment/i)
      await expect(persistAdapterAccountArtifacts({
        cwd: workspace,
        env,
        adapter: reserved,
        account: 'safe',
        artifacts: [{ path: 'auth.json', content: 'must-not-write' }]
      })).rejects.toThrow(/adapter path segment/i)
      await expect(removeStoredAdapterAccount({
        cwd: workspace,
        env,
        adapter: reserved,
        account: 'safe'
      })).rejects.toThrow(/adapter path segment/i)
    }

    expect(resolveAdapterAccountReadDirs(workspace, env, 'codex', 'work')).toEqual([work.accountDir])
    expect(resolveAdapterAccountReadDirs(workspace, env, 'codex', 'other')).toEqual([other.accountDir])
    expect(await readFile(join(work.accountDir, 'auth.json'), 'utf8')).toBe('work-stable')
    expect(await readFile(join(other.accountDir, 'auth.json'), 'utf8')).toBe('other-stable')
  })

  it('isolates case and Unicode-normalization variants with encoded account keys', async () => {
    const workspace = await createTempDir('ow-account-artifact-key-alias-')
    const homeDir = await createTempDir('ow-account-artifact-home-')
    const env = { HOME: homeDir }
    const keys = ['Work', 'work', 'Café', 'Cafe\u0301', 'normal']
    const persisted = new Map<string, string>()
    for (const key of keys) {
      const result = await persistAdapterAccountArtifacts({
        cwd: workspace,
        env,
        adapter: 'codex',
        account: key,
        artifacts: [{ path: 'auth.json', content: key }]
      })
      persisted.set(key, result.accountDir)
    }

    expect(new Set(persisted.values())).toHaveProperty('size', keys.length)
    for (const key of keys) {
      expect(resolveAdapterAccountReadDirs(workspace, env, 'codex', key)).toEqual([
        persisted.get(key)
      ])
      expect(await readFile(join(persisted.get(key)!, 'auth.json'), 'utf8')).toBe(key)
    }

    await removeStoredAdapterAccount({ cwd: workspace, env, adapter: 'codex', account: 'work' })
    await removeStoredAdapterAccount({ cwd: workspace, env, adapter: 'codex', account: 'Cafe\u0301' })
    expect(await pathExists(persisted.get('work')!)).toBe(false)
    expect(await pathExists(persisted.get('Cafe\u0301')!)).toBe(false)
    for (const key of ['Work', 'Café', 'normal']) {
      expect(await readFile(join(persisted.get(key)!, 'auth.json'), 'utf8')).toBe(key)
    }
  })

  it('isolates encoded adapter key variants and only removes exact legacy raw keys', async () => {
    const workspace = await createTempDir('ow-account-artifact-adapter-alias-')
    const homeDir = await createTempDir('ow-account-artifact-home-')
    const env = { HOME: homeDir }
    const adapters = ['CodexAlias', 'codexalias', 'CaféAdapter', 'Cafe\u0301Adapter']
    const persisted = new Map<string, string>()
    for (const adapter of adapters) {
      const result = await persistAdapterAccountArtifacts({
        cwd: workspace,
        env,
        adapter,
        account: 'work',
        artifacts: [{ path: 'auth.json', content: adapter }]
      })
      persisted.set(adapter, result.accountDir)
    }
    expect(new Set(persisted.values())).toHaveProperty('size', adapters.length)

    await removeStoredAdapterAccount({ cwd: workspace, env, adapter: 'codexalias', account: 'work' })
    expect(await pathExists(persisted.get('codexalias')!)).toBe(false)
    for (const adapter of ['CodexAlias', 'CaféAdapter', 'Cafe\u0301Adapter']) {
      expect(await readFile(join(persisted.get(adapter)!, 'auth.json'), 'utf8')).toBe(adapter)
    }

    const exactLegacyDir = resolveProjectHomePath(
      workspace,
      env,
      '.local',
      'adapters',
      'LegacyAdapter',
      'accounts',
      'Work'
    )
    await mkdir(exactLegacyDir, { recursive: true })
    await writeFile(join(exactLegacyDir, 'auth.json'), 'legacy-stable')
    await removeStoredAdapterAccount({
      cwd: workspace,
      env,
      adapter: 'legacyadapter',
      account: 'work'
    })
    expect(await readFile(join(exactLegacyDir, 'auth.json'), 'utf8')).toBe('legacy-stable')
    await removeStoredAdapterAccount({
      cwd: workspace,
      env,
      adapter: 'LegacyAdapter',
      account: 'Work'
    })
    expect(await pathExists(exactLegacyDir)).toBe(false)
  })

  it('replaces the complete artifact generation with private permissions', async () => {
    const workspace = await createTempDir('ow-account-artifact-replace-')
    const homeDir = await createTempDir('ow-account-artifact-home-')
    const params = { cwd: workspace, env: { HOME: homeDir }, adapter: 'codex', account: 'work' }

    const first = await persistAdapterAccountArtifacts({
      ...params,
      artifacts: [
        { path: 'auth.json', content: 'first' },
        { path: 'nested/meta.json', content: 'stale' }
      ]
    })
    const second = await persistAdapterAccountArtifacts({
      ...params,
      artifacts: [
        { path: 'auth.json', content: 'second' },
        { path: 'fresh/state.json', content: 'fresh' }
      ]
    })

    expect(resolveAdapterAccountReadDirs(workspace, params.env, 'codex', 'work')).toEqual([
      second.accountDir
    ])
    expect(await readFile(join(first.accountDir, 'auth.json'), 'utf8')).toBe('first')
    expect(await readFile(join(first.accountDir, 'nested/meta.json'), 'utf8')).toBe('stale')
    expect(await readFile(join(second.accountDir, 'auth.json'), 'utf8')).toBe('second')
    expect(await pathExists(join(second.accountDir, 'nested/meta.json'))).toBe(false)
    expect(await readFile(join(second.accountDir, 'fresh/state.json'), 'utf8')).toBe('fresh')
    if (process.platform !== 'win32') {
      expect((await stat(second.accountDir)).mode & 0o777).toBe(0o700)
      expect((await stat(join(second.accountDir, 'fresh'))).mode & 0o777).toBe(0o700)
      expect((await stat(join(second.accountDir, 'auth.json'))).mode & 0o777).toBe(0o600)
      expect((await stat(join(second.accountDir, 'fresh/state.json'))).mode & 0o777).toBe(0o600)
    }
  })

  it('serializes concurrent artifact generations and shares the same lock with removal', async () => {
    const workspace = await createTempDir('ow-account-artifact-concurrent-')
    const homeDir = await createTempDir('ow-account-artifact-home-')
    const params = { cwd: workspace, env: { HOME: homeDir }, adapter: 'codex', account: 'work' }

    await Promise.all([
      persistAdapterAccountArtifacts({
        ...params,
        artifacts: [
          { path: 'generation.txt', content: 'one' },
          { path: 'only-one.txt', content: 'one' }
        ]
      }),
      persistAdapterAccountArtifacts({
        ...params,
        artifacts: [
          { path: 'generation.txt', content: 'two' },
          { path: 'only-two.txt', content: 'two' }
        ]
      })
    ])

    const accountDir = resolveAdapterAccountReadDirs(workspace, params.env, 'codex', 'work')[0]!
    const generation = await readFile(join(accountDir, 'generation.txt'), 'utf8')
    expect((await readdir(accountDir)).sort()).toEqual(
      generation === 'one'
        ? ['generation.txt', 'only-one.txt']
        : ['generation.txt', 'only-two.txt']
    )

    await Promise.all([
      removeStoredAdapterAccount(params),
      persistAdapterAccountArtifacts({
        ...params,
        artifacts: [
          { path: 'generation.txt', content: 'three' },
          { path: 'only-three.txt', content: 'three' }
        ]
      })
    ])
    if (await pathExists(accountDir)) {
      expect((await readdir(accountDir)).sort()).toEqual(['generation.txt', 'only-three.txt'])
    }
  })

  it('preserves the prior generation when staging fails', async () => {
    const workspace = await createTempDir('ow-account-artifact-rollback-')
    const homeDir = await createTempDir('ow-account-artifact-home-')
    const params = { cwd: workspace, env: { HOME: homeDir }, adapter: 'codex', account: 'work' }
    const first = await persistAdapterAccountArtifacts({
      ...params,
      artifacts: [{ path: 'auth.json', content: 'stable' }]
    })

    await expect(persistAdapterAccountArtifacts({
      ...params,
      artifacts: [{ path: `${'a'.repeat(300)}.json`, content: 'failed' }]
    })).rejects.toThrow()

    expect(await readFile(join(first.accountDir, 'auth.json'), 'utf8')).toBe('stable')
    expect((await readdir(first.accountDir)).sort()).toEqual(['auth.json'])
  })

  it('rejects symlinked or non-directory account storage roots and accounts', async () => {
    const workspace = await createTempDir('ow-account-artifact-symlink-')
    const homeDir = await createTempDir('ow-account-artifact-home-')
    const env = { HOME: homeDir }
    const root = resolveAdapterAccountsRoot(workspace, env, 'codex')
    const external = await createTempDir('ow-account-artifact-external-')
    await mkdir(join(root, '..'), { recursive: true })
    await symlink(external, root, 'dir')

    await expect(persistAdapterAccountArtifacts({
      cwd: workspace,
      env,
      adapter: 'codex',
      account: 'work',
      artifacts: [{ path: 'auth.json', content: '{}' }]
    })).rejects.toThrow(/accounts root.*symbolic link/i)
    await rm(root, { force: true })
    await mkdir(root, { recursive: true })
    const invalidStateDir = resolveAdapterAccountDir(workspace, env, 'codex', 'not-a-directory')
    await mkdir(dirname(invalidStateDir), { recursive: true })
    await writeFile(invalidStateDir, 'file')
    await expect(persistAdapterAccountArtifacts({
      cwd: workspace,
      env,
      adapter: 'codex',
      account: 'not-a-directory',
      artifacts: [{ path: 'auth.json', content: '{}' }]
    })).rejects.toThrow(/account state directory.*real directory/i)
    const linkedStateDir = resolveAdapterAccountDir(workspace, env, 'codex', 'linked')
    await symlink(external, linkedStateDir, 'dir')
    await expect(removeStoredAdapterAccount({
      cwd: workspace,
      env,
      adapter: 'codex',
      account: 'linked'
    })).rejects.toThrow(/account state directory.*symbolic link/i)
    expect((await lstat(linkedStateDir)).isSymbolicLink()).toBe(true)
    expect(await pathExists(external)).toBe(true)
  })

  it('rejects symlinks at every project-home ancestor without touching their targets', async () => {
    for (const ancestorIndex of [0, 1, 2]) {
      const workspace = await createTempDir('ow-account-artifact-ancestor-')
      const homeDir = await createTempDir('ow-account-artifact-home-')
      const external = await createTempDir('ow-account-artifact-external-')
      const env = { HOME: homeDir }
      const projectHome = resolveProjectHomePath(workspace, env)
      const ancestorPath = [
        join(projectHome, '.local'),
        join(projectHome, '.local', 'adapters'),
        dirname(resolveAdapterAccountsRoot(workspace, env, 'codex'))
      ][ancestorIndex]!
      await writeFile(join(external, 'sentinel.txt'), 'unchanged')
      await mkdir(dirname(ancestorPath), { recursive: true })
      await symlink(external, ancestorPath, 'dir')

      const params = { cwd: workspace, env, adapter: 'codex', account: 'work' }
      await expect(persistAdapterAccountArtifacts({
        ...params,
        artifacts: [{ path: 'auth.json', content: 'changed' }]
      })).rejects.toThrow(/ancestor.*symbolic link/i)
      await expect(removeStoredAdapterAccount(params)).rejects.toThrow(/ancestor.*symbolic link/i)
      expect(await readFile(join(external, 'sentinel.txt'), 'utf8')).toBe('unchanged')
      expect(await readdir(external)).toEqual(['sentinel.txt'])
    }
  })

  it('keeps resolved generations readable during publication and cleans them on explicit removal', async () => {
    const workspace = await createTempDir('ow-account-artifact-reader-')
    const homeDir = await createTempDir('ow-account-artifact-home-')
    const params = { cwd: workspace, env: { HOME: homeDir }, adapter: 'codex', account: 'work' }
    await persistAdapterAccountArtifacts({
      ...params,
      artifacts: [
        { path: 'generation.txt', content: '0' },
        { path: 'only-0.txt', content: '0' }
      ]
    })

    let keepReading = true
    const errors: unknown[] = []
    const reader = async () => {
      while (keepReading) {
        try {
          const current = resolveAdapterAccountReadDirs(workspace, params.env, 'codex', 'work')[0]!
          const generation = await readFile(join(current, 'generation.txt'), 'utf8')
          expect((await readdir(current)).sort()).toEqual([
            'generation.txt',
            `only-${generation}.txt`
          ])
        } catch (error) {
          errors.push(error)
        }
        await new Promise(resolve => setTimeout(resolve, 1))
      }
    }
    const readers = [reader(), reader()]
    try {
      for (let generation = 1; generation <= 4; generation += 1) {
        await persistAdapterAccountArtifacts({
          ...params,
          artifacts: [
            { path: 'generation.txt', content: String(generation) },
            { path: `only-${generation}.txt`, content: String(generation) }
          ]
        })
      }
    } finally {
      keepReading = false
      await Promise.all(readers)
    }
    expect(errors).toEqual([])

    const current = resolveAdapterAccountReadDirs(workspace, params.env, 'codex', 'work')[0]!
    const generationsDir = dirname(current)
    const stateDir = dirname(generationsDir)
    expect((await readdir(generationsDir)).length).toBeGreaterThan(1)
    await removeStoredAdapterAccount(params)
    expect(await pathExists(stateDir)).toBe(false)
    expect(await pathExists(current)).toBe(false)
  }, 30_000)

  it('keeps the old generation current after an unpublished generation or pointer switch failure', async () => {
    const workspace = await createTempDir('ow-account-artifact-pointer-')
    const homeDir = await createTempDir('ow-account-artifact-home-')
    const params = { cwd: workspace, env: { HOME: homeDir }, adapter: 'codex', account: 'work' }
    const first = await persistAdapterAccountArtifacts({
      ...params,
      artifacts: [{ path: 'auth.json', content: 'stable' }]
    })
    const generationsDir = dirname(first.accountDir)
    const stateDir = dirname(generationsDir)
    const orphanGeneration = join(generationsDir, '00000000-0000-4000-8000-000000000001')
    await mkdir(orphanGeneration, { mode: 0o700 })
    await writeFile(join(orphanGeneration, 'auth.json'), 'unpublished', { mode: 0o600 })

    expect(resolveAdapterAccountReadDirs(workspace, params.env, 'codex', 'work')).toEqual([
      first.accountDir
    ])
    const pointerPath = join(stateDir, 'current')
    const savedPointerPath = join(stateDir, 'current.saved')
    await rename(pointerPath, savedPointerPath)
    await mkdir(pointerPath)
    await expect(persistAdapterAccountArtifacts({
      ...params,
      artifacts: [{ path: 'auth.json', content: 'must-not-publish' }]
    })).rejects.toThrow(/generation pointer.*real file/i)
    await rm(pointerPath, { recursive: true })
    await rename(savedPointerPath, pointerPath)

    expect(resolveAdapterAccountReadDirs(workspace, params.env, 'codex', 'work')).toEqual([
      first.accountDir
    ])
    expect(await readFile(join(first.accountDir, 'auth.json'), 'utf8')).toBe('stable')
    expect(await readFile(join(orphanGeneration, 'auth.json'), 'utf8')).toBe('unpublished')
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
