/* eslint-disable max-lines -- desktop package cache tests cover adapter, runtime, and alias closure behavior together. */
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const {
  BUILTIN_PACKAGE_CACHE_PREPARED_ENV,
  BUILTIN_ADAPTER_PACKAGE_ENV,
  DESKTOP_DEV_RUNTIME_VERSION_ENV,
  MANIFEST_FILE,
  NPM_PACKAGE_MANIFEST_FILE,
  PUBLIC_DESKTOP_DEV_RUNTIME_VERSION_ENV,
  PUBLIC_RUNTIME_PACKAGE_CACHE_VERSION_ENV,
  RUNTIME_PACKAGE_BUILD_FINGERPRINT_ENV,
  TRUST_DEV_RUNTIME_CACHE_MANIFEST_ENV,
  ensureBuiltinAdapterPackageCache,
  ensureBuiltinPluginPackageCache,
  ensureBuiltinRuntimePackageCache,
  hashPackageClosure,
  materializeBuiltinPluginPackage,
  materializeBuiltinAdapterPackage,
  materializeBuiltinStaticNpmPackage,
  resolveAdapterPackageCacheDir,
  resolveAdapterPackageInstallDir,
  resolveNpmPackageCacheDir,
  resolveNpmPackageInstallDir,
  resolvePackageCacheRootDir,
  resolveRealHomeDir,
  runBuiltinPackageCachePreparationOnce,
  sanitizePackageName
} = require('../src/builtin-adapter-cache.cjs') as typeof import('../src/builtin-adapter-cache.cjs')

const tempDirs: string[] = []

afterEach(async () => {
  delete process.env[BUILTIN_ADAPTER_PACKAGE_ENV]
  delete process.env[DESKTOP_DEV_RUNTIME_VERSION_ENV]
  delete process.env[PUBLIC_DESKTOP_DEV_RUNTIME_VERSION_ENV]
  delete process.env[PUBLIC_RUNTIME_PACKAGE_CACHE_VERSION_ENV]
  delete process.env[RUNTIME_PACKAGE_BUILD_FINGERPRINT_ENV]
  delete process.env[TRUST_DEV_RUNTIME_CACHE_MANIFEST_ENV]
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

const createTempDir = async (prefix: string) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), prefix))
  tempDirs.push(tempDir)
  return tempDir
}

const writeSourceAdapterPackage = async (rootDir: string, packageName: string, version: string, model: string) => {
  const packageDir = path.join(rootDir, sanitizePackageName(packageName))
  const dependencyDir = path.join(packageDir, 'node_modules', '@acme/runtime')
  await mkdir(path.join(packageDir, 'src'), { recursive: true })
  await mkdir(path.join(packageDir, 'dist'), { recursive: true })
  await mkdir(path.join(packageDir, 'node_modules'), { recursive: true })
  await mkdir(dependencyDir, { recursive: true })
  await writeFile(
    path.join(packageDir, 'package.json'),
    JSON.stringify(
      {
        name: packageName,
        version,
        exports: {
          '.': './dist/index.js',
          './models': {
            '__oneworks__': './src/models.ts',
            default: './dist/models.js'
          }
        },
        dependencies: {
          '@acme/runtime': '1.0.0'
        }
      },
      null,
      2
    )
  )
  await writeFile(path.join(packageDir, 'dist', 'index.js'), "module.exports = require('@acme/runtime')\n")
  await writeFile(path.join(packageDir, 'src', 'models.ts'), `export const builtinModels = ['${model}']\n`)
  await writeFile(
    path.join(dependencyDir, 'package.json'),
    JSON.stringify(
      {
        name: '@acme/runtime',
        version: '1.0.0',
        main: './index.js',
        exports: {
          '.': './index.js'
        }
      },
      null,
      2
    )
  )
  await writeFile(path.join(dependencyDir, 'index.js'), 'module.exports = { runtime: true }\n')
  await writeFile(path.join(packageDir, 'node_modules', 'ignored.txt'), 'do not copy')
  return packageDir
}

const writeSourcePluginPackage = async (rootDir: string, packageName: string, version: string) => {
  const installRoot = path.join(rootDir, 'node_modules')
  const packageDir = path.join(installRoot, ...packageName.split('/'))
  const dependencyDir = path.join(installRoot, '@acme/runtime')
  await mkdir(path.join(packageDir, 'dist'), { recursive: true })
  await mkdir(dependencyDir, { recursive: true })
  await writeFile(
    path.join(packageDir, 'package.json'),
    JSON.stringify(
      {
        name: packageName,
        version,
        exports: {
          './hooks': './dist/hooks.js',
          './package.json': './package.json'
        },
        dependencies: {
          '@acme/runtime': '1.0.0'
        }
      },
      null,
      2
    )
  )
  await writeFile(path.join(packageDir, 'dist', 'hooks.js'), "module.exports = require('@acme/runtime')\n")
  await writeFile(
    path.join(dependencyDir, 'package.json'),
    JSON.stringify(
      {
        name: '@acme/runtime',
        version: '1.0.0',
        main: './index.js',
        exports: {
          '.': './index.js'
        }
      },
      null,
      2
    )
  )
  await writeFile(path.join(dependencyDir, 'index.js'), 'module.exports = { ok: true }\n')
  return packageDir
}

const writeSourceStaticPackage = async (
  rootDir: string,
  packageName: string,
  version: string,
  body = '<!doctype html>'
) => {
  const packageDir = path.join(rootDir, sanitizePackageName(packageName))
  await mkdir(path.join(packageDir, 'dist'), { recursive: true })
  await writeFile(
    path.join(packageDir, 'package.json'),
    JSON.stringify(
      {
        name: packageName,
        type: 'module',
        version
      },
      null,
      2
    )
  )
  await writeFile(path.join(packageDir, 'dist', 'index.html'), body)
  return packageDir
}

const writePackageJson = async (packageDir: string, value: Record<string, unknown>) => {
  await writeFile(path.join(packageDir, 'package.json'), JSON.stringify(value, null, 2))
}

