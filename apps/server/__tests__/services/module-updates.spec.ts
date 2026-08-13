import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { writeActiveModulePackage } from '#~/module-update-cache.js'
import { checkModuleUpdates, installModuleUpdate, isModuleUpdateTargetId } from '#~/services/module-updates.js'

const mocks = vi.hoisted(() => ({
  loadConfigState: vi.fn()
}))

vi.mock('#~/services/config/index.js', () => ({
  loadConfigState: mocks.loadConfigState
}))

const tempDirs: string[] = []

const createTempDir = async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'oneworks-module-updates-'))
  tempDirs.push(tempDir)
  return tempDir
}

const writePackage = async (packageDir: string, name: string, version: string, withDist = false) => {
  await mkdir(packageDir, { recursive: true })
  await writeFile(path.join(packageDir, 'package.json'), JSON.stringify({ name, version }), 'utf8')
  if (withDist) {
    await mkdir(path.join(packageDir, 'dist'), { recursive: true })
    await writeFile(path.join(packageDir, 'dist/index.html'), '<!doctype html>', 'utf8')
  }
  return packageDir
}

const resolveCachedPackageDir = (
  realHome: string,
  packageName: string,
  cacheVersion: string
) =>
  path.join(
    realHome,
    '.oneworks',
    'bootstrap',
    'npm',
    packageName.replace(/^@/u, '').replace(/[\\/]/gu, '__'),
    cacheVersion,
    'node_modules',
    ...packageName.split('/')
  )

const publishedBeta8 = async () => '0.1.0-beta.8'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.loadConfigState.mockResolvedValue({
    mergedConfig: {
      desktop: { updateChannel: 'beta' }
    },
    workspaceFolder: '/workspace'
  })
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(tempDir => rm(tempDir, { force: true, recursive: true })))
})

