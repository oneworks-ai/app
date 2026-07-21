/* eslint-disable max-lines -- adapter package cache tests cover cache lookup, fallback, and env precedence together. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  loadAdapter,
  loadAdapterBuiltinModels,
  loadAdapterModelProviderImportCapability,
  loadAdapterWorktreeEnvironmentImportCapability,
  normalizeAdapterPackageId,
  resolveAdapterPackageName,
  resolveAdapterRuntimeTarget,
  resolveExistingNpmPackageDirs,
  sanitizePackageName,
  tryLoadAdapterModelProviderImportCapability,
  tryLoadAdapterWorktreeEnvironmentImportCapability
} from '@oneworks/types'

const tempDirs: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

const writeAdapterPackage = async (
  packageDir: string,
  adapterId: string,
  packageName = '@acme/custom-adapter',
  options: {
    models?: string[]
    dynamicModels?: string[]
    modelProviderImporter?: boolean | 'broken' | 'malformed'
    worktreeEnvironmentImporter?: boolean | 'broken' | 'malformed'
    version?: string
  } = {}
) => {
  const version = options.version ?? '1.0.0'
  const adapterRoot = join(packageDir, 'node_modules', ...packageName.split('/'))
  await mkdir(join(adapterRoot, 'dist'), { recursive: true })
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: '@acme/runtime' }, null, 2))
  await writeFile(
    join(adapterRoot, 'package.json'),
    JSON.stringify(
      {
        name: packageName,
        version,
        exports: {
          '.': './dist/index.js',
          ...(options.models == null && options.dynamicModels == null ? {} : { './models': './dist/models.js' }),
          ...(options.modelProviderImporter
            ? { './model-provider-import': './dist/model-provider-import.js' }
            : {}),
          ...(options.worktreeEnvironmentImporter
            ? { './worktree-environment-import': './dist/worktree-environment-import.js' }
            : {}),
          './package.json': './package.json'
        }
      },
      null,
      2
    )
  )
  await writeFile(
    join(adapterRoot, 'dist/index.js'),
    `module.exports = { default: { id: ${JSON.stringify(adapterId)} } }\n`
  )
  if (options.models != null || options.dynamicModels != null) {
    const dynamicModels = options.dynamicModels?.map(model => ({
      value: model,
      title: model,
      description: `${model} model`
    }))
    const staticModels = options.models?.map(model => ({
      value: model,
      title: model,
      description: `${model} model`
    }))
    await writeFile(
      join(adapterRoot, 'dist/models.js'),
      `module.exports = { ${
        dynamicModels == null ? '' : `loadBuiltinModels: () => ${JSON.stringify(dynamicModels)}, `
      }builtinModels: ${JSON.stringify(staticModels ?? [])} }\n`
    )
  }
  if (options.modelProviderImporter) {
    await writeFile(
      join(adapterRoot, 'dist/model-provider-import.js'),
      options.modelProviderImporter === 'broken'
        ? "module.exports = require('@acme/missing-import-dependency')\n"
        : options.modelProviderImporter === 'malformed'
        ? 'module.exports = { default: async () => ({}) }\n'
        : `module.exports = { default: {
          descriptor: {
            title: 'Custom native config',
            supportedSources: ['global', 'project']
          },
          discover: async params => ({
            found: true,
            modelServices: { [params.source]: { title: params.source } },
            skippedProviderIds: []
          })
        } }\n`
    )
  }
  if (options.worktreeEnvironmentImporter) {
    await writeFile(
      join(adapterRoot, 'dist/worktree-environment-import.js'),
      options.worktreeEnvironmentImporter === 'broken'
        ? "module.exports = require('@acme/missing-environment-import-dependency')\n"
        : options.worktreeEnvironmentImporter === 'malformed'
        ? 'module.exports = { default: async () => ({}) }\n'
        : `module.exports = { default: {
          descriptor: {
            title: 'Custom environments',
            supportedSources: ['project', 'user']
          },
          discover: async () => ({
            found: true,
            environments: [],
            skippedActionCount: 0,
            skippedEnvironmentCount: 0
          })
        } }\n`
    )
  }
}

describe('adapter package helpers', () => {
  it('maps claude adapter aliases to the claude-code package', () => {
    expect(normalizeAdapterPackageId('claude')).toBe('claude-code')
    expect(normalizeAdapterPackageId('adapter-claude')).toBe('adapter-claude-code')
    expect(resolveAdapterPackageName('claude')).toBe('@oneworks/adapter-claude-code')
    expect(resolveAdapterPackageName('adapter-claude')).toBe('@oneworks/adapter-claude-code')
  })

  it('keeps other adapter ids unchanged', () => {
    expect(normalizeAdapterPackageId('codex')).toBe('codex')
    expect(normalizeAdapterPackageId('adapter-codex')).toBe('adapter-codex')
    expect(resolveAdapterPackageName('codex')).toBe('@oneworks/adapter-codex')
    expect(resolveAdapterPackageName('adapter-codex')).toBe('@oneworks/adapter-codex')
    expect(resolveAdapterPackageName('@scope/custom-adapter')).toBe('@scope/custom-adapter')
  })

  it('resolves configured adapter runtime packages from package names and package root paths', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-adapter-runtime-target-'))
    tempDirs.push(tempDir)

    const callerPackageDir = join(tempDir, 'caller-package')
    await writeAdapterPackage(callerPackageDir, 'path-codex', '@oneworks/adapter-codex', {
      models: ['path-model'],
      modelProviderImporter: true
    })
    const adapterRoot = join(callerPackageDir, 'node_modules', '@oneworks', 'adapter-codex')

    expect(resolveAdapterRuntimeTarget('fast', {
      config: {
        adapters: {
          fast: {
            packageId: '@oneworks/adapter-codex'
          }
        } as any
      }
    })).toMatchObject({
      instanceKey: 'fast',
      loadSpecifier: '@oneworks/adapter-codex',
      runtimeAdapter: 'codex'
    })
    expect(resolveAdapterRuntimeTarget('local', {
      config: {
        adapters: {
          local: {
            packageId: './node_modules/@oneworks/adapter-codex'
          }
        } as any
      },
      cwd: callerPackageDir
    })).toMatchObject({
      instanceKey: 'local',
      loadSpecifier: adapterRoot,
      runtimeAdapter: 'codex'
    })
    await expect(loadAdapter(adapterRoot)).resolves.toMatchObject({
      id: 'path-codex'
    })
    expect(loadAdapterBuiltinModels(adapterRoot)?.map(model => model.value)).toEqual(['path-model'])
    await expect(loadAdapterModelProviderImportCapability(adapterRoot)).resolves.toMatchObject({
      descriptor: { title: 'Custom native config' }
    })
  })

  it('loads adapters from the caller package dir before the active runtime package dir', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-adapter-resolver-'))
    tempDirs.push(tempDir)

    const callerPackageDir = join(tempDir, 'caller-package')
    const runtimePackageDir = join(tempDir, 'runtime-package')
    await writeAdapterPackage(callerPackageDir, 'caller')
    await writeAdapterPackage(runtimePackageDir, 'runtime')

    vi.stubEnv('__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__', callerPackageDir)
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', runtimePackageDir)

    await expect(loadAdapter('@acme/custom-adapter')).resolves.toMatchObject({
      id: 'caller'
    })
  })

  it('loads adapter builtin models through the same package resolution path', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-adapter-models-resolver-'))
    tempDirs.push(tempDir)

    const callerPackageDir = join(tempDir, 'caller-package')
    await writeAdapterPackage(callerPackageDir, 'caller', '@acme/custom-adapter', {
      models: ['native-default', 'native-pro']
    })

    vi.stubEnv('__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__', callerPackageDir)

    expect(loadAdapterBuiltinModels('@acme/custom-adapter')?.map(model => model.value)).toEqual([
      'native-default',
      'native-pro'
    ])
  })

  it('loads a model provider import capability through the adapter package export', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-adapter-provider-importer-'))
    tempDirs.push(tempDir)

    const callerPackageDir = join(tempDir, 'caller-package')
    await writeAdapterPackage(callerPackageDir, 'caller', '@acme/custom-adapter', {
      modelProviderImporter: true
    })
    vi.stubEnv('__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__', callerPackageDir)

    const capability = await loadAdapterModelProviderImportCapability('@acme/custom-adapter')

    expect(capability.descriptor).toEqual({
      title: 'Custom native config',
      supportedSources: ['global', 'project']
    })
    await expect(capability.discover({ cwd: '/workspace', env: {}, source: 'project' })).resolves.toMatchObject({
      found: true,
      modelServices: { project: { title: 'project' } }
    })
  })

  it('returns undefined only when the optional model provider import export is absent', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-adapter-provider-importer-absent-'))
    tempDirs.push(tempDir)
    const callerPackageDir = join(tempDir, 'caller-package')
    await writeAdapterPackage(callerPackageDir, 'caller')
    vi.stubEnv('__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__', callerPackageDir)

    await expect(tryLoadAdapterModelProviderImportCapability('@acme/custom-adapter')).resolves.toBeUndefined()
    await expect(loadAdapterModelProviderImportCapability('@acme/custom-adapter')).rejects.toThrow(
      'does not expose a model provider import capability'
    )
  })

  it('loads and validates an optional worktree environment import capability', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-adapter-environment-importer-'))
    tempDirs.push(tempDir)
    const callerPackageDir = join(tempDir, 'caller-package')
    await writeAdapterPackage(callerPackageDir, 'caller', '@acme/custom-adapter', {
      worktreeEnvironmentImporter: true
    })
    vi.stubEnv('__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__', callerPackageDir)

    const capability = await loadAdapterWorktreeEnvironmentImportCapability('@acme/custom-adapter')

    expect(capability.descriptor).toEqual({
      title: 'Custom environments',
      supportedSources: ['project', 'user']
    })
    await expect(capability.discover({ cwd: '/workspace', env: {}, source: 'project' })).resolves.toEqual({
      environments: [],
      found: true,
      skippedActionCount: 0,
      skippedEnvironmentCount: 0
    })
  })

  it('distinguishes an absent environment import export from a malformed or broken capability', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-adapter-environment-importer-invalid-'))
    tempDirs.push(tempDir)
    const absentDir = join(tempDir, 'absent')
    const malformedDir = join(tempDir, 'malformed')
    const brokenDir = join(tempDir, 'broken')
    await writeAdapterPackage(absentDir, 'absent', '@acme/absent-adapter')
    await writeAdapterPackage(malformedDir, 'malformed', '@acme/malformed-adapter', {
      worktreeEnvironmentImporter: 'malformed'
    })
    await writeAdapterPackage(brokenDir, 'broken', '@acme/broken-adapter', {
      worktreeEnvironmentImporter: 'broken'
    })

    await expect(tryLoadAdapterWorktreeEnvironmentImportCapability(
      join(absentDir, 'node_modules', '@acme', 'absent-adapter')
    )).resolves.toBeUndefined()
    await expect(tryLoadAdapterWorktreeEnvironmentImportCapability(
      join(malformedDir, 'node_modules', '@acme', 'malformed-adapter')
    )).rejects.toThrow('does not expose a worktree environment import capability')
    await expect(tryLoadAdapterWorktreeEnvironmentImportCapability(
      join(brokenDir, 'node_modules', '@acme', 'broken-adapter')
    )).rejects.toMatchObject({ code: 'MODULE_NOT_FOUND' })
  })

  it('does not hide malformed capabilities or missing internal dependencies as unsupported', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-adapter-provider-importer-invalid-'))
    tempDirs.push(tempDir)
    const malformedDir = join(tempDir, 'malformed')
    const brokenDir = join(tempDir, 'broken')
    await writeAdapterPackage(malformedDir, 'malformed', '@acme/malformed-adapter', {
      modelProviderImporter: 'malformed'
    })
    await writeAdapterPackage(brokenDir, 'broken', '@acme/broken-adapter', {
      modelProviderImporter: 'broken'
    })

    await expect(tryLoadAdapterModelProviderImportCapability(
      join(malformedDir, 'node_modules', '@acme', 'malformed-adapter')
    )).rejects.toThrow('does not expose a model provider import capability')
    await expect(tryLoadAdapterModelProviderImportCapability(
      join(brokenDir, 'node_modules', '@acme', 'broken-adapter')
    )).rejects.toMatchObject({ code: 'MODULE_NOT_FOUND' })
  })

  it('prefers a dynamic builtin model loader when the adapter exports one', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-adapter-dynamic-models-'))
    tempDirs.push(tempDir)

    const callerPackageDir = join(tempDir, 'caller-package')
    await writeAdapterPackage(callerPackageDir, 'caller', '@acme/custom-adapter', {
      dynamicModels: ['cache-model'],
      models: ['static-model']
    })

    vi.stubEnv('__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__', callerPackageDir)

    expect(loadAdapterBuiltinModels('@acme/custom-adapter')?.map(model => model.value)).toEqual([
      'cache-model'
    ])
  })

  it('loads adapters from the bootstrap adapter package cache after runtime package dirs miss', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-adapter-cache-resolver-'))
    tempDirs.push(tempDir)

    const homeDir = join(tempDir, 'home')
    const serverPackageDir = join(tempDir, 'server-package')
    const adapterPackageName = '@acme/cached-adapter'
    const cacheDir = join(
      homeDir,
      '.oneworks',
      'bootstrap',
      'adapter-packages',
      sanitizePackageName(adapterPackageName),
      '1.0.0'
    )
    await mkdir(serverPackageDir, { recursive: true })
    await writeFile(join(serverPackageDir, 'package.json'), JSON.stringify({ name: '@oneworks/server' }, null, 2))
    await writeAdapterPackage(cacheDir, 'cached-adapter', adapterPackageName)

    vi.stubEnv('__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__', serverPackageDir)
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', serverPackageDir)
    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', homeDir)

    await expect(loadAdapter(adapterPackageName)).resolves.toMatchObject({
      id: 'cached-adapter'
    })
  })

  it('loads adapters from the configured package cache root', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-adapter-custom-cache-resolver-'))
    tempDirs.push(tempDir)

    const packageCacheRoot = join(tempDir, 'package-cache')
    const serverPackageDir = join(tempDir, 'server-package')
    const adapterPackageName = '@acme/configured-cache-adapter'
    const cacheDir = join(
      packageCacheRoot,
      'adapter-packages',
      sanitizePackageName(adapterPackageName),
      '1.0.0'
    )
    await mkdir(serverPackageDir, { recursive: true })
    await writeFile(join(serverPackageDir, 'package.json'), JSON.stringify({ name: '@oneworks/server' }, null, 2))
    await writeAdapterPackage(cacheDir, 'configured-cache-adapter', adapterPackageName)

    vi.stubEnv('__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__', serverPackageDir)
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', serverPackageDir)
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__', packageCacheRoot)

    await expect(loadAdapter(adapterPackageName)).resolves.toMatchObject({
      id: 'configured-cache-adapter'
    })
  })

  it('lists cached npm runtime packages newest first from the configured cache root', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-npm-cache-resolver-'))
    tempDirs.push(tempDir)

    const packageCacheRoot = join(tempDir, 'package-cache')
    const packageName = '@oneworks/client'
    for (const version of ['3.4.0', '3.5.0']) {
      const packageDir = join(
        packageCacheRoot,
        'npm',
        sanitizePackageName(packageName),
        version,
        'node_modules',
        ...packageName.split('/')
      )
      await mkdir(packageDir, { recursive: true })
      await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: packageName, version }, null, 2))
    }

    expect(resolveExistingNpmPackageDirs(packageName, {
      __ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__: packageCacheRoot
    })).toEqual([
      join(
        packageCacheRoot,
        'npm',
        sanitizePackageName(packageName),
        '3.5.0',
        'node_modules',
        ...packageName.split('/')
      ),
      join(
        packageCacheRoot,
        'npm',
        sanitizePackageName(packageName),
        '3.4.0',
        'node_modules',
        ...packageName.split('/')
      )
    ])
  })

  it('uses only the selected dev runtime version for cached npm runtime packages', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-npm-dev-cache-resolver-'))
    tempDirs.push(tempDir)

    const packageCacheRoot = join(tempDir, 'package-cache')
    const packageName = '@oneworks/server'
    const releasePackageDir = join(
      packageCacheRoot,
      'npm',
      sanitizePackageName(packageName),
      '3.5.0',
      'node_modules',
      ...packageName.split('/')
    )
    const devPackageDir = join(
      packageCacheRoot,
      'npm',
      sanitizePackageName(packageName),
      'dev-local',
      'node_modules',
      ...packageName.split('/')
    )
    await mkdir(releasePackageDir, { recursive: true })
    await mkdir(devPackageDir, { recursive: true })
    await writeFile(
      join(releasePackageDir, 'package.json'),
      JSON.stringify({ name: packageName, version: '3.5.0' }, null, 2)
    )
    await writeFile(
      join(devPackageDir, 'package.json'),
      JSON.stringify({ name: packageName, version: '3.4.0' }, null, 2)
    )

    expect(resolveExistingNpmPackageDirs(packageName, {
      ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION: 'dev-local',
      __ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__: packageCacheRoot
    })).toEqual([devPackageDir])
    expect(resolveExistingNpmPackageDirs(packageName, {
      ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION: 'dev-missing',
      __ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__: packageCacheRoot
    })).toEqual([])
  })

  it('prefers the user-home adapter package cache over the default runtime package dir', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-adapter-cache-priority-'))
    tempDirs.push(tempDir)

    const homeDir = join(tempDir, 'home')
    const serverPackageDir = join(tempDir, 'server-package')
    const adapterPackageName = '@acme/cache-priority-adapter'
    const cacheDir = join(
      homeDir,
      '.oneworks',
      'bootstrap',
      'adapter-packages',
      sanitizePackageName(adapterPackageName),
      '1.0.0'
    )
    await writeAdapterPackage(serverPackageDir, 'runtime-adapter', adapterPackageName, {
      models: ['runtime-model']
    })
    await writeAdapterPackage(cacheDir, 'cached-adapter', adapterPackageName, {
      models: ['cached-model']
    })

    vi.stubEnv('__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__', serverPackageDir)
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', serverPackageDir)
    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', homeDir)

    expect(loadAdapterBuiltinModels(adapterPackageName)?.map(model => model.value)).toEqual(['cached-model'])
  })

  it('prefers the user-home adapter package cache over workspace node_modules', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-adapter-workspace-cache-priority-'))
    tempDirs.push(tempDir)

    const originalCwd = process.cwd()
    const workspace = join(tempDir, 'workspace')
    const homeDir = join(tempDir, 'home')
    const adapterPackageName = '@acme/workspace-cache-priority-adapter'
    const cacheDir = join(
      homeDir,
      '.oneworks',
      'bootstrap',
      'adapter-packages',
      sanitizePackageName(adapterPackageName),
      '1.0.0'
    )
    await writeAdapterPackage(workspace, 'workspace-adapter', adapterPackageName, {
      models: ['workspace-model']
    })
    await writeAdapterPackage(cacheDir, 'cached-adapter', adapterPackageName, {
      models: ['cached-model']
    })

    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', homeDir)
    process.chdir(workspace)
    try {
      expect(loadAdapterBuiltinModels(adapterPackageName)?.map(model => model.value)).toEqual(['cached-model'])
    } finally {
      process.chdir(originalCwd)
    }
  })

  it('uses the built-in desktop adapter cache when global cache versions are below the built-in floor', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-adapter-cache-builtin-floor-'))
    tempDirs.push(tempDir)

    const homeDir = join(tempDir, 'home')
    const serverPackageDir = join(tempDir, 'server-package')
    const adapterPackageName = '@acme/builtin-floor-adapter'
    const legacyCacheDir = join(
      homeDir,
      '.oneworks',
      'bootstrap',
      'adapter-packages',
      sanitizePackageName(adapterPackageName),
      '1.9.0'
    )
    const builtinCacheDir = join(
      homeDir,
      '.oneworks',
      'bootstrap',
      'adapter-packages',
      sanitizePackageName(adapterPackageName),
      '2.0.0'
    )
    await mkdir(serverPackageDir, { recursive: true })
    await writeFile(join(serverPackageDir, 'package.json'), JSON.stringify({ name: '@oneworks/server' }, null, 2))
    await writeAdapterPackage(legacyCacheDir, 'legacy-adapter', adapterPackageName, {
      models: ['legacy-model'],
      version: '1.9.0'
    })
    await writeAdapterPackage(builtinCacheDir, 'builtin-adapter', adapterPackageName, {
      models: ['builtin-model'],
      version: '2.0.0'
    })

    vi.stubEnv(
      '__ONEWORKS_DESKTOP_BUILTIN_ADAPTER_PACKAGES__',
      JSON.stringify({
        [adapterPackageName]: {
          cacheDir: builtinCacheDir,
          version: '2.0.0'
        }
      })
    )
    vi.stubEnv('__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__', serverPackageDir)
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', serverPackageDir)
    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', homeDir)

    expect(loadAdapterBuiltinModels(adapterPackageName)?.map(model => model.value)).toEqual(['builtin-model'])
  })

  it('prefers the built-in desktop adapter dev cache when a dev runtime version is selected', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-adapter-cache-builtin-dev-'))
    tempDirs.push(tempDir)

    const homeDir = join(tempDir, 'home')
    const serverPackageDir = join(tempDir, 'server-package')
    const adapterPackageName = '@acme/builtin-dev-adapter'
    const releaseCacheDir = join(
      homeDir,
      '.oneworks',
      'bootstrap',
      'adapter-packages',
      sanitizePackageName(adapterPackageName),
      '2.1.0'
    )
    const builtinDevCacheDir = join(
      homeDir,
      '.oneworks',
      'bootstrap',
      'adapter-packages',
      sanitizePackageName(adapterPackageName),
      'dev-local'
    )
    await mkdir(serverPackageDir, { recursive: true })
    await writeFile(join(serverPackageDir, 'package.json'), JSON.stringify({ name: '@oneworks/server' }, null, 2))
    await writeAdapterPackage(releaseCacheDir, 'release-adapter', adapterPackageName, {
      models: ['release-model'],
      version: '2.1.0'
    })
    await writeAdapterPackage(builtinDevCacheDir, 'dev-adapter', adapterPackageName, {
      models: ['dev-model'],
      version: '2.0.0'
    })

    vi.stubEnv(
      '__ONEWORKS_DESKTOP_BUILTIN_ADAPTER_PACKAGES__',
      JSON.stringify({
        [adapterPackageName]: {
          cacheDir: builtinDevCacheDir,
          cacheVersion: 'dev-local',
          version: '2.0.0'
        }
      })
    )
    vi.stubEnv('ONEWORKS_RUNTIME_PACKAGE_CACHE_VERSION', 'dev-local')
    vi.stubEnv('__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__', serverPackageDir)
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', serverPackageDir)
    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', homeDir)

    expect(loadAdapterBuiltinModels(adapterPackageName)?.map(model => model.value)).toEqual(['dev-model'])
  })

  it('preserves an explicit external CLI package dir ahead of the user-home adapter cache', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'ow-adapter-explicit-cli-dir-'))
    tempDirs.push(tempDir)

    const homeDir = join(tempDir, 'home')
    const serverPackageDir = join(tempDir, 'server-package')
    const explicitCliPackageDir = join(tempDir, 'explicit-cli-package')
    const adapterPackageName = '@acme/explicit-cli-adapter'
    const cacheDir = join(
      homeDir,
      '.oneworks',
      'bootstrap',
      'adapter-packages',
      sanitizePackageName(adapterPackageName),
      '1.0.0'
    )
    await mkdir(serverPackageDir, { recursive: true })
    await writeFile(join(serverPackageDir, 'package.json'), JSON.stringify({ name: '@oneworks/server' }, null, 2))
    await writeAdapterPackage(explicitCliPackageDir, 'explicit-adapter', adapterPackageName, {
      models: ['explicit-model']
    })
    await writeAdapterPackage(cacheDir, 'cached-adapter', adapterPackageName, {
      models: ['cached-model']
    })

    vi.stubEnv('__ONEWORKS_PROJECT_CLI_PACKAGE_DIR__', explicitCliPackageDir)
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', serverPackageDir)
    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', homeDir)

    expect(loadAdapterBuiltinModels(adapterPackageName)?.map(model => model.value)).toEqual(['explicit-model'])
  })
})