const writeSourceAdapterPackageWithDuplicateDependencyVersions = async (rootDir: string) => {
  const packageName = '@acme/adapter-conflict'
  const packageDir = path.join(rootDir, sanitizePackageName(packageName))
  const nodeModulesDir = path.join(packageDir, 'node_modules')
  const collectorDir = path.join(nodeModulesDir, '@acme/collector')
  const legacyDir = path.join(nodeModulesDir, '@acme/legacy')
  const minipassCollectDir = path.join(nodeModulesDir, 'minipass-collect')
  const minipassLegacyDir = path.join(nodeModulesDir, 'minipass')
  const minipassModernDir = path.join(minipassCollectDir, 'node_modules', 'minipass')

  await mkdir(path.join(packageDir, 'dist'), { recursive: true })
  await mkdir(collectorDir, { recursive: true })
  await mkdir(legacyDir, { recursive: true })
  await mkdir(minipassCollectDir, { recursive: true })
  await mkdir(minipassLegacyDir, { recursive: true })
  await mkdir(minipassModernDir, { recursive: true })

  await writePackageJson(packageDir, {
    name: packageName,
    version: '1.0.0',
    exports: './dist/index.js',
    dependencies: {
      '@acme/collector': '1.0.0',
      '@acme/legacy': '1.0.0'
    }
  })
  await writeFile(
    path.join(packageDir, 'dist', 'index.js'),
    "module.exports = { collector: require('@acme/collector'), legacy: require('@acme/legacy') }\n"
  )

  await writePackageJson(collectorDir, {
    name: '@acme/collector',
    version: '1.0.0',
    main: './index.js',
    dependencies: {
      'minipass-collect': '2.0.1'
    }
  })
  await writeFile(path.join(collectorDir, 'index.js'), "module.exports = require('minipass-collect')\n")

  await writePackageJson(legacyDir, {
    name: '@acme/legacy',
    version: '1.0.0',
    main: './index.js',
    dependencies: {
      minipass: '3.3.6'
    }
  })
  await writeFile(path.join(legacyDir, 'index.js'), "module.exports = require('minipass/package.json').version\n")

  await writePackageJson(minipassCollectDir, {
    name: 'minipass-collect',
    version: '2.0.1',
    main: './index.js',
    dependencies: {
      minipass: '^7.0.3'
    }
  })
  await writeFile(
    path.join(minipassCollectDir, 'index.js'),
    "module.exports = require('minipass/package.json').version\n"
  )

  await writePackageJson(minipassLegacyDir, {
    name: 'minipass',
    version: '3.3.6',
    main: './index.js'
  })
  await writeFile(path.join(minipassLegacyDir, 'index.js'), 'module.exports = {}\n')

  await writePackageJson(minipassModernDir, {
    name: 'minipass',
    version: '7.1.2',
    main: './index.js'
  })
  await writeFile(path.join(minipassModernDir, 'index.js'), 'module.exports = {}\n')

  return {
    packageDir,
    packageName
  }
}

const writeSourceAdapterPackageWithPeerDependency = async (rootDir: string) => {
  const packageName = '@acme/adapter-peer'
  const packageDir = path.join(rootDir, sanitizePackageName(packageName))
  const consumerDir = path.join(packageDir, 'node_modules', '@acme/consumer')
  const peerDir = path.join(packageDir, 'node_modules', '@acme/peer')

  await mkdir(path.join(packageDir, 'dist'), { recursive: true })
  await mkdir(consumerDir, { recursive: true })
  await mkdir(peerDir, { recursive: true })

  await writePackageJson(packageDir, {
    name: packageName,
    version: '1.0.0',
    main: './dist/index.js',
    dependencies: {
      '@acme/consumer': '1.0.0',
      '@acme/peer': '1.0.0'
    }
  })
  await writeFile(path.join(packageDir, 'dist', 'index.js'), "module.exports = require('@acme/consumer')\n")

  await writePackageJson(consumerDir, {
    name: '@acme/consumer',
    version: '1.0.0',
    main: './index.js',
    peerDependencies: {
      '@acme/peer': '1.0.0'
    }
  })
  await writeFile(path.join(consumerDir, 'index.js'), "module.exports = require('@acme/peer')\n")

  await writePackageJson(peerDir, {
    name: '@acme/peer',
    version: '1.0.0',
    main: './index.js'
  })
  await writeFile(path.join(peerDir, 'index.js'), 'module.exports = { peer: true }\n')

  return {
    packageDir,
    packageName
  }
}

const writeSourcePluginPackageWithConflictingDeps = async (rootDir: string, packageName: string, version: string) => {
  const installRoot = path.join(rootDir, 'node_modules')
  const packageDir = path.join(installRoot, ...packageName.split('/'))
  const leftDir = path.join(installRoot, '@acme/left')
  const rightDir = path.join(installRoot, '@acme/right')
  const leftSharedDir = path.join(leftDir, 'node_modules', '@acme/shared')
  const rightSharedDir = path.join(rightDir, 'node_modules', '@acme/shared')
  await mkdir(path.join(packageDir, 'dist'), { recursive: true })
  await mkdir(leftSharedDir, { recursive: true })
  await mkdir(rightSharedDir, { recursive: true })
  await writeFile(
    path.join(packageDir, 'package.json'),
    JSON.stringify(
      {
        name: packageName,
        version,
        exports: {
          './hooks': './dist/hooks.js',
          './package.json': './package.json'
        },
        dependencies: {
          '@acme/left': '1.0.0',
          '@acme/right': '1.0.0'
        }
      },
      null,
      2
    )
  )
  await writeFile(
    path.join(packageDir, 'dist', 'hooks.js'),
    "module.exports = { left: require('@acme/left'), right: require('@acme/right') }\n"
  )
  await writeFile(
    path.join(leftDir, 'package.json'),
    JSON.stringify(
      {
        name: '@acme/left',
        version: '1.0.0',
        main: './index.js',
        dependencies: {
          '@acme/shared': '1.0.0'
        }
      },
      null,
      2
    )
  )
  await writeFile(path.join(leftDir, 'index.js'), "module.exports = require('@acme/shared').value\n")
  await writeFile(
    path.join(rightDir, 'package.json'),
    JSON.stringify(
      {
        name: '@acme/right',
        version: '1.0.0',
        main: './index.js',
        dependencies: {
          '@acme/shared': '2.0.0'
        }
      },
      null,
      2
    )
  )
  await writeFile(path.join(rightDir, 'index.js'), "module.exports = require('@acme/shared').value\n")
  await writeFile(
    path.join(leftSharedDir, 'package.json'),
    JSON.stringify({ name: '@acme/shared', version: '1.0.0', main: './index.js' }, null, 2)
  )
  await writeFile(path.join(leftSharedDir, 'index.js'), "module.exports = { value: 'left-v1' }\n")
  await writeFile(
    path.join(rightSharedDir, 'package.json'),
    JSON.stringify({ name: '@acme/shared', version: '2.0.0', main: './index.js' }, null, 2)
  )
  await writeFile(path.join(rightSharedDir, 'index.js'), "module.exports = { value: 'right-v2' }\n")
  return packageDir
}

const writeSourcePluginPackageWithAliasedDependency = async (
  rootDir: string,
  packageName: string,
  version: string
) => {
  const installRoot = path.join(rootDir, 'node_modules')
  const packageDir = path.join(installRoot, ...packageName.split('/'))
  const aliasedDependencyDir = path.join(installRoot, '@nolyfill/function-bind')
  const aliasLink = path.join(packageDir, 'node_modules', 'function-bind')
  await mkdir(path.join(packageDir, 'dist'), { recursive: true })
  await mkdir(path.dirname(aliasLink), { recursive: true })
  await mkdir(aliasedDependencyDir, { recursive: true })
  await writeFile(
    path.join(packageDir, 'package.json'),
    JSON.stringify(
      {
        name: packageName,
        version,
        exports: {
          './hooks': './dist/hooks.js',
          './package.json': './package.json'
        },
        dependencies: {
          'function-bind': 'npm:@nolyfill/function-bind@1.0.21'
        }
      },
      null,
      2
    )
  )
  await writeFile(path.join(packageDir, 'dist', 'hooks.js'), "module.exports = require('function-bind')\n")
  await writeFile(
    path.join(aliasedDependencyDir, 'package.json'),
    JSON.stringify({ name: '@nolyfill/function-bind', version: '1.0.21', main: './index.js' }, null, 2)
  )
  await writeFile(path.join(aliasedDependencyDir, 'index.js'), 'module.exports = { alias: true }\n')
  await symlink(path.relative(path.dirname(aliasLink), aliasedDependencyDir), aliasLink)
  return packageDir
}

