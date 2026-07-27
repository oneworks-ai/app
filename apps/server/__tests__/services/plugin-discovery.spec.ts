import { beforeEach, describe, expect, it, vi } from 'vitest'

import { discoverPluginInstances } from '#~/services/plugins/discovery.js'

const mocks = vi.hoisted(() => ({
  listManagedPluginInstalls: vi.fn(),
  loadConfigState: vi.fn(),
  resolveConfiguredPluginInstances: vi.fn(),
  resolveRuntimePluginConfig: vi.fn()
}))

vi.mock('@oneworks/utils', () => ({
  listManagedPluginInstalls: mocks.listManagedPluginInstalls,
  resolveGlobalOneWorksAssetsPath: () => '/home/.oneworks/global/plugins',
  resolveProjectHomePath: () => '/workspace/.oo',
  resolveProjectOoPath: () => '/workspace/.oo/plugins.dev'
}))

vi.mock('@oneworks/utils/plugin-resolver', () => ({
  resolveConfiguredPluginInstances: mocks.resolveConfiguredPluginInstances,
  resolveRuntimePluginConfig: mocks.resolveRuntimePluginConfig
}))

vi.mock('#~/services/config/index.js', () => ({
  buildConfigJsonVariables: () => ({}),
  loadConfigState: mocks.loadConfigState
}))

describe('plugin discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listManagedPluginInstalls.mockResolvedValue([])
    mocks.resolveConfiguredPluginInstances.mockResolvedValue([])
    mocks.resolveRuntimePluginConfig.mockResolvedValue([])
  })

  it('loads Relay through the default official plugin set', async () => {
    mocks.loadConfigState.mockResolvedValue({
      globalConfig: {},
      mergedConfig: {},
      workspaceFolder: '/workspace'
    })

    await discoverPluginInstances()

    expect(mocks.resolveRuntimePluginConfig).toHaveBeenCalledWith(expect.objectContaining({
      includeDefaultOfficialPlugins: true
    }))
  })

  it('attributes an official package selected by the project marketplace to the project', async () => {
    const marketplace = {
      type: 'oneworks' as const,
      plugins: { '@oneworks/plugin-logger': { enabled: true } }
    }
    mocks.loadConfigState.mockResolvedValue({
      globalConfig: {},
      mergedConfig: { marketplaces: { 'oneworks-official': marketplace } },
      projectSource: { resolvedConfig: { marketplaces: { 'oneworks-official': marketplace } } },
      workspaceFolder: '/workspace'
    })
    mocks.resolveConfiguredPluginInstances.mockResolvedValue([{
      children: [],
      packageId: '@oneworks/plugin-logger',
      requestId: '@oneworks/plugin-logger',
      rootDir: '/cache/logger',
      scope: '@oneworks/plugin-logger',
      sourceType: 'package'
    }])

    const result = await discoverPluginInstances()

    expect(result.instances[0]?.sourceGroup).toBe('project')
  })

  it.each([
    '@oneworks/plugin-browser-driver',
    '@oneworks/plugin-chrome-driver',
    '@oneworks/plugin-cua-driver'
  ])('attributes the default bundled package %s to the host', async (packageId) => {
    mocks.loadConfigState.mockResolvedValue({
      globalConfig: {},
      mergedConfig: {},
      workspaceFolder: '/workspace'
    })
    mocks.resolveConfiguredPluginInstances.mockResolvedValue([{
      children: [],
      packageId,
      requestId: packageId,
      rootDir: `/cache/${packageId}`,
      scope: packageId,
      sourceType: 'package'
    }])

    const result = await discoverPluginInstances()

    expect(result.instances[0]?.sourceGroup).toBe('builtIn')
  })

  it('attributes an explicit project override before a global marketplace declaration', async () => {
    const marketplace = {
      type: 'oneworks' as const,
      plugins: { '@oneworks/plugin-logger': { enabled: true } }
    }
    mocks.loadConfigState.mockResolvedValue({
      globalConfig: {},
      globalSource: { resolvedConfig: { marketplaces: { 'oneworks-official': marketplace } } },
      mergedConfig: {
        marketplaces: { 'oneworks-official': marketplace },
        plugins: [{ id: '@oneworks/plugin-logger', scope: 'logs' }]
      },
      projectSource: {
        resolvedConfig: { plugins: [{ id: '@oneworks/plugin-logger', scope: 'logs' }] }
      },
      workspaceFolder: '/workspace'
    })
    mocks.resolveConfiguredPluginInstances.mockResolvedValue([{
      children: [],
      packageId: '@oneworks/plugin-logger',
      requestId: '@oneworks/plugin-logger',
      rootDir: '/cache/logger',
      scope: 'logs',
      sourceType: 'package'
    }])

    const result = await discoverPluginInstances()

    expect(result.instances[0]?.sourceGroup).toBe('project')
  })

  it('returns marketplace-managed plugin roots so runtime source compilation can exclude them', async () => {
    const managedPluginRoot = '/workspace/.oo/.local/plugins/codex/theme/current/oneworks'
    const marketplace = {
      type: 'oneworks' as const,
      plugins: { '@example/theme': { enabled: true } }
    }
    mocks.loadConfigState.mockResolvedValue({
      globalConfig: {},
      mergedConfig: { marketplaces: { project: marketplace } },
      projectSource: { resolvedConfig: { marketplaces: { project: marketplace } } },
      workspaceFolder: '/workspace'
    })
    mocks.listManagedPluginInstalls.mockResolvedValue([{
      config: {
        source: {
          type: 'marketplace',
          marketplace: 'project',
          plugin: '@example/theme'
        }
      },
      oneworksPluginDir: managedPluginRoot
    }])
    mocks.resolveConfiguredPluginInstances.mockResolvedValue([{
      children: [],
      requestId: '@example/theme',
      rootDir: managedPluginRoot,
      scope: 'theme',
      sourceType: 'directory'
    }])

    const result = await discoverPluginInstances()

    expect(result.managedPluginRoots).toEqual([managedPluginRoot])
    expect(result.instances[0]?.sourceGroup).toBe('project')
  })
})
