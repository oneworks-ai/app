import { lstat, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  persistAdapterAccountArtifacts,
  removeStoredAdapterAccount,
  resolveAdapterAccountDir,
  resolveAdapterAccountReadDirs,
  resolveAdapterAccountsRoot
} from '#~/adapter-account.js'
import { resolveProjectHomePath } from '#~/ai-path.js'

import { createAdapterAccountTestContext } from './adapter-account-test-helpers'

const { cleanup, createTempDir, pathExists } = createAdapterAccountTestContext()
afterEach(cleanup)

describe('adapter account artifact security', () => {
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
      expect(resolveAdapterAccountReadDirs(workspace, env, 'codex', key)).toEqual([persisted.get(key)])
      expect(await readFile(join(persisted.get(key)!, 'auth.json'), 'utf8')).toBe(key)
    }

    await removeStoredAdapterAccount({ cwd: workspace, env, adapter: 'codex', account: 'work' })
    await removeStoredAdapterAccount({ cwd: workspace, env, adapter: 'codex', account: 'Cafe\u0301' })
    expect(await pathExists(persisted.get('work')!)).toBe(false)
    expect(await pathExists(persisted.get('Cafe\u0301')!)).toBe(false)
    for (const key of ['Work', 'Café', 'normal']) {
      expect(await readFile(join(persisted.get(key)!, 'auth.json'), 'utf8')).toBe(key)
    }
  }, 30_000)

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
    await removeStoredAdapterAccount({ cwd: workspace, env, adapter: 'legacyadapter', account: 'work' })
    expect(await readFile(join(exactLegacyDir, 'auth.json'), 'utf8')).toBe('legacy-stable')
    await removeStoredAdapterAccount({ cwd: workspace, env, adapter: 'LegacyAdapter', account: 'Work' })
    expect(await pathExists(exactLegacyDir)).toBe(false)
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
})