describe('module update runtime scoping', () => {
  it('keeps active package metadata inside the exact whitespace-bearing real home', async () => {
    const root = await createTempDir()
    const adjacentHome = path.join(root, 'home')
    const exactHome = path.join(root, 'home ')
    await Promise.all([
      mkdir(adjacentHome, { recursive: true }),
      mkdir(exactHome, { recursive: true })
    ])
    const packageDir = await writePackage(
      path.join(exactHome, 'active-catalog'),
      '@oneworks/model-provider-catalog',
      '0.1.0-beta.11'
    )
    const adjacentMetadata = path.join(
      adjacentHome,
      '.oneworks/bootstrap/module-updates/oneworks__model-provider-catalog.json'
    )
    await mkdir(path.dirname(adjacentMetadata), { recursive: true })
    await writeFile(adjacentMetadata, '{"sentinel":"adjacent"}\n', 'utf8')
    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', exactHome)

    await writeActiveModulePackage({
      packageDir,
      packageName: '@oneworks/model-provider-catalog',
      version: '0.1.0-beta.11'
    })
    const response = await checkModuleUpdates({ publishedVersionResolver: async () => '0.1.0-beta.11' })

    expect(response.modules.find(item => item.id === 'catalog:model-providers')).toMatchObject({
      currentVersion: '0.1.0-beta.11'
    })
    await expect(readFile(adjacentMetadata, 'utf8')).resolves.toBe('{"sentinel":"adjacent"}\n')
  })

  it('recognizes every applicable checked module as an exact install target', async () => {
    const realHome = await createTempDir()
    const serverPackageDir = await writePackage(
      path.join(realHome, 'runtime', 'server'),
      '@oneworks/server',
      '0.1.0-beta.10'
    )
    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', realHome)
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', serverPackageDir)
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_ENTRY_KIND__', 'server')

    const response = await checkModuleUpdates({ publishedVersionResolver: async () => '0.1.0-beta.11' })

    expect(response.modules.length).toBeGreaterThan(0)
    expect(response.modules.every(module => isModuleUpdateTargetId(module.id))).toBe(true)
    expect(isModuleUpdateTargetId('adapter:not-registered')).toBe(false)
    expect(isModuleUpdateTargetId('plugin:not-registered')).toBe(false)
    expect(isModuleUpdateTargetId('catalog:not-registered')).toBe(false)
  })

  it('exposes the model provider catalog as an independently updateable global module', async () => {
    const realHome = await createTempDir()
    const serverPackageDir = await writePackage(
      path.join(realHome, 'runtime', 'server'),
      '@oneworks/server',
      '0.1.0-beta.10'
    )
    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', realHome)
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', serverPackageDir)
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_ENTRY_KIND__', 'server')

    const response = await checkModuleUpdates({ publishedVersionResolver: async () => '0.1.0-beta.11' })

    expect(response.modules).toContainEqual(expect.objectContaining({
      activation: 'restart',
      group: 'catalog',
      id: 'catalog:model-providers',
      kind: 'catalog',
      packageName: '@oneworks/model-provider-catalog'
    }))
  })

  it('reports the active managed catalog version after restart', async () => {
    const realHome = await createTempDir()
    const packageDir = await writePackage(
      path.join(realHome, 'active-catalog'),
      '@oneworks/model-provider-catalog',
      '0.1.0-beta.11'
    )
    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', realHome)
    await writeActiveModulePackage({
      packageDir,
      packageName: '@oneworks/model-provider-catalog',
      version: '0.1.0-beta.11'
    })

    const response = await checkModuleUpdates({ publishedVersionResolver: async () => '0.1.0-beta.11' })
    const catalog = response.modules.find(item => item.id === 'catalog:model-providers')

    expect(catalog).toMatchObject({
      currentVersion: '0.1.0-beta.11',
      needsActivation: false,
      updateAvailable: false
    })
  })

  it('uses the selected desktop runtime package versions and ignores stale caches from other hosts', async () => {
    const realHome = await createTempDir()
    const cacheVersion = 'dev-47f2aed57cf2-20260729190050'
    const serverPackageDir = resolveCachedPackageDir(realHome, '@oneworks/server', cacheVersion)
    await writePackage(serverPackageDir, '@oneworks/server', '0.1.0-beta.9')
    await writePackage(
      resolveCachedPackageDir(realHome, '@oneworks/client', cacheVersion),
      '@oneworks/client',
      '0.1.0-beta.9',
      true
    )
    await writePackage(
      resolveCachedPackageDir(realHome, '@oneworks/client', '0.1.0-alpha.0'),
      '@oneworks/client',
      '0.1.0-alpha.0',
      true
    )
    await writePackage(
      resolveCachedPackageDir(realHome, '@oneworks/web', '0.1.0-beta.7'),
      '@oneworks/web',
      '0.1.0-beta.7'
    )

    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', realHome)
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', serverPackageDir)
    vi.stubEnv('__ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION__', cacheVersion)
    vi.stubEnv('__ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION__', cacheVersion)

    const response = await checkModuleUpdates({ publishedVersionResolver: publishedBeta8 })
    const coreModules = response.modules.filter(item => item.group === 'core')

    expect(coreModules.map(item => item.id)).toEqual(['client', 'server'])
    expect(coreModules).toEqual([
      expect.objectContaining({
        currentVersion: '0.1.0-beta.9',
        id: 'client',
        updateAvailable: false
      }),
      expect.objectContaining({
        currentVersion: '0.1.0-beta.9',
        id: 'server',
        updateAvailable: false
      })
    ])
  })

  it('reports only the integrated Web shell for a Web host', async () => {
    const realHome = await createTempDir()
    const webPackageDir = await writePackage(
      path.join(realHome, 'runtime', 'web'),
      '@oneworks/web',
      '0.1.0-beta.7'
    )
    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', realHome)
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', webPackageDir)
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_ENTRY_KIND__', 'web')

    const response = await checkModuleUpdates({ publishedVersionResolver: publishedBeta8 })
    const coreModules = response.modules.filter(item => item.group === 'core')

    expect(coreModules).toEqual([
      expect.objectContaining({
        currentVersion: '0.1.0-beta.7',
        id: 'web',
        latestVersion: '0.1.0-beta.8',
        updateAvailable: true
      })
    ])
  })

  it('reports only the server Core package for a standalone server host', async () => {
    const realHome = await createTempDir()
    const serverPackageDir = await writePackage(
      path.join(realHome, 'runtime', 'server'),
      '@oneworks/server',
      '0.1.0-beta.7'
    )
    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', realHome)
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', serverPackageDir)
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_ENTRY_KIND__', 'server')

    const response = await checkModuleUpdates({ publishedVersionResolver: publishedBeta8 })
    const coreModules = response.modules.filter(item => item.group === 'core')

    expect(coreModules).toEqual([
      expect.objectContaining({
        currentVersion: '0.1.0-beta.7',
        id: 'server',
        latestVersion: '0.1.0-beta.8',
        updateAvailable: true
      })
    ])
  })

  it('reads package metadata only from the exact whitespace-bearing runtime package directory', async () => {
    const root = await createTempDir()
    const exactPackageDir = await writePackage(
      path.join(root, 'runtime '),
      '@oneworks/server',
      '0.1.0-beta.10'
    )
    await writePackage(path.join(root, 'runtime'), '@oneworks/server', '0.1.0-beta.1')
    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', root)
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', exactPackageDir)
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_ENTRY_KIND__', 'server')

    const response = await checkModuleUpdates({ publishedVersionResolver: async () => '0.1.0-beta.11' })

    expect(response.modules.find(module => module.id === 'server')).toMatchObject({
      currentVersion: '0.1.0-beta.10',
      updateAvailable: true
    })
  })

  it('rejects an older desktop package and a core target owned by another host', async () => {
    const realHome = await createTempDir()
    const cacheVersion = 'dev-current'
    const serverPackageDir = resolveCachedPackageDir(realHome, '@oneworks/server', cacheVersion)
    await writePackage(serverPackageDir, '@oneworks/server', '0.1.0-beta.9')
    await writePackage(
      resolveCachedPackageDir(realHome, '@oneworks/client', cacheVersion),
      '@oneworks/client',
      '0.1.0-beta.9',
      true
    )

    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', realHome)
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', serverPackageDir)
    vi.stubEnv('__ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION__', cacheVersion)
    vi.stubEnv('__ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION__', cacheVersion)

    await expect(installModuleUpdate('client', { version: '0.1.0-beta.8' }))
      .rejects.toThrow('Refusing to downgrade @oneworks/client from 0.1.0-beta.9 to 0.1.0-beta.8.')
    await expect(installModuleUpdate('client', { version: 'latest' }))
      .rejects.toThrow('Invalid exact module version: latest')
    await expect(installModuleUpdate('web', { version: '0.1.0-beta.8' }))
      .rejects.toThrow('Module update target is not available for this runtime: web')
  })
})
