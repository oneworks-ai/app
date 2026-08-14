import { lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { prepareSafeKiroSessionLayout, syncSafeKiroKeychains } from '../src/runtime/safe-session-home'

const tempDirs: string[] = []

const createTempDir = async () => {
  const root = await mkdtemp(join(tmpdir(), 'oneworks-kiro-session-home-'))
  tempDirs.push(root)
  return root
}

const getPaths = (root: string) => {
  const cacheRoot = join(root, 'managed', 'caches')
  const sessionRoot = join(cacheRoot, 'ctx', 'session', 'adapter-kiro')
  return {
    cacheRoot,
    sessionRoot,
    legacySessionHome: join(sessionRoot, 'home'),
    kiroHome: join(sessionRoot, 'kiro-home')
  }
}

const prepare = (paths: ReturnType<typeof getPaths>, input: {
  beforeAtomicPrivateHomeCreate?: () => Promise<void> | void
} = {}) =>
  prepareSafeKiroSessionLayout({
    cacheRoot: paths.cacheRoot,
    kiroHome: paths.kiroHome,
    sessionRoot: paths.sessionRoot,
    ...(input.beforeAtomicPrivateHomeCreate != null
      ? { faultInjection: { beforeAtomicPrivateHomeCreate: input.beforeAtomicPrivateHomeCreate } }
      : {})
  })

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('kiro session home containment', () => {
  it('uses a fresh private 0700 HOME for create and resume without a filesystem Keychain bridge', async () => {
    const root = await createTempDir()
    const paths = getPaths(root)
    const realHome = join(root, 'real-home')
    const source = join(realHome, 'Library', 'Keychains')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'login.keychain-db'), 'fixture-only', 'utf8')

    const created = await prepare(paths)
    await expect(syncSafeKiroKeychains({ layout: created, platform: 'darwin', realHome }))
      .resolves.toBe('process-only')
    expect(created.sessionHome).not.toBe(paths.legacySessionHome)
    expect((await lstat(created.sessionHome)).mode & 0o077).toBe(0)
    await expect(lstat(join(created.sessionHome, 'Library'))).rejects.toMatchObject({ code: 'ENOENT' })

    const resumed = await prepare(paths)
    await expect(syncSafeKiroKeychains({ layout: resumed, platform: 'darwin', realHome }))
      .resolves.toBe('process-only')
    expect(resumed.sessionHome).not.toBe(created.sessionHome)
    expect(await readFile(join(source, 'login.keychain-db'), 'utf8')).toBe('fixture-only')
  })

  it('ignores a hostile legacy adapter-kiro/home symlink and never mutates its outside target', async () => {
    const root = await createTempDir()
    const paths = getPaths(root)
    const outside = join(root, 'outside-home')
    const sentinel = join(outside, 'sentinel.txt')
    await mkdir(paths.sessionRoot, { recursive: true })
    await mkdir(outside, { recursive: true })
    await writeFile(sentinel, 'unchanged', 'utf8')
    await symlink(outside, paths.legacySessionHome, 'dir')

    const layout = await prepare(paths)
    await expect(syncSafeKiroKeychains({ layout, platform: 'darwin', realHome: join(root, 'real-home') }))
      .resolves.toBe('process-only')
    expect(await readFile(sentinel, 'utf8')).toBe('unchanged')
    await expect(lstat(join(outside, 'Library'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a symlinked managed cache root before creating session descendants', async () => {
    const root = await createTempDir()
    const paths = getPaths(root)
    const outside = join(root, 'outside-cache-root')
    const sentinel = join(outside, 'sentinel.txt')
    await mkdir(join(root, 'managed'), { recursive: true })
    await mkdir(outside, { recursive: true })
    await writeFile(sentinel, 'unchanged', 'utf8')
    await symlink(outside, paths.cacheRoot, 'dir')

    await expect(prepare(paths)).rejects.toThrow(/managed cache root.*must not be a symlink/u)
    expect(await readFile(sentinel, 'utf8')).toBe('unchanged')
  })

  it.each(['ctx', 'session', 'adapter-kiro'])(
    'rejects a symlinked managed %s ancestor and preserves its outside sentinel',
    async (attackedSegment) => {
      const root = await createTempDir()
      const paths = getPaths(root)
      const segments = ['ctx', 'session', 'adapter-kiro']
      const index = segments.indexOf(attackedSegment)
      const parent = join(paths.cacheRoot, ...segments.slice(0, index))
      const attackedPath = join(parent, attackedSegment)
      const outside = join(root, `outside-${attackedSegment}`)
      const sentinel = join(outside, 'sentinel.txt')
      await mkdir(parent, { recursive: true })
      await mkdir(outside, { recursive: true })
      await writeFile(sentinel, 'unchanged', 'utf8')
      await symlink(outside, attackedPath, 'dir')

      await expect(prepare(paths)).rejects.toThrow(/must not.*symlink/u)
      expect(await readFile(sentinel, 'utf8')).toBe('unchanged')
    }
  )

  it('fault-injects a managed parent swap before atomic HOME creation without creating outside content', async () => {
    const root = await createTempDir()
    const paths = getPaths(root)
    const outside = join(root, 'outside-mkdir-race')
    const sentinel = join(outside, 'sentinel.txt')
    const quarantined = join(root, 'validated-session-root')
    await mkdir(outside, { recursive: true })
    await writeFile(sentinel, 'unchanged', 'utf8')

    await expect(prepare(paths, {
      beforeAtomicPrivateHomeCreate: async () => {
        await rename(paths.sessionRoot, quarantined)
        await symlink(outside, paths.sessionRoot, 'dir')
      }
    })).rejects.toThrow(/managed session root.*must not be a symlink/u)

    expect(await readFile(sentinel, 'utf8')).toBe('unchanged')
    await expect(lstat(join(outside, 'home'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(join(outside, 'kiro-home'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['missing-source', 'present-source'] as const)(
    'fault-injects a legacy Keychains target swap at the former removal boundary with %s',
    async (sourceState) => {
      const root = await createTempDir()
      const paths = getPaths(root)
      const realHome = join(root, 'real-home')
      const source = join(realHome, 'Library', 'Keychains')
      const legacyTarget = join(paths.legacySessionHome, 'Library', 'Keychains')
      const validatedTarget = join(paths.legacySessionHome, 'Library', 'validated-Keychains')
      const outside = join(root, `outside-removal-${sourceState}`)
      const sentinel = join(outside, 'sentinel.txt')
      await mkdir(legacyTarget, { recursive: true })
      await mkdir(outside, { recursive: true })
      await writeFile(sentinel, 'unchanged', 'utf8')
      if (sourceState === 'present-source') await mkdir(source, { recursive: true })

      const layout = await prepare(paths)
      await expect(syncSafeKiroKeychains({
        layout,
        platform: 'darwin',
        realHome,
        faultInjection: {
          beforeReadOnlyCredentialBoundary: async () => {
            await rename(legacyTarget, validatedTarget)
            await symlink(outside, legacyTarget, 'dir')
          }
        }
      }))
        .resolves.toBe('process-only')
      expect(await readFile(sentinel, 'utf8')).toBe('unchanged')
      expect((await lstat(validatedTarget)).isDirectory()).toBe(true)
      await expect(lstat(join(layout.sessionHome, 'Library', 'Keychains')))
        .rejects.toMatchObject({ code: 'ENOENT' })
    }
  )

  it('never creates a Keychain link when a legacy Library parent is swapped to an outside directory', async () => {
    const root = await createTempDir()
    const paths = getPaths(root)
    const outside = join(root, 'outside-link-race')
    const sentinel = join(outside, 'sentinel.txt')
    const realHome = join(root, 'real-home')
    const validatedLibrary = join(paths.legacySessionHome, 'validated-Library')
    await mkdir(join(realHome, 'Library', 'Keychains'), { recursive: true })
    await mkdir(join(paths.legacySessionHome, 'Library'), { recursive: true })
    await mkdir(outside, { recursive: true })
    await writeFile(sentinel, 'unchanged', 'utf8')

    const layout = await prepare(paths)
    await expect(syncSafeKiroKeychains({
      layout,
      platform: 'darwin',
      realHome,
      faultInjection: {
        beforeReadOnlyCredentialBoundary: async () => {
          await rename(join(paths.legacySessionHome, 'Library'), validatedLibrary)
          await symlink(outside, join(paths.legacySessionHome, 'Library'), 'dir')
        }
      }
    }))
      .resolves.toBe('process-only')
    expect(await readFile(sentinel, 'utf8')).toBe('unchanged')
    await expect(lstat(join(outside, 'Keychains'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails closed when the fresh private HOME identity changes before credential-boundary use', async () => {
    const root = await createTempDir()
    const paths = getPaths(root)
    const outside = join(root, 'outside-private-home-race')
    const sentinel = join(outside, 'sentinel.txt')
    const layout = await prepare(paths)
    await mkdir(outside, { recursive: true })
    await writeFile(sentinel, 'unchanged', 'utf8')
    await rm(layout.sessionHome, { recursive: true })
    await symlink(outside, layout.sessionHome, 'dir')

    await expect(syncSafeKiroKeychains({ layout, platform: 'darwin', realHome: join(root, 'real-home') }))
      .rejects.toThrow(/private session home must not be a symlink/u)
    expect(await readFile(sentinel, 'utf8')).toBe('unchanged')
  })

  it('rejects lexical session escapes before creating the managed cache root', async () => {
    const root = await createTempDir()
    const paths = getPaths(root)
    const escapedRoot = join(root, 'escaped', 'adapter-kiro')
    await expect(prepareSafeKiroSessionLayout({
      cacheRoot: paths.cacheRoot,
      sessionRoot: escapedRoot,
      kiroHome: join(escapedRoot, 'kiro-home')
    })).rejects.toThrow('escaped the Kiro managed session root')
    await expect(lstat(paths.cacheRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
