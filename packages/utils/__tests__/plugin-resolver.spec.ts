/* eslint-disable max-lines -- Plugin resolver regression coverage keeps related package and config resolution fixtures together. */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  Arborist: vi.fn(),
  manifest: vi.fn()
}))

vi.mock('pacote', () => ({
  default: {
    manifest: mocks.manifest
  }
}))

vi.mock('@npmcli/arborist', () => ({
  default: mocks.Arborist
}))

const { resolveManagedPluginPackageInstallDir } = await import('#~/managed-plugin-package.js')
const { getManagedPluginInstallDir } = await import('#~/managed-plugin.js')
const {
  discoverRuntimePluginConfigs,
  resolveConfiguredPluginInstances,
  resolvePluginConfigEntryPathForInstance,
  resolvePluginHooksEntryPathForInstance,
  resolveRuntimePluginConfig
} = await import('#~/plugin-resolver.js')

const tempDirs: string[] = []

const writeLoggerPluginPackage = async (
  pluginRoot: string,
  version: string,
  packageName = '@oneworks/plugin-logger'
) => {
  await mkdir(join(pluginRoot, 'dist'), { recursive: true })
  await writeFile(
    join(pluginRoot, 'package.json'),
    JSON.stringify(
      {
        name: packageName,
        version,
        exports: {
          '.': './dist/index.js',
          './config': './dist/config.js',
          './hooks': './dist/hooks.js',
          './package.json': './package.json'
        }
      },
      null,
      2
    )
  )
  await writeFile(join(pluginRoot, 'dist/index.js'), 'module.exports = { __oneWorksPluginManifest: true }\n')
  await writeFile(join(pluginRoot, 'dist/config.js'), 'module.exports = () => ({})\n')
  await writeFile(join(pluginRoot, 'dist/hooks.js'), 'module.exports = {}\n')
}

const writeDirectoryPlugin = async (
  pluginRoot: string,
  manifestFile: 'plugin.json' | 'plugin.yaml' | 'plugin.yml' | 'package.json' = 'plugin.json'
) => {
  await mkdir(join(pluginRoot, 'hooks'), { recursive: true })
  const manifest = {
    name: 'workspace-tools',
    plugin: {
      client: { entry: './client/index.js' },
      server: { entry: './server/index.js' },
      contributions: {
        navItems: [{ id: 'dashboard', title: 'Dashboard', route: '/plugins/workspace-tools/dashboard' }]
      }
    }
  }
  const content = manifestFile.endsWith('.json')
    ? JSON.stringify(manifest, null, 2)
    : [
      'name: workspace-tools',
      'plugin:',
      '  client:',
      '    entry: ./client/index.js',
      '  server:',
      '    entry: ./server/index.js'
    ].join('\n')
  await writeFile(join(pluginRoot, manifestFile), content)
  await writeFile(join(pluginRoot, 'hooks/index.js'), 'module.exports = {}\n')
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200 }))))

