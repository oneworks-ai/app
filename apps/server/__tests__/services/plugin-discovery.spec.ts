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
})