describe('desktop built-in adapter package cache', () => {
  it('materializes a built-in adapter package into the user-home version cache', async () => {
    const tempDir = await createTempDir('oneworks-desktop-adapter-cache-')
    const homeDir = path.join(tempDir, 'home')
    const packageName = '@acme/adapter-cached'
    const sourcePackageDir = await writeSourceAdapterPackage(tempDir, packageName, '1.2.3', 'first')

    const result = materializeBuiltinAdapterPackage({
      homeDir,
      packageName,
      sourcePackageDir
    })

    const cacheDir = resolveAdapterPackageCacheDir(packageName, '1.2.3', homeDir)
    const packageDir = resolveAdapterPackageInstallDir(cacheDir, packageName)
    expect(result).toMatchObject({
      cacheDir,
      packageDir,
      seeded: true
    })
    await expect(readFile(path.join(packageDir, 'src', 'models.ts'), 'utf8')).resolves.toContain('first')
    await expect(
      readFile(path.join(packageDir, 'node_modules', '@acme/runtime/index.js'), 'utf8')
    ).resolves.toContain('runtime: true')
    await expect(readFile(path.join(packageDir, 'node_modules', 'ignored.txt'), 'utf8')).rejects
      .toMatchObject({ code: 'ENOENT' })
    expect(createRequire(path.join(cacheDir, '__loader__.cjs'))(packageName)).toEqual({ runtime: true })

    const manifest = JSON.parse(await readFile(path.join(cacheDir, MANIFEST_FILE), 'utf8')) as {
      integrity?: string
      name?: string
      source?: string
      version?: string
    }
    expect(manifest).toMatchObject({
      integrity: hashPackageClosure(packageName, sourcePackageDir),
      name: packageName,
      source: 'builtin',
      version: '1.2.3'
    })
  })

  it('refreshes an existing cache entry when the bundled package body changes', async () => {
    const tempDir = await createTempDir('oneworks-desktop-adapter-refresh-')
    const homeDir = path.join(tempDir, 'home')
    const packageName = '@acme/adapter-refresh'
    const sourcePackageDir = await writeSourceAdapterPackage(tempDir, packageName, '1.2.3', 'first')

    materializeBuiltinAdapterPackage({
      homeDir,
      packageName,
      sourcePackageDir
    })
    await writeFile(path.join(sourcePackageDir, 'src', 'models.ts'), 'export const builtinModels = ["second"]\n')

    const refreshed = materializeBuiltinAdapterPackage({
      homeDir,
      packageName,
      sourcePackageDir
    })

    const cacheDir = resolveAdapterPackageCacheDir(packageName, '1.2.3', homeDir)
    const packageDir = resolveAdapterPackageInstallDir(cacheDir, packageName)
    expect(refreshed.seeded).toBe(true)
    await expect(readFile(path.join(packageDir, 'src', 'models.ts'), 'utf8')).resolves.toContain('second')
  })

  it('materializes a built-in adapter under an explicit dev cache version', async () => {
    const tempDir = await createTempDir('oneworks-desktop-adapter-dev-cache-')
    const homeDir = path.join(tempDir, 'home')
    const packageName = '@acme/adapter-dev-cache'
    const sourcePackageDir = await writeSourceAdapterPackage(tempDir, packageName, '1.2.3', 'dev')

    const result = materializeBuiltinAdapterPackage({
      cacheVersion: 'dev-local',
      homeDir,
      packageName,
      sourcePackageDir
    })

    const cacheDir = resolveAdapterPackageCacheDir(packageName, 'dev-local', homeDir)
    const packageDir = resolveAdapterPackageInstallDir(cacheDir, packageName)
    expect(result).toMatchObject({
      cacheDir,
      cacheVersion: 'dev-local',
      packageDir,
      seeded: true,
      version: '1.2.3'
    })
    await expect(readFile(path.join(packageDir, 'package.json'), 'utf8')).resolves.toContain('"version": "1.2.3"')

    const manifest = JSON.parse(await readFile(path.join(cacheDir, MANIFEST_FILE), 'utf8')) as {
      cacheVersion?: string
      version?: string
    }
    expect(manifest).toMatchObject({
      cacheVersion: 'dev-local',
      version: '1.2.3'
    })
  })

  it('preserves nested dependency versions when copying an adapter package closure', async () => {
    const tempDir = await createTempDir('oneworks-desktop-adapter-conflict-')
    const homeDir = path.join(tempDir, 'home')
    const { packageDir: sourcePackageDir, packageName } =
      await writeSourceAdapterPackageWithDuplicateDependencyVersions(tempDir)

    const result = materializeBuiltinAdapterPackage({
      homeDir,
      packageName,
      sourcePackageDir
    })

    const packageDir = resolveAdapterPackageInstallDir(result.cacheDir, packageName)
    expect(require(path.join(packageDir, 'dist', 'index.js'))).toEqual({
      collector: '7.1.2',
      legacy: '3.3.6'
    })
    await expect(
      readFile(
        path.join(
          packageDir,
          'node_modules',
          '@acme/collector',
          'node_modules',
          'minipass-collect',
          'node_modules',
          'minipass',
          'package.json'
        ),
        'utf8'
      )
    ).resolves.toContain('"version": "7.1.2"')
  })

  it('links peer dependencies inside copied package closures', async () => {
    const tempDir = await createTempDir('oneworks-desktop-adapter-peer-')
    const homeDir = path.join(tempDir, 'home')
    const { packageDir: sourcePackageDir, packageName } = await writeSourceAdapterPackageWithPeerDependency(tempDir)

    const result = materializeBuiltinAdapterPackage({
      homeDir,
      packageName,
      sourcePackageDir
    })

    const packageDir = resolveAdapterPackageInstallDir(result.cacheDir, packageName)
    expect(require(path.join(packageDir, 'dist', 'index.js'))).toEqual({ peer: true })
    await expect(
      readFile(
        path.join(
          packageDir,
          'node_modules',
          '@acme/consumer',
          'node_modules',
          '@acme/peer',
          'package.json'
        ),
        'utf8'
      )
    ).resolves.toContain('"version": "1.0.0"')
  })

  it('can seed multiple packages through the startup helper', async () => {
    const tempDir = await createTempDir('oneworks-desktop-adapter-ensure-')
    const homeDir = path.join(tempDir, 'home')
    const firstPackage = '@acme/adapter-first'
    const secondPackage = '@acme/adapter-second'
    const firstSource = await writeSourceAdapterPackage(tempDir, firstPackage, '1.0.0', 'first')
    const secondSource = await writeSourceAdapterPackage(tempDir, secondPackage, '2.0.0', 'second')

    const seeded = ensureBuiltinAdapterPackageCache({
      homeDir,
      packages: [firstPackage, secondPackage],
      resolvePackageDir: packageName => packageName === firstPackage ? firstSource : secondSource
    })
    const adapterPackageMetadata = JSON.parse(process.env[BUILTIN_ADAPTER_PACKAGE_ENV] ?? '{}') as Record<
      string,
      { cacheDir?: string; packageDir?: string; version?: string }
    >

    expect(seeded.map(item => item.seeded)).toEqual([true, true])
    expect(adapterPackageMetadata[firstPackage]).toMatchObject({
      cacheDir: resolveAdapterPackageCacheDir(firstPackage, '1.0.0', homeDir),
      packageDir: resolveAdapterPackageInstallDir(
        resolveAdapterPackageCacheDir(firstPackage, '1.0.0', homeDir),
        firstPackage
      ),
      version: '1.0.0'
    })
    await expect(
      readFile(
        path.join(resolveAdapterPackageInstallDir(seeded[0].cacheDir, firstPackage), 'src', 'models.ts'),
        'utf8'
      )
    ).resolves.toContain('first')
    await symlink(
      resolveAdapterPackageCacheDir(secondPackage, '2.0.0', homeDir),
      path.join(tempDir, 'cache-link')
    )
    await expect(readFile(path.join(tempDir, 'cache-link', MANIFEST_FILE), 'utf8')).resolves.toContain(secondPackage)
  })

  it('copies a trusted packaged adapter graph once and links every adapter cache to it', async () => {
    const tempDir = await createTempDir('oneworks-desktop-adapter-shared-bundle-')
    const homeDir = path.join(tempDir, 'home')
    const firstPackage = '@acme/adapter-bundle-first'
    const secondPackage = '@acme/adapter-bundle-second'
    const firstSource = await writeSourceAdapterPackage(tempDir, firstPackage, '1.0.0', 'first')
    const secondSource = await writeSourceAdapterPackage(tempDir, secondPackage, '2.0.0', 'second')
    const sharedDependencyDir = path.join(firstSource, 'node_modules', '@acme/runtime')
    const secondDependencyDir = path.join(secondSource, 'node_modules', '@acme/runtime')
    await rm(secondDependencyDir, { recursive: true, force: true })
    await symlink(sharedDependencyDir, secondDependencyDir, process.platform === 'win32' ? 'junction' : 'dir')
    const options = {
      env: {
        [PUBLIC_RUNTIME_PACKAGE_CACHE_VERSION_ENV]: 'packaged-build',
        [RUNTIME_PACKAGE_BUILD_FINGERPRINT_ENV]: 'fingerprint-a',
        [TRUST_DEV_RUNTIME_CACHE_MANIFEST_ENV]: '1'
      },
      homeDir,
      packages: [firstPackage, secondPackage],
      resolvePackageDir: (packageName: string) => packageName === firstPackage ? firstSource : secondSource,
      trustManifest: true
    }

    const seeded = ensureBuiltinAdapterPackageCache(options)
    const firstNodeModulesDir = path.join(seeded[0].cacheDir, 'node_modules')
    const secondNodeModulesDir = path.join(seeded[1].cacheDir, 'node_modules')

    expect(seeded.map(item => item.seeded)).toEqual([true, true])
    expect((await lstat(firstNodeModulesDir)).isSymbolicLink()).toBe(true)
    expect((await lstat(secondNodeModulesDir)).isSymbolicLink()).toBe(true)
    expect(await realpath(firstNodeModulesDir)).toBe(await realpath(secondNodeModulesDir))
    expect(await realpath(firstNodeModulesDir)).toContain(path.join(homeDir, '.oneworks', 'bootstrap'))
    await expect(readFile(path.join(seeded[0].packageDir, 'src', 'models.ts'), 'utf8')).resolves.toContain('first')
    await expect(readFile(path.join(seeded[1].packageDir, 'src', 'models.ts'), 'utf8')).resolves.toContain('second')
    expect(require(path.join(seeded[0].packageDir, 'dist', 'index.js'))).toEqual({ runtime: true })
    expect(require(path.join(seeded[1].packageDir, 'dist', 'index.js'))).toEqual({ runtime: true })

    expect(ensureBuiltinAdapterPackageCache(options).map(item => item.seeded)).toEqual([false, false])
  })

  it('uses the configured desktop dev runtime version in startup adapter metadata', async () => {
    const tempDir = await createTempDir('oneworks-desktop-adapter-dev-ensure-')
    const homeDir = path.join(tempDir, 'home')
    const packageName = '@acme/adapter-dev-ensure'
    const sourcePackageDir = await writeSourceAdapterPackage(tempDir, packageName, '1.2.3', 'dev')

    const [seeded] = ensureBuiltinAdapterPackageCache({
      env: {
        [PUBLIC_RUNTIME_PACKAGE_CACHE_VERSION_ENV]: 'dev-worktree'
      },
      homeDir,
      packages: [packageName],
      resolvePackageDir: () => sourcePackageDir
    })
    const adapterPackageMetadata = JSON.parse(process.env[BUILTIN_ADAPTER_PACKAGE_ENV] ?? '{}') as Record<
      string,
      { cacheDir?: string; cacheVersion?: string; packageDir?: string; version?: string }
    >

    expect(seeded.cacheDir).toBe(resolveAdapterPackageCacheDir(packageName, 'dev-worktree', homeDir))
    expect(adapterPackageMetadata[packageName]).toMatchObject({
      cacheDir: resolveAdapterPackageCacheDir(packageName, 'dev-worktree', homeDir),
      cacheVersion: 'dev-worktree',
      version: '1.2.3'
    })
  })

  it('refreshes a source-dev adapter even when startup requests manifest trust', async () => {
    const tempDir = await createTempDir('oneworks-desktop-adapter-source-dev-refresh-')
    const homeDir = path.join(tempDir, 'home')
    const packageName = '@acme/adapter-source-dev-refresh'
    const sourcePackageDir = await writeSourceAdapterPackage(tempDir, packageName, '1.2.3', 'first')
    const options = {
      env: {
        [PUBLIC_RUNTIME_PACKAGE_CACHE_VERSION_ENV]: 'dev-worktree'
      },
      homeDir,
      packages: [packageName],
      resolvePackageDir: () => sourcePackageDir,
      trustManifest: true
    }

    ensureBuiltinAdapterPackageCache(options)
    await writeFile(path.join(sourcePackageDir, 'src', 'models.ts'), 'export const builtinModels = ["second"]\n')
    const [refreshed] = ensureBuiltinAdapterPackageCache(options)

    expect(refreshed.seeded).toBe(true)
    await expect(readFile(path.join(refreshed.packageDir, 'src', 'models.ts'), 'utf8')).resolves.toContain('second')
  })

  it('trusts a packaged adapter manifest only for the same build fingerprint', async () => {
    const tempDir = await createTempDir('oneworks-desktop-adapter-packaged-manifest-')
    const homeDir = path.join(tempDir, 'home')
    const packageName = '@acme/adapter-packaged-manifest'
    const sourcePackageDir = await writeSourceAdapterPackage(tempDir, packageName, '1.2.3', 'first')
    const createOptions = (runtimePackageBuildFingerprint: string) => ({
      env: {
        [PUBLIC_RUNTIME_PACKAGE_CACHE_VERSION_ENV]: 'local-cache',
        [RUNTIME_PACKAGE_BUILD_FINGERPRINT_ENV]: runtimePackageBuildFingerprint,
        [TRUST_DEV_RUNTIME_CACHE_MANIFEST_ENV]: '1'
      },
      homeDir,
      packages: [packageName],
      resolvePackageDir: () => sourcePackageDir,
      trustManifest: true
    })

    ensureBuiltinAdapterPackageCache(createOptions('build-a'))
    await writeFile(path.join(sourcePackageDir, 'src', 'models.ts'), 'export const builtinModels = ["second"]\n')
    const [cached] = ensureBuiltinAdapterPackageCache(createOptions('build-a'))
    expect(cached.seeded).toBe(false)
    await expect(readFile(path.join(cached.packageDir, 'src', 'models.ts'), 'utf8')).resolves.toContain('first')

    const [refreshed] = ensureBuiltinAdapterPackageCache(createOptions('build-b'))
    expect(refreshed.seeded).toBe(true)
    await expect(readFile(path.join(refreshed.packageDir, 'src', 'models.ts'), 'utf8')).resolves.toContain('second')
  })

  it('refreshes a packaged adapter when the architecture changes under the same fingerprint', async () => {
    const tempDir = await createTempDir('oneworks-desktop-adapter-packaged-arch-')
    const homeDir = path.join(tempDir, 'home')
    const packageName = '@acme/adapter-packaged-arch'
    const sourcePackageDir = await writeSourceAdapterPackage(tempDir, packageName, '1.2.3', 'first')
    const createOptions = (arch: string) => ({
      arch,
      env: {
        [PUBLIC_RUNTIME_PACKAGE_CACHE_VERSION_ENV]: 'local-cache',
        [RUNTIME_PACKAGE_BUILD_FINGERPRINT_ENV]: 'build-shared',
        [TRUST_DEV_RUNTIME_CACHE_MANIFEST_ENV]: '1'
      },
      homeDir,
      packages: [packageName],
      platform: 'darwin',
      resolvePackageDir: () => sourcePackageDir,
      trustManifest: true
    })

    ensureBuiltinAdapterPackageCache(createOptions('x64'))
    await writeFile(path.join(sourcePackageDir, 'src', 'models.ts'), 'export const builtinModels = ["arm64"]\n')
    const [refreshed] = ensureBuiltinAdapterPackageCache(createOptions('arm64'))

    expect(refreshed.seeded).toBe(true)
    await expect(readFile(path.join(refreshed.packageDir, 'src', 'models.ts'), 'utf8')).resolves.toContain('arm64')
    const manifest = JSON.parse(await readFile(path.join(refreshed.cacheDir, MANIFEST_FILE), 'utf8')) as {
      arch?: string
      platform?: string
    }
    expect(manifest).toMatchObject({ arch: 'arm64', platform: 'darwin' })
  })

  it('honors the configured package cache root in the startup helper', async () => {
    const tempDir = await createTempDir('oneworks-desktop-adapter-configured-cache-')
    const packageCacheRoot = path.join(tempDir, 'package-cache')
    const packageName = '@acme/adapter-configured-cache'
    const sourcePackageDir = await writeSourceAdapterPackage(tempDir, packageName, '1.2.3', 'configured')

    const [seeded] = ensureBuiltinAdapterPackageCache({
      env: {
        __ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__: packageCacheRoot
      },
      packages: [packageName],
      resolvePackageDir: () => sourcePackageDir
    })

    expect(seeded.cacheDir).toBe(resolveAdapterPackageCacheDir(packageName, '1.2.3', tempDir, packageCacheRoot))
    await expect(
      readFile(path.join(resolveAdapterPackageInstallDir(seeded.cacheDir, packageName), 'src', 'models.ts'), 'utf8')
    ).resolves.toContain('configured')
  })

  it.runIf(process.platform !== 'win32')(
    'preserves exact whitespace-bearing home and cache roots when materializing packages',
    async () => {
      const tempDir = await createTempDir('oneworks-desktop-adapter-root-identity-')
      const exactHome = path.join(tempDir, 'home ')
      const adjacentHome = path.join(tempDir, 'home')
      const exactCacheRoot = path.join(tempDir, 'cache ')
      const adjacentCacheRoot = path.join(tempDir, 'cache')
      const packageName = '@acme/adapter-root-identity'
      const sourcePackageDir = await writeSourceAdapterPackage(tempDir, packageName, '1.2.3', 'exact')
      const env = {
        __ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__: exactCacheRoot,
        __ONEWORKS_PROJECT_REAL_HOME__: exactHome
      }

      const [seeded] = ensureBuiltinAdapterPackageCache({
        env,
        packages: [packageName],
        resolvePackageDir: () => sourcePackageDir
      })

      expect(resolveRealHomeDir(env)).toBe(exactHome)
      expect(resolvePackageCacheRootDir(env)).toBe(exactCacheRoot)
      expect(seeded.cacheDir).toBe(resolveAdapterPackageCacheDir(packageName, '1.2.3', exactHome, exactCacheRoot))
      expect(seeded.cacheDir).not.toBe(
        resolveAdapterPackageCacheDir(packageName, '1.2.3', adjacentHome, adjacentCacheRoot)
      )
      await expect(
        readFile(path.join(resolveAdapterPackageInstallDir(seeded.cacheDir, packageName), 'src', 'models.ts'), 'utf8')
      ).resolves.toContain('exact')
    }
  )

  it('materializes a built-in plugin and its runtime dependencies into the npm package cache', async () => {
    const tempDir = await createTempDir('oneworks-desktop-plugin-cache-')
    const homeDir = path.join(tempDir, 'home')
    const packageName = '@acme/plugin-cached'
    const sourcePackageDir = await writeSourcePluginPackage(tempDir, packageName, '1.2.3')

    const result = materializeBuiltinPluginPackage({
      homeDir,
      packageName,
      sourcePackageDir
    })

    const cacheDir = resolveNpmPackageCacheDir(packageName, 'latest', homeDir)
    const packageDir = resolveNpmPackageInstallDir(cacheDir, packageName)
    expect(result).toMatchObject({
      cacheDir,
      packageDir,
      seeded: true
    })
    await expect(readFile(path.join(packageDir, 'dist', 'hooks.js'), 'utf8')).resolves.toContain('@acme/runtime')
    await expect(
      readFile(path.join(packageDir, 'node_modules', '@acme/runtime/index.js'), 'utf8')
    ).resolves.toContain('ok: true')
    expect(require(path.join(packageDir, 'dist', 'hooks.js'))).toEqual({ ok: true })

    const manifest = JSON.parse(await readFile(path.join(cacheDir, NPM_PACKAGE_MANIFEST_FILE), 'utf8')) as {
      cacheVersion?: string
      name?: string
      source?: string
      version?: string
    }
    expect(manifest).toMatchObject({
      cacheVersion: 'latest',
      name: packageName,
      source: 'builtin',
      version: '1.2.3'
    })
  })

  it('keeps conflicting transitive dependency versions isolated for built-in plugins', async () => {
    const tempDir = await createTempDir('oneworks-desktop-plugin-conflicting-deps-')
    const homeDir = path.join(tempDir, 'home')
    const packageName = '@acme/plugin-conflicting-deps'
    const sourcePackageDir = await writeSourcePluginPackageWithConflictingDeps(tempDir, packageName, '1.2.3')

    const result = materializeBuiltinPluginPackage({
      homeDir,
      packageName,
      sourcePackageDir
    })

    const packageDir = resolveNpmPackageInstallDir(result.cacheDir, packageName)
    await expect(
      readFile(path.join(packageDir, 'node_modules', '@acme/left/node_modules/@acme/shared/package.json'), 'utf8')
    ).resolves.toContain('"version": "1.0.0"')
    await expect(
      readFile(path.join(packageDir, 'node_modules', '@acme/right/node_modules/@acme/shared/package.json'), 'utf8')
    ).resolves.toContain('"version": "2.0.0"')
    expect(require(path.join(packageDir, 'dist', 'hooks.js'))).toEqual({ left: 'left-v1', right: 'right-v2' })
  })

  it('preserves dependency alias names when materializing built-in plugins', async () => {
    const tempDir = await createTempDir('oneworks-desktop-plugin-aliased-dep-')
    const homeDir = path.join(tempDir, 'home')
    const packageName = '@acme/plugin-aliased-dep'
    const sourcePackageDir = await writeSourcePluginPackageWithAliasedDependency(tempDir, packageName, '1.2.3')

    const result = materializeBuiltinPluginPackage({
      homeDir,
      packageName,
      sourcePackageDir
    })

    const packageDir = resolveNpmPackageInstallDir(result.cacheDir, packageName)
    await expect(readFile(path.join(packageDir, 'node_modules', 'function-bind', 'package.json'), 'utf8')).resolves
      .toContain('"name": "@nolyfill/function-bind"')
    expect(require(path.join(packageDir, 'dist', 'hooks.js'))).toEqual({ alias: true })
  })

  it('seeds built-in plugins for both latest and their bundled package version', async () => {
    const tempDir = await createTempDir('oneworks-desktop-plugin-ensure-')
    const homeDir = path.join(tempDir, 'home')
    const packageName = '@acme/plugin-versioned'
    const sourcePackageDir = await writeSourcePluginPackage(tempDir, packageName, '1.2.3')

    const seeded = ensureBuiltinPluginPackageCache({
      homeDir,
      packages: [packageName],
      resolvePackageDir: () => sourcePackageDir
    })

    expect(seeded.map(item => item.cacheDir)).toEqual([
      resolveNpmPackageCacheDir(packageName, 'latest', homeDir),
      resolveNpmPackageCacheDir(packageName, '1.2.3', homeDir)
    ])
    const latestNodeModulesStat = await lstat(
      path.join(resolveNpmPackageCacheDir(packageName, 'latest', homeDir), 'node_modules')
    )
    expect(latestNodeModulesStat.isSymbolicLink()).toBe(true)
    await expect(
      readFile(path.join(resolveNpmPackageInstallDir(seeded[1].cacheDir, packageName), 'package.json'), 'utf8')
    ).resolves.toContain('"version": "1.2.3"')
  })

  it('refreshes same-version built-in plugins for a dev runtime build', async () => {
    const tempDir = await createTempDir('oneworks-desktop-plugin-dev-refresh-')
    const homeDir = path.join(tempDir, 'home')
    const packageName = '@acme/plugin-dev-refresh'
    const sourcePackageDir = await writeSourcePluginPackage(tempDir, packageName, '1.2.3')
    const env = {
      __ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION__: 'dev-worktree'
    }

    ensureBuiltinPluginPackageCache({
      env,
      homeDir,
      packages: [packageName],
      resolvePackageDir: () => sourcePackageDir,
      trustManifest: true
    })

    await writeFile(path.join(sourcePackageDir, 'dist', 'hooks.js'), 'module.exports = { refreshed: true }\n')
    const refreshed = ensureBuiltinPluginPackageCache({
      env,
      homeDir,
      packages: [packageName],
      resolvePackageDir: () => sourcePackageDir,
      trustManifest: true
    })

    expect(refreshed.every(item => item.seeded)).toBe(true)
    const packageDir = resolveNpmPackageInstallDir(
      resolveNpmPackageCacheDir(packageName, '1.2.3', homeDir),
      packageName
    )
    expect(require(path.join(packageDir, 'dist', 'hooks.js'))).toEqual({ refreshed: true })
  })

  it('trusts a dev plugin manifest when the packaged build fingerprint is immutable', async () => {
    const tempDir = await createTempDir('oneworks-desktop-plugin-packaged-dev-manifest-')
    const homeDir = path.join(tempDir, 'home')
    const packageName = '@acme/plugin-packaged-dev-manifest'
    const sourcePackageDir = await writeSourcePluginPackage(tempDir, packageName, '1.2.3')
    const env = {
      __ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION__: 'dev-packaged-build',
      [RUNTIME_PACKAGE_BUILD_FINGERPRINT_ENV]: 'build-packaged',
      [TRUST_DEV_RUNTIME_CACHE_MANIFEST_ENV]: '1'
    }
    const options = {
      env,
      homeDir,
      packages: [packageName],
      resolvePackageDir: () => sourcePackageDir,
      trustManifest: true
    }

    ensureBuiltinPluginPackageCache(options)
    await writeFile(path.join(sourcePackageDir, 'dist', 'hooks.js'), 'module.exports = { changed: true }\n')
    const cached = ensureBuiltinPluginPackageCache(options)

    expect(cached.every(item => item.seeded === false)).toBe(true)
    const packageDir = resolveNpmPackageInstallDir(
      resolveNpmPackageCacheDir(packageName, '1.2.3', homeDir),
      packageName
    )
    const packageStat = await lstat(packageDir)
    expect(packageStat.isSymbolicLink()).toBe(true)
    expect(require(path.join(packageDir, 'dist', 'hooks.js'))).toEqual({ changed: true })
  })

  it('keeps trusted plugin links valid through a cache-root alias with different path depth', async () => {
    const tempDir = await createTempDir('oneworks-desktop-plugin-cache-alias-')
    const homeDir = path.join(tempDir, 'home')
    const packageName = '@acme/plugin-cache-alias'
    const sourcePackageDir = await writeSourcePluginPackage(
      path.join(tempDir, 'source'),
      packageName,
      '1.2.3'
    )
    const physicalCacheRoot = path.join(tempDir, 'nested', 'physical', 'cache')
    const packageCacheRootDir = path.join(tempDir, 'cache-alias')
    await mkdir(physicalCacheRoot, { recursive: true })
    await symlink(physicalCacheRoot, packageCacheRootDir, 'dir')

    const seeded = ensureBuiltinPluginPackageCache({
      env: {
        [RUNTIME_PACKAGE_BUILD_FINGERPRINT_ENV]: 'build-packaged',
        [TRUST_DEV_RUNTIME_CACHE_MANIFEST_ENV]: '1'
      },
      homeDir,
      packageCacheRootDir,
      packages: [packageName],
      resolvePackageDir: () => sourcePackageDir,
      trustManifest: true
    })
    const realSourcePackageDir = await realpath(sourcePackageDir)

    expect(seeded.map(item => path.basename(item.cacheDir))).toEqual(['latest', '1.2.3'])
    await Promise.all(
      seeded.map(item => expect(realpath(item.packageDir)).resolves.toBe(realSourcePackageDir))
    )
  })

  it('relinks a trusted release plugin when the installed app source moves', async () => {
    const tempDir = await createTempDir('oneworks-desktop-plugin-release-source-move-')
    const homeDir = path.join(tempDir, 'home')
    const packageName = '@acme/plugin-release-source-move'
    const firstSourcePackageDir = await writeSourcePluginPackage(
      path.join(tempDir, 'mounted-dmg'),
      packageName,
      '1.2.3'
    )
    const installedSourcePackageDir = await writeSourcePluginPackage(
      path.join(tempDir, 'applications'),
      packageName,
      '1.2.3'
    )
    const createOptions = (sourcePackageDir: string) => ({
      env: { HOME: homeDir },
      homeDir,
      packages: [packageName],
      resolvePackageDir: () => sourcePackageDir,
      trustManifest: true
    })

    ensureBuiltinPluginPackageCache(createOptions(firstSourcePackageDir))
    const relinked = ensureBuiltinPluginPackageCache(createOptions(installedSourcePackageDir))
    const packageDir = resolveNpmPackageInstallDir(
      resolveNpmPackageCacheDir(packageName, '1.2.3', homeDir),
      packageName
    )

    expect(relinked.every(item => item.seeded)).toBe(true)
    await expect(realpath(packageDir)).resolves.toBe(await realpath(installedSourcePackageDir))
  })

  it('refreshes a dev plugin when the packaged build fingerprint changes', async () => {
    const tempDir = await createTempDir('oneworks-desktop-plugin-new-packaged-dev-build-')
    const homeDir = path.join(tempDir, 'home')
    const packageName = '@acme/plugin-new-packaged-dev-build'
    const sourcePackageDir = await writeSourcePluginPackage(tempDir, packageName, '1.2.3')
    const createOptions = (runtimePackageBuildFingerprint: string) => ({
      env: {
        __ONEWORKS_DESKTOP_DEV_RUNTIME_VERSION__: 'local-cache',
        [RUNTIME_PACKAGE_BUILD_FINGERPRINT_ENV]: runtimePackageBuildFingerprint,
        [TRUST_DEV_RUNTIME_CACHE_MANIFEST_ENV]: '1'
      },
      homeDir,
      packages: [packageName],
      resolvePackageDir: () => sourcePackageDir,
      trustManifest: true
    })

    ensureBuiltinPluginPackageCache(createOptions('dev-packaged-build-a'))
    await writeFile(path.join(sourcePackageDir, 'dist', 'hooks.js'), 'module.exports = { changed: true }\n')
    const refreshed = ensureBuiltinPluginPackageCache(createOptions('dev-packaged-build-b'))

    expect(refreshed.every(item => item.seeded)).toBe(true)
    const packageDir = resolveNpmPackageInstallDir(
      resolveNpmPackageCacheDir(packageName, '1.2.3', homeDir),
      packageName
    )
    expect(require(path.join(packageDir, 'dist', 'hooks.js'))).toEqual({ changed: true })
  })

  it('does not let a release trust a manifest written by a packaged dev build', async () => {
    const tempDir = await createTempDir('oneworks-desktop-plugin-dev-release-collision-')
    const homeDir = path.join(tempDir, 'home')
    const packageName = '@acme/plugin-dev-release-collision'
    const sourcePackageDir = await writeSourcePluginPackage(tempDir, packageName, '1.2.3')
    const commonOptions = {
      homeDir,
      packages: [packageName],
      resolvePackageDir: () => sourcePackageDir,
      trustManifest: true
    }

    ensureBuiltinPluginPackageCache({
      ...commonOptions,
      env: {
        [PUBLIC_RUNTIME_PACKAGE_CACHE_VERSION_ENV]: '1.2.3',
        [RUNTIME_PACKAGE_BUILD_FINGERPRINT_ENV]: 'build-dev',
        [TRUST_DEV_RUNTIME_CACHE_MANIFEST_ENV]: '1'
      }
    })
    await writeFile(path.join(sourcePackageDir, 'dist', 'hooks.js'), 'module.exports = { release: true }\n')
    const refreshed = ensureBuiltinPluginPackageCache({
      ...commonOptions,
      env: {
        [PUBLIC_RUNTIME_PACKAGE_CACHE_VERSION_ENV]: '1.2.3'
      }
    })

    expect(refreshed.every(item => item.seeded)).toBe(true)
    const packageDir = resolveNpmPackageInstallDir(
      resolveNpmPackageCacheDir(packageName, '1.2.3', homeDir),
      packageName
    )
    const manifest = JSON.parse(
      await readFile(
        path.join(resolveNpmPackageCacheDir(packageName, '1.2.3', homeDir), NPM_PACKAGE_MANIFEST_FILE),
        'utf8'
      )
    ) as { sourceCacheVersion?: string }
    expect(require(path.join(packageDir, 'dist', 'hooks.js'))).toEqual({ release: true })
    expect(manifest.sourceCacheVersion).toBeUndefined()
  })

  it('refreshes a release plugin manifest when the architecture changes', async () => {
    const tempDir = await createTempDir('oneworks-desktop-plugin-release-arch-')
    const homeDir = path.join(tempDir, 'home')
    const packageName = '@acme/plugin-release-arch'
    const sourcePackageDir = await writeSourcePluginPackage(tempDir, packageName, '1.2.3')
    const createOptions = (arch: string) => ({
      arch,
      env: {
        [PUBLIC_RUNTIME_PACKAGE_CACHE_VERSION_ENV]: '1.2.3'
      },
      homeDir,
      packages: [packageName],
      platform: 'darwin',
      resolvePackageDir: () => sourcePackageDir,
      trustManifest: true
    })

    ensureBuiltinPluginPackageCache(createOptions('x64'))
    await writeFile(path.join(sourcePackageDir, 'dist', 'hooks.js'), 'module.exports = { arm64: true }\n')
    const refreshed = ensureBuiltinPluginPackageCache(createOptions('arm64'))

    expect(refreshed.every(item => item.seeded)).toBe(true)
    const cacheDir = resolveNpmPackageCacheDir(packageName, '1.2.3', homeDir)
    const packageDir = resolveNpmPackageInstallDir(cacheDir, packageName)
    const manifest = JSON.parse(await readFile(path.join(cacheDir, NPM_PACKAGE_MANIFEST_FILE), 'utf8')) as {
      arch?: string
      integrity?: string
      platform?: string
    }
    expect(require(path.join(packageDir, 'dist', 'hooks.js'))).toEqual({ arm64: true })
    expect(manifest).toMatchObject({ arch: 'arm64', platform: 'darwin' })
    expect(manifest.integrity).toMatch(/^trusted-/u)
    expect((await lstat(packageDir)).isSymbolicLink()).toBe(true)
  })

  it('materializes a static built-in npm package under a dev cache version', async () => {
    const tempDir = await createTempDir('oneworks-desktop-static-runtime-cache-')
    const homeDir = path.join(tempDir, 'home')
    const packageName = '@acme/static-runtime'
    const sourcePackageDir = await writeSourceStaticPackage(tempDir, packageName, '1.2.3', 'first')

    const result = materializeBuiltinStaticNpmPackage({
      cacheVersion: 'dev-local',
      homeDir,
      packageName,
      sourcePackageDir
    })

    const packageDir = resolveNpmPackageInstallDir(
      resolveNpmPackageCacheDir(packageName, 'dev-local', homeDir),
      packageName
    )
    expect(result).toMatchObject({
      packageDir,
      seeded: true
    })
    await expect(readFile(path.join(packageDir, 'dist', 'index.html'), 'utf8')).resolves.toBe('first')

    await writeFile(path.join(sourcePackageDir, 'dist', 'index.html'), 'second')
    const refreshed = materializeBuiltinStaticNpmPackage({
      cacheVersion: 'dev-local',
      homeDir,
      packageName,
      sourcePackageDir
    })
    expect(refreshed.seeded).toBe(true)
    await expect(readFile(path.join(packageDir, 'dist', 'index.html'), 'utf8')).resolves.toBe('second')
  })

  it('seeds bundled cli, server, and client runtime packages into the selected dev npm cache', async () => {
    const tempDir = await createTempDir('oneworks-desktop-runtime-cache-')
    const homeDir = path.join(tempDir, 'home')
    const cliPackage = '@oneworks/cli'
    const serverPackage = '@oneworks/server'
    const clientPackage = '@oneworks/client'
    const cliSource = await writeSourcePluginPackage(tempDir, cliPackage, '1.2.3')
    const serverSource = await writeSourcePluginPackage(tempDir, serverPackage, '1.2.3')
    const clientSource = await writeSourceStaticPackage(tempDir, clientPackage, '1.2.3', 'client-dist')

    const seeded = ensureBuiltinRuntimePackageCache({
      env: {
        [PUBLIC_RUNTIME_PACKAGE_CACHE_VERSION_ENV]: 'dev-runtime'
      },
      homeDir,
      resolvePackageDir: (packageName) => {
        if (packageName === cliPackage) return cliSource
        if (packageName === serverPackage) return serverSource
        return clientSource
      }
    })

    const cliCacheDir = resolveNpmPackageCacheDir(cliPackage, 'dev-runtime', homeDir)
    const cliPackageDir = resolveNpmPackageInstallDir(cliCacheDir, cliPackage)
    const serverCacheDir = resolveNpmPackageCacheDir(serverPackage, 'dev-runtime', homeDir)
    const serverPackageDir = resolveNpmPackageInstallDir(serverCacheDir, serverPackage)
    const clientPackageDir = resolveNpmPackageInstallDir(
      resolveNpmPackageCacheDir(clientPackage, 'dev-runtime', homeDir),
      clientPackage
    )
    expect(seeded.map(item => item.cacheDir)).toEqual([
      cliCacheDir,
      serverCacheDir,
      resolveNpmPackageCacheDir(clientPackage, 'dev-runtime', homeDir)
    ])
    expect(require(path.join(cliPackageDir, 'dist', 'hooks.js'))).toEqual({ ok: true })
    expect(require(path.join(serverPackageDir, 'dist', 'hooks.js'))).toEqual({ ok: true })
    await expect(readFile(path.join(clientPackageDir, 'dist', 'index.html'), 'utf8')).resolves.toBe('client-dist')
  })

  it('refreshes same-version bundled runtime packages for a dev runtime build', async () => {
    const tempDir = await createTempDir('oneworks-desktop-runtime-dev-refresh-')
    const homeDir = path.join(tempDir, 'home')
    const cliPackage = '@oneworks/cli'
    const serverPackage = '@oneworks/server'
    const clientPackage = '@oneworks/client'
    const cliSource = await writeSourcePluginPackage(tempDir, cliPackage, '1.2.3')
    const serverSource = await writeSourcePluginPackage(tempDir, serverPackage, '1.2.3')
    const clientSource = await writeSourceStaticPackage(tempDir, clientPackage, '1.2.3', 'client-first')
    const options = {
      env: {
        [PUBLIC_RUNTIME_PACKAGE_CACHE_VERSION_ENV]: 'dev-runtime'
      },
      homeDir,
      resolvePackageDir: (packageName: string) => {
        if (packageName === cliPackage) return cliSource
        if (packageName === serverPackage) return serverSource
        return clientSource
      },
      trustManifest: true
    }

    ensureBuiltinRuntimePackageCache(options)
    await writeFile(path.join(serverSource, 'dist', 'hooks.js'), 'module.exports = { refreshed: true }\n')
    await writeFile(path.join(clientSource, 'dist', 'index.html'), 'client-refreshed')
    const refreshed = ensureBuiltinRuntimePackageCache(options)

    const serverPackageDir = resolveNpmPackageInstallDir(
      resolveNpmPackageCacheDir(serverPackage, 'dev-runtime', homeDir),
      serverPackage
    )
    const clientPackageDir = resolveNpmPackageInstallDir(
      resolveNpmPackageCacheDir(clientPackage, 'dev-runtime', homeDir),
      clientPackage
    )
    expect(refreshed.map(item => item.seeded)).toEqual([false, true, true])
    expect(require(path.join(serverPackageDir, 'dist', 'hooks.js'))).toEqual({ refreshed: true })
    await expect(readFile(path.join(clientPackageDir, 'dist', 'index.html'), 'utf8')).resolves.toBe('client-refreshed')
  })

  it('refreshes packaged runtime caches when the build fingerprint changes under a fixed cache version', async () => {
    const tempDir = await createTempDir('oneworks-desktop-runtime-new-packaged-build-')
    const homeDir = path.join(tempDir, 'home')
    const cliPackage = '@oneworks/cli'
    const serverPackage = '@oneworks/server'
    const clientPackage = '@oneworks/client'
    const cliSource = await writeSourcePluginPackage(tempDir, cliPackage, '1.2.3')
    const serverSource = await writeSourcePluginPackage(tempDir, serverPackage, '1.2.3')
    const clientSource = await writeSourceStaticPackage(tempDir, clientPackage, '1.2.3', 'client-first')
    const createOptions = (runtimePackageBuildFingerprint: string) => ({
      env: {
        [PUBLIC_RUNTIME_PACKAGE_CACHE_VERSION_ENV]: 'local-cache',
        [RUNTIME_PACKAGE_BUILD_FINGERPRINT_ENV]: runtimePackageBuildFingerprint,
        [TRUST_DEV_RUNTIME_CACHE_MANIFEST_ENV]: '1'
      },
      homeDir,
      resolvePackageDir: (packageName: string) => {
        if (packageName === cliPackage) return cliSource
        if (packageName === serverPackage) return serverSource
        return clientSource
      },
      trustManifest: true
    })

    ensureBuiltinRuntimePackageCache(createOptions('build-a'))
    await writeFile(path.join(serverSource, 'dist', 'hooks.js'), 'module.exports = { refreshed: true }\n')
    await writeFile(path.join(clientSource, 'dist', 'index.html'), 'client-refreshed')
    const cached = ensureBuiltinRuntimePackageCache(createOptions('build-a'))
    expect(cached.map(item => item.seeded)).toEqual([false, false, false])

    const refreshed = ensureBuiltinRuntimePackageCache(createOptions('build-b'))
    expect(refreshed.map(item => item.seeded)).toEqual([true, true, true])
    const serverPackageDir = resolveNpmPackageInstallDir(
      resolveNpmPackageCacheDir(serverPackage, 'local-cache', homeDir),
      serverPackage
    )
    const clientPackageDir = resolveNpmPackageInstallDir(
      resolveNpmPackageCacheDir(clientPackage, 'local-cache', homeDir),
      clientPackage
    )
    expect(require(path.join(serverPackageDir, 'dist', 'hooks.js'))).toEqual({ refreshed: true })
    await expect(readFile(path.join(clientPackageDir, 'dist', 'index.html'), 'utf8')).resolves.toBe('client-refreshed')
  })

  it('prepares built-in package caches only once across the inherited loader process', () => {
    const env: NodeJS.ProcessEnv = {}
    const prepare = vi.fn()

    expect(runBuiltinPackageCachePreparationOnce({ env, prepare })).toBe(true)
    expect(runBuiltinPackageCachePreparationOnce({ env, prepare })).toBe(false)
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(env[BUILTIN_PACKAGE_CACHE_PREPARED_ENV]).toBe('1')
  })

  it('allows a failed built-in package cache preparation to retry', () => {
    const env: NodeJS.ProcessEnv = {}
    const failure = new Error('cache unavailable')

    expect(() =>
      runBuiltinPackageCachePreparationOnce({
        env,
        prepare: () => {
          throw failure
        }
      })
    ).toThrow(failure)
    expect(env[BUILTIN_PACKAGE_CACHE_PREPARED_ENV]).toBeUndefined()
  })
})