afterEach(async () => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('plugin resolver', () => {
  it('resolves plugins from the runtime package dir when the workspace does not install them', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'oneworks-plugin-resolver-'))
    tempDirs.push(tempDir)

    const workspace = join(tempDir, 'workspace')
    const realHome = join(tempDir, 'home')
    const packageDir = join(tempDir, 'runtime-package')
    const pluginRoot = join(packageDir, 'node_modules/@oneworks/plugin-runtime-only')
    await mkdir(workspace, { recursive: true })
    await mkdir(packageDir, { recursive: true })
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: '@acme/runtime' }, null, 2))
    await writeLoggerPluginPackage(pluginRoot, '1.0.0', '@oneworks/plugin-runtime-only')

    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', realHome)
    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', packageDir)

    const [instance] = await resolveConfiguredPluginInstances({
      cwd: workspace,
      plugins: [{ id: 'runtime-only' }]
    })

    expect(instance).toMatchObject({
      requestId: 'runtime-only',
      packageId: '@oneworks/plugin-runtime-only',
      rootDir: pluginRoot,
      resolvedBy: 'oneworks-prefix'
    })
    expect(resolvePluginHooksEntryPathForInstance(workspace, instance!)).toContain(
      join('node_modules', '@oneworks', 'plugin-runtime-only', 'dist', 'hooks.js')
    )
    expect(resolvePluginConfigEntryPathForInstance(workspace, instance!)).toContain(
      join('node_modules', '@oneworks', 'plugin-runtime-only', 'dist', 'config.js')
    )
  })

  it('resolves default OneWorks plugins from the global package cache when workspace and runtime omit them', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'oneworks-plugin-resolver-'))
    tempDirs.push(tempDir)

    const workspace = join(tempDir, 'workspace')
    const realHome = join(tempDir, 'home')
    const pluginRoot = resolveManagedPluginPackageInstallDir({
      env: {
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      packageName: '@oneworks/plugin-logger',
      version: '3.2.0'
    })
    await mkdir(workspace, { recursive: true })
    await writeLoggerPluginPackage(pluginRoot, '3.2.0')

    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', realHome)
    vi.stubEnv('__ONEWORKS_PROJECT_PLUGIN_AUTO_INSTALL__', 'false')

    const [instance] = await resolveConfiguredPluginInstances({
      cwd: workspace,
      plugins: [{ id: 'logger' }]
    })

    expect(instance).toMatchObject({
      requestId: 'logger',
      packageId: '@oneworks/plugin-logger',
      rootDir: pluginRoot,
      resolvedBy: 'managed-package-cache'
    })
    expect(resolvePluginHooksEntryPathForInstance(workspace, instance!)).toContain(
      join('node_modules', '@oneworks', 'plugin-logger', 'dist', 'hooks.js')
    )
  })

  it('prefers module-managed active cache for default OneWorks plugins', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'oneworks-plugin-resolver-'))
    tempDirs.push(tempDir)

    const workspace = join(tempDir, 'workspace')
    const realHome = join(tempDir, 'home')
    const packageDir = join(tempDir, 'runtime-package')
    const bundledPluginRoot = join(packageDir, 'node_modules/@oneworks/plugin-logger')
    const activePluginRoot = resolveManagedPluginPackageInstallDir({
      env: {
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      packageName: '@oneworks/plugin-logger',
      version: '4.1.0'
    })
    await mkdir(workspace, { recursive: true })
    await mkdir(join(realHome, '.oneworks/bootstrap/module-updates'), { recursive: true })
    await writeLoggerPluginPackage(bundledPluginRoot, '1.0.0')
    await writeLoggerPluginPackage(activePluginRoot, '4.1.0')
    await writeFile(
      join(realHome, '.oneworks/bootstrap/module-updates/oneworks__plugin-logger.json'),
      JSON.stringify(
        {
          packageDir: activePluginRoot,
          packageName: '@oneworks/plugin-logger',
          updatedAt: '2026-06-06T00:00:00.000Z',
          version: '4.1.0'
        },
        null,
        2
      )
    )

    vi.stubEnv('__ONEWORKS_PROJECT_PACKAGE_DIR__', packageDir)
    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', realHome)

    const [instance] = await resolveConfiguredPluginInstances({
      cwd: workspace,
      plugins: [{ id: 'logger' }]
    })

    expect(instance).toMatchObject({
      packageId: '@oneworks/plugin-logger',
      rootDir: activePluginRoot,
      resolvedBy: 'managed-package-cache'
    })
  })

  it('prefers bundled official plugins over active cache when requested', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'oneworks-plugin-resolver-'))
    tempDirs.push(tempDir)

    const workspace = join(tempDir, 'workspace')
    const realHome = join(tempDir, 'home')
    const workspacePluginRoot = join(workspace, 'node_modules/@oneworks/plugin-relay')
    const activePluginRoot = resolveManagedPluginPackageInstallDir({
      env: {
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      packageName: '@oneworks/plugin-relay',
      version: '0.1.0'
    })
    await mkdir(workspace, { recursive: true })
    await mkdir(join(realHome, '.oneworks/bootstrap/module-updates'), { recursive: true })
    await writeLoggerPluginPackage(workspacePluginRoot, '0.2.0', '@oneworks/plugin-relay')
    await writeLoggerPluginPackage(activePluginRoot, '0.1.0', '@oneworks/plugin-relay')
    await writeFile(
      join(realHome, '.oneworks/bootstrap/module-updates/oneworks__plugin-relay.json'),
      JSON.stringify(
        {
          packageDir: activePluginRoot,
          packageName: '@oneworks/plugin-relay',
          updatedAt: '2026-06-06T00:00:00.000Z',
          version: '0.1.0'
        },
        null,
        2
      )
    )

    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', realHome)

    const [normal] = await resolveConfiguredPluginInstances({
      cwd: workspace,
      plugins: [{ id: '@oneworks/plugin-relay' }]
    })
    const [preferred] = await resolveConfiguredPluginInstances({
      cwd: workspace,
      plugins: [{ id: '@oneworks/plugin-relay' }],
      preferBundledOfficialPlugins: true
    })

    expect(normal?.rootDir).toBe(activePluginRoot)
    expect(preferred?.rootDir).toBe(workspacePluginRoot)
  })

  it('prefers an existing global package cache over workspace packages for OneWorks plugins', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'oneworks-plugin-resolver-'))
    tempDirs.push(tempDir)

    const workspace = join(tempDir, 'workspace')
    const workspacePluginRoot = join(workspace, 'node_modules/@oneworks/plugin-logger')
    const realHome = join(tempDir, 'home')
    const cachedPluginRoot = resolveManagedPluginPackageInstallDir({
      env: {
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      packageName: '@oneworks/plugin-logger',
      version: '3.2.0'
    })
    await mkdir(workspace, { recursive: true })
    await writeLoggerPluginPackage(workspacePluginRoot, '1.0.0')
    await writeLoggerPluginPackage(cachedPluginRoot, '3.2.0')

    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', realHome)
    vi.stubEnv('__ONEWORKS_PROJECT_PLUGIN_AUTO_INSTALL__', 'false')

    const [instance] = await resolveConfiguredPluginInstances({
      cwd: workspace,
      plugins: [{ id: 'logger' }]
    })

    expect(instance).toMatchObject({
      packageId: '@oneworks/plugin-logger',
      rootDir: cachedPluginRoot,
      resolvedBy: 'managed-package-cache'
    })
  })

  it('installs a non-bundled managed OneWorks plugin into an empty global package cache', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'oneworks-plugin-resolver-empty-cache-'))
    tempDirs.push(tempDir)

    const workspace = join(tempDir, 'workspace')
    const realHome = join(tempDir, 'home')
    const installedVersion = '5.0.0'
    const pluginRoot = resolveManagedPluginPackageInstallDir({
      env: {
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      packageName: '@oneworks/plugin-remote',
      version: installedVersion
    })
    await mkdir(workspace, { recursive: true })

    mocks.manifest.mockResolvedValueOnce({
      dist: {
        integrity: 'sha512-plugin-remote',
        tarball: 'https://registry.example.test/@oneworks/plugin-remote/-/plugin-remote-5.0.0.tgz'
      },
      name: '@oneworks/plugin-remote',
      version: installedVersion
    })
    mocks.Arborist.mockImplementationOnce((options: { path: string }) => ({
      reify: async (reifyOptions: unknown) => {
        await writeLoggerPluginPackage(
          join(options.path, 'node_modules', '@oneworks', 'plugin-remote'),
          installedVersion,
          '@oneworks/plugin-remote'
        )
        return reifyOptions
      }
    }))

    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', realHome)

    const [instance] = await resolveConfiguredPluginInstances({
      cwd: workspace,
      plugins: [{ id: 'remote' }]
    })

    expect(instance).toMatchObject({
      packageId: '@oneworks/plugin-remote',
      resolvedBy: 'managed-package-cache',
      rootDir: pluginRoot
    })
  })

  it('uses an explicit managed plugin version when resolving the global package cache', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'oneworks-plugin-resolver-'))
    tempDirs.push(tempDir)

    const workspace = join(tempDir, 'workspace')
    const realHome = join(tempDir, 'home')
    const pluginRoot = resolveManagedPluginPackageInstallDir({
      env: {
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      },
      packageName: '@oneworks/plugin-logger',
      version: '9.9.9'
    })
    await mkdir(workspace, { recursive: true })
    await writeLoggerPluginPackage(pluginRoot, '9.9.9')

    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', realHome)
    vi.stubEnv('__ONEWORKS_PROJECT_PLUGIN_AUTO_INSTALL__', 'false')

    const [instance] = await resolveConfiguredPluginInstances({
      cwd: workspace,
      plugins: [{ id: 'logger', version: '9.9.9' }]
    })

    expect(instance).toMatchObject({
      packageId: '@oneworks/plugin-logger',
      rootDir: pluginRoot,
      resolvedBy: 'managed-package-cache'
    })
  })

  it('loads directory plugin manifests from plugin json, yaml, yml, and package json files', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'oneworks-plugin-resolver-'))
    tempDirs.push(tempDir)

    const workspace = join(tempDir, 'workspace')
    await mkdir(workspace, { recursive: true })
    const manifestFiles = ['plugin.json', 'plugin.yaml', 'plugin.yml', 'package.json'] as const
    await Promise.all(
      manifestFiles.map((fileName, index) => writeDirectoryPlugin(join(workspace, `plugin-${index}`), fileName))
    )

    const instances = await resolveConfiguredPluginInstances({
      cwd: workspace,
      plugins: manifestFiles.map((_, index) => ({ id: `./plugin-${index}` }))
    })

    expect(instances).toHaveLength(4)
    expect(instances.map(instance => instance.manifest?.plugin?.client?.entry)).toEqual([
      './client/index.js',
      './client/index.js',
      './client/index.js',
      './client/index.js'
    ])
  })

  it('discovers runtime plugins in global, dev, and explicit order without auto-loading project installs', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'oneworks-plugin-resolver-'))
    tempDirs.push(tempDir)

    const workspace = join(tempDir, 'workspace')
    const realHome = join(tempDir, 'home')
    const env = { __ONEWORKS_PROJECT_REAL_HOME__: realHome }
    const globalPlugin = join(realHome, '.oneworks/global/plugins/global')
    const projectPlugin = join(workspace, '.oo/plugins/project')
    const devPlugin = join(workspace, '.oo/plugins.dev/dev')
    const explicitPlugin = join(workspace, 'explicit')
    const managedInstall = getManagedPluginInstallDir(workspace, 'claude', 'managed', env)
    const managedPlugin = join(managedInstall, 'oneworks')
    await Promise.all([
      writeDirectoryPlugin(globalPlugin),
      writeDirectoryPlugin(projectPlugin),
      writeDirectoryPlugin(devPlugin),
      writeDirectoryPlugin(explicitPlugin),
      writeDirectoryPlugin(managedPlugin),
      mkdir(managedInstall, { recursive: true })
    ])
    await writeFile(
      join(managedInstall, '.oneworks-plugin.json'),
      JSON.stringify(
        {
          version: 1,
          adapter: 'claude',
          name: 'managed',
          installedAt: '2026-01-01T00:00:00.000Z',
          source: { type: 'path', path: '/tmp/managed' },
          nativePluginPath: '.',
          oneworksPluginPath: 'oneworks'
        },
        null,
        2
      )
    )

    const config = await resolveRuntimePluginConfig({
      cwd: workspace,
      plugins: [{ id: explicitPlugin }],
      env
    })

    expect(config?.map(plugin => plugin.id)).toEqual([
      globalPlugin,
      devPlugin,
      explicitPlugin
    ])
    expect(config?.map(plugin => plugin.id)).not.toContain(projectPlugin)
    expect(config?.map(plugin => plugin.id)).not.toContain(managedPlugin)
    expect(config?.find(plugin => plugin.id === devPlugin)).toMatchObject({ watch: true })
  })

  it('includes official default plugins only when requested and allows explicit disable', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'oneworks-plugin-resolver-'))
    tempDirs.push(tempDir)

    const workspace = join(tempDir, 'workspace')
    await mkdir(workspace, { recursive: true })

    await expect(resolveRuntimePluginConfig({
      cwd: workspace,
      env: { __ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__: '1' }
    })).resolves.toBeUndefined()

    await expect(resolveRuntimePluginConfig({
      cwd: workspace,
      env: { __ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__: '1' },
      includeDefaultOfficialPlugins: true
    })).resolves.toEqual([
      { id: '@oneworks/plugin-relay' }
    ])

    await expect(resolveRuntimePluginConfig({
      cwd: workspace,
      env: { __ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__: '1' },
      includeDefaultOfficialPlugins: true,
      plugins: [{ id: '@oneworks/plugin-relay', enabled: false }]
    })).resolves.toEqual([
      { id: '@oneworks/plugin-relay', enabled: false }
    ])

    await expect(resolveRuntimePluginConfig({
      cwd: workspace,
      env: {
        __ONEWORKS_PROJECT_DISABLE_DEFAULT_OFFICIAL_PLUGINS__: '1',
        __ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__: '1'
      },
      includeDefaultOfficialPlugins: true
    })).resolves.toBeUndefined()
  })

  it('loads project-home managed plugin install directories only when explicitly configured', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'oneworks-plugin-resolver-'))
    tempDirs.push(tempDir)

    const workspace = join(tempDir, 'workspace')
    const env = {
      __ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__: '1',
      __ONEWORKS_PROJECT_REAL_HOME__: join(tempDir, 'home')
    }
    const managedInstall = getManagedPluginInstallDir(workspace, 'claude', 'managed', env)
    const managedPlugin = join(managedInstall, 'oneworks')
    await Promise.all([
      writeDirectoryPlugin(managedPlugin),
      mkdir(managedInstall, { recursive: true })
    ])
    await writeFile(
      join(managedInstall, '.oneworks-plugin.json'),
      JSON.stringify(
        {
          version: 1,
          adapter: 'claude',
          name: 'managed',
          installedAt: '2026-01-01T00:00:00.000Z',
          source: { type: 'path', path: '/tmp/managed' },
          nativePluginPath: '.',
          oneworksPluginPath: 'oneworks'
        },
        null,
        2
      )
    )

    const config = await resolveRuntimePluginConfig({
      cwd: workspace,
      plugins: [{ id: managedPlugin, scope: 'managed' }],
      env
    })
    const instances = await resolveConfiguredPluginInstances({
      cwd: workspace,
      plugins: config
    })

    expect(config?.map(plugin => plugin.id)).toEqual([managedPlugin])
    expect(instances).toHaveLength(1)
    expect(instances[0]).toMatchObject({
      rootDir: managedPlugin,
      scope: 'managed'
    })
  })

  it('lets explicit config replace an auto-discovered plugin by resolved root even when scope differs', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'oneworks-plugin-resolver-'))
    tempDirs.push(tempDir)

    const workspace = join(tempDir, 'workspace')
    const pluginRoot = join(workspace, '.oo/plugins.dev/demo')
    await writeDirectoryPlugin(pluginRoot)

    const config = await resolveRuntimePluginConfig({
      cwd: workspace,
      plugins: [{ id: pluginRoot, scope: 'custom' }],
      env: { __ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__: '1' }
    })
    const instances = await resolveConfiguredPluginInstances({
      cwd: workspace,
      plugins: config
    })

    expect(instances).toHaveLength(1)
    expect(instances[0]).toMatchObject({
      rootDir: pluginRoot,
      scope: 'custom'
    })
  })

  it('skips global auto-discovery when global config is disabled', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'oneworks-plugin-resolver-'))
    tempDirs.push(tempDir)

    const workspace = join(tempDir, 'workspace')
    const realHome = join(tempDir, 'home')
    const globalPlugin = join(realHome, '.oneworks/global/plugins/global')
    await writeDirectoryPlugin(globalPlugin)

    const discovered = await discoverRuntimePluginConfigs({
      cwd: workspace,
      env: {
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__: '1'
      }
    })

    expect(discovered.autoDiscovered).toEqual([])
  })
})
