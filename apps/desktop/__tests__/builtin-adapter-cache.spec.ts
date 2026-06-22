/* eslint-disable max-lines -- desktop package cache tests cover adapter, runtime, and alias closure behavior together. */
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  BUILTIN_ADAPTER_PACKAGE_ENV,
  DESKTOP_DEV_RUNTIME_VERSION_ENV,
  MANIFEST_FILE,
  NPM_PACKAGE_MANIFEST_FILE,
  PUBLIC_DESKTOP_DEV_RUNTIME_VERSION_ENV,
  PUBLIC_RUNTIME_PACKAGE_CACHE_VERSION_ENV,
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
  sanitizePackageName
} = require('../src/builtin-adapter-cache.cjs') as typeof import('../src/builtin-adapter-cache.cjs')

const tempDirs: string[] = []

afterEach(async () => {
  delete process.env[BUILTIN_ADAPTER_PACKAGE_ENV]
  delete process.env[DESKTOP_DEV_RUNTIME_VERSION_ENV]
  delete process.env[PUBLIC_DESKTOP_DEV_RUNTIME_VERSION_ENV]
  delete process.env[PUBLIC_RUNTIME_PACKAGE_CACHE_VERSION_ENV]
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
    await expect(
      readFile(path.join(resolveNpmPackageInstallDir(seeded[1].cacheDir, packageName), 'package.json'), 'utf8')
    ).resolves.toContain('"version": "1.2.3"')
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

  it('seeds bundled server and client runtime packages into the selected dev npm cache', async () => {
    const tempDir = await createTempDir('oneworks-desktop-runtime-cache-')
    const homeDir = path.join(tempDir, 'home')
    const serverPackage = '@oneworks/server'
    const clientPackage = '@oneworks/client'
    const serverSource = await writeSourcePluginPackage(tempDir, serverPackage, '1.2.3')
    const clientSource = await writeSourceStaticPackage(tempDir, clientPackage, '1.2.3', 'client-dist')

    const seeded = ensureBuiltinRuntimePackageCache({
      env: {
        [PUBLIC_RUNTIME_PACKAGE_CACHE_VERSION_ENV]: 'dev-runtime'
      },
      homeDir,
      resolvePackageDir: packageName => packageName === serverPackage ? serverSource : clientSource
    })

    const serverCacheDir = resolveNpmPackageCacheDir(serverPackage, 'dev-runtime', homeDir)
    const serverPackageDir = resolveNpmPackageInstallDir(serverCacheDir, serverPackage)
    const clientPackageDir = resolveNpmPackageInstallDir(
      resolveNpmPackageCacheDir(clientPackage, 'dev-runtime', homeDir),
      clientPackage
    )
    expect(seeded.map(item => item.cacheDir)).toEqual([
      serverCacheDir,
      resolveNpmPackageCacheDir(clientPackage, 'dev-runtime', homeDir)
    ])
    expect(require(path.join(serverPackageDir, 'dist', 'hooks.js'))).toEqual({ ok: true })
    await expect(readFile(path.join(clientPackageDir, 'dist', 'index.html'), 'utf8')).resolves.toBe('client-dist')
  })
})
