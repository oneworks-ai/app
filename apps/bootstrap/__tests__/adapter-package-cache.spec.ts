import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  resolveBootstrapPackageCacheRootDir,
  resolveExistingAdapterPackageCacheDir,
  resolvePackageCacheHomeDir
} from '../../../packages/types/src/adapter-package-cache'

import {
  readCliAdapterPackageRequest,
  resolveAdapterPackageName,
  resolveCliAdapterPackageDir
} from '../src/adapter-package-cache'

const tempDirs: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

const writeCachedAdapterPackage = async (homeDir: string, packageName: string, version: string) => {
  const cacheDir = path.join(
    homeDir,
    '.oneworks/bootstrap/adapter-packages',
    packageName.replace(/^@/, '').replace(/[\\/]/g, '__'),
    version
  )
  const packageDir = path.join(cacheDir, 'node_modules', ...packageName.split('/'))
  await mkdir(packageDir, { recursive: true })
  await writeFile(
    path.join(packageDir, 'package.json'),
    JSON.stringify({ name: packageName, version }, null, 2)
  )
  return cacheDir
}

describe('bootstrap adapter package cache', () => {
  it('normalizes built-in adapter ids to adapter package names', () => {
    expect(resolveAdapterPackageName('codex')).toBe('@oneworks/adapter-codex')
    expect(resolveAdapterPackageName('adapter-codex')).toBe('@oneworks/adapter-codex')
    expect(resolveAdapterPackageName('claude')).toBe('@oneworks/adapter-claude-code')
    expect(resolveAdapterPackageName('@acme/custom-adapter')).toBe('@acme/custom-adapter')
  })

  it('reads adapter requests from forwarded CLI arguments', () => {
    expect(readCliAdapterPackageRequest(['--adapter', 'codex'], '0.1.0-alpha.0')).toEqual({
      adapter: 'codex',
      cliVersion: '0.1.0-alpha.0'
    })
    expect(readCliAdapterPackageRequest(['-Aadapter-codex@0.132.0'], '0.1.0-alpha.0')).toEqual({
      adapter: 'adapter-codex@0.132.0',
      cliVersion: '0.1.0-alpha.0'
    })
    expect(readCliAdapterPackageRequest(['--resume', 'sess-id'], '0.1.0-alpha.0', 'codex')).toEqual({
      adapter: 'codex',
      cliVersion: '0.1.0-alpha.0'
    })
  })

  it('resolves an existing user-home adapter package cache before installing', async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), 'ow-bootstrap-adapter-cache-'))
    tempDirs.push(homeDir)
    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', homeDir)

    const cacheDir = await writeCachedAdapterPackage(homeDir, '@oneworks/adapter-codex', '3.3.1')

    await expect(
      resolveCliAdapterPackageDir({
        adapter: 'codex',
        cliVersion: '3.2.4-alpha.5'
      })
    ).resolves.toBe(cacheDir)
  })

  it('selects the cache under the exact whitespace-bearing real home', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-bootstrap-adapter-cache-home-'))
    const adjacentHome = path.join(root, 'home')
    const exactHome = path.join(root, 'home ')
    tempDirs.push(root)
    await Promise.all([
      writeCachedAdapterPackage(adjacentHome, '@oneworks/adapter-codex', '3.4.9'),
      writeCachedAdapterPackage(exactHome, '@oneworks/adapter-codex', '3.4.1')
    ])
    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', exactHome)

    await expect(resolveCliAdapterPackageDir({
      adapter: 'codex',
      cliVersion: '3.4.0'
    })).resolves.toContain(`${path.sep}home ${path.sep}`)
    expect(resolvePackageCacheHomeDir({ __ONEWORKS_PROJECT_REAL_HOME__: exactHome })).toBe(exactHome)
    expect(resolveBootstrapPackageCacheRootDir({
      __ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__: `${root}${path.sep}cache `
    })).toBe(`${root}${path.sep}cache `)
  })

  it('selects the exact whitespace-bearing desktop built-in cache directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-bootstrap-adapter-desktop-cache-'))
    const adjacentCache = path.join(root, 'builtin')
    const exactCache = path.join(root, 'builtin ')
    const packageName = '@oneworks/adapter-codex'
    tempDirs.push(root)

    for (const cacheDir of [adjacentCache, exactCache]) {
      const packageDir = path.join(cacheDir, 'node_modules', ...packageName.split('/'))
      await mkdir(packageDir, { recursive: true })
      await writeFile(
        path.join(packageDir, 'package.json'),
        JSON.stringify({ name: packageName, version: '3.4.0' }),
        'utf8'
      )
    }

    expect(resolveExistingAdapterPackageCacheDir(packageName, {
      __ONEWORKS_DESKTOP_BUILTIN_ADAPTER_PACKAGES__: JSON.stringify({
        [packageName]: { cacheDir: exactCache, version: '3.4.0' }
      }),
      __ONEWORKS_PROJECT_REAL_HOME__: root
    })).toBe(exactCache)
  })

  it('uses the highest cached adapter package that satisfies the CLI semver floor', async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), 'ow-bootstrap-adapter-cache-'))
    tempDirs.push(homeDir)
    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', homeDir)

    await writeCachedAdapterPackage(homeDir, '@oneworks/adapter-codex', '3.3.9')
    const compatibleCacheDir = await writeCachedAdapterPackage(homeDir, '@oneworks/adapter-codex', '3.4.1')
    await writeCachedAdapterPackage(homeDir, '@oneworks/adapter-codex', '3.5.0-beta')
    await writeCachedAdapterPackage(homeDir, '@oneworks/adapter-codex', '4.0.0')

    await expect(
      resolveCliAdapterPackageDir({
        adapter: 'codex',
        cliVersion: '3.4.0-rc'
      })
    ).resolves.toBe(compatibleCacheDir)
  })

  it('preserves prerelease CLI versions when matching adapter package caches', async () => {
    const homeDir = await mkdtemp(path.join(tmpdir(), 'ow-bootstrap-adapter-cache-'))
    tempDirs.push(homeDir)
    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', homeDir)

    await writeCachedAdapterPackage(homeDir, '@oneworks/adapter-codex', '3.3.9')
    const prereleaseCacheDir = await writeCachedAdapterPackage(homeDir, '@oneworks/adapter-codex', '3.4.0-rc')
    await writeCachedAdapterPackage(homeDir, '@oneworks/adapter-codex', '3.5.0-beta')
    await writeCachedAdapterPackage(homeDir, '@oneworks/adapter-codex', '4.0.0')

    await expect(
      resolveCliAdapterPackageDir({
        adapter: 'codex',
        cliVersion: '3.4.0-rc'
      })
    ).resolves.toBe(prereleaseCacheDir)
  })
})
