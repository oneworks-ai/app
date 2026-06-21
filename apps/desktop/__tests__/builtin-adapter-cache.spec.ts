import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  BUILTIN_ADAPTER_PACKAGE_ENV,
  MANIFEST_FILE,
  NPM_PACKAGE_MANIFEST_FILE,
  ensureBuiltinAdapterPackageCache,
  ensureBuiltinPluginPackageCache,
  hashPackageClosure,
  materializeBuiltinPluginPackage,
  materializeBuiltinAdapterPackage,
  resolveAdapterPackageCacheDir,
  resolveAdapterPackageInstallDir,
  resolveNpmPackageCacheDir,
  resolveNpmPackageInstallDir,
  sanitizePackageName
} = require('../src/builtin-adapter-cache.cjs') as typeof import('../src/builtin-adapter-cache.cjs')

const tempDirs: string[] = []

afterEach(async () => {
  delete process.env[BUILTIN_ADAPTER_PACKAGE_ENV]
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
  await writeFile(path.join(minipassCollectDir, 'index.js'), "module.exports = require('minipass/package.json').version\n")

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
      readFile(path.join(cacheDir, 'node_modules', '@acme/runtime/index.js'), 'utf8')
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

  it('preserves nested dependency versions when copying a package closure', async () => {
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
      readFile(path.join(result.cacheDir, 'node_modules', 'minipass-collect', 'node_modules', 'minipass', 'package.json'), 'utf8')
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
      readFile(path.join(cacheDir, 'node_modules', '@acme/runtime/index.js'), 'utf8')
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
})
