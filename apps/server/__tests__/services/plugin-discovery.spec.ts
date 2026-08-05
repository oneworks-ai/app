import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveManagedPluginScope } from '@oneworks/utils'

import { discoverPluginInstances } from '#~/services/plugins/discovery.js'

const mocks = vi.hoisted(() => ({
  listManagedPluginInstalls: vi.fn(),
  loadConfigState: vi.fn(),
  resolveConfiguredPluginInstances: vi.fn(),
  resolveRuntimePluginConfig: vi.fn()
}))

vi.mock('@oneworks/utils', async importOriginal => ({
  ...await importOriginal<typeof import('@oneworks/utils')>(),
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

  it('keeps the repository defaults focused on production plugins and presets', async () => {
    const configPath = resolve(process.cwd(), '.oo.config.json')
    const config = JSON.parse(await readFile(configPath, 'utf8')) as {
      conversation?: { startupPresets?: Array<{ target?: string }> }
      plugins?: Array<{ children?: Array<{ id?: string; scope?: string }>; id?: string; scope?: string }>
    }
    const configuredPlugins = (config.plugins ?? []).flatMap(plugin => [
      { id: plugin.id, scope: plugin.scope },
      ...(plugin.children ?? []).map(child => ({ id: child.id, scope: child.scope }))
    ])

    expect(configuredPlugins).toEqual(expect.arrayContaining([
      { id: './packages/plugins/browser-driver', scope: 'browser' },
      { id: './packages/plugins/cua-driver', scope: 'cua' },
      { id: './packages/plugins/external-browser-driver', scope: 'chrome' }
    ]))
    const configuredPluginIds = configuredPlugins.map(plugin => plugin.id)
    expect(configuredPluginIds).not.toContain('./packages/plugins/demo')
    expect(configuredPluginIds).not.toContain('./packages/plugins/demo-extension')
    expect(configuredPluginIds).not.toContain('standard-dev')
    expect(configuredPlugins.map(plugin => plugin.scope)).not.toContain('std')
    expect(config.conversation?.startupPresets ?? []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ target: expect.stringMatching(/^std\//) })
    ]))
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
    '@oneworks/plugin-external-browser-driver',
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

  it.each([
    '@oneworks/plugin-demo',
    '@oneworks/plugin-demo-extension'
  ])('does not attribute the optional package %s to the host', async (packageId) => {
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

  it('returns marketplace-managed plugin roots so runtime source compilation can exclude them', async () => {
    const managedPluginRoot = '/workspace/.oo/.local/plugins/codex/theme/current/oneworks'
    const managedSource = {
      type: 'marketplace' as const,
      marketplace: 'project',
      plugin: '@example/theme'
    }
    const expectedScope = resolveManagedPluginScope({
      adapter: 'codex',
      name: '@example/theme',
      source: managedSource
    })
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
        adapter: 'codex',
        name: '@example/theme',
        source: managedSource
      },
      installDir: '/workspace/.oo/.local/plugins/codex/theme/current',
      nativePluginDir: '/workspace/.oo/.local/plugins/codex/theme/current/native',
      oneworksPluginDir: managedPluginRoot
    }])
    mocks.resolveConfiguredPluginInstances.mockResolvedValue([{
      children: [],
      requestId: '@example/theme',
      rootDir: managedPluginRoot,
      scope: 'configured-theme',
      sourceType: 'directory'
    }])

    const result = await discoverPluginInstances()

    expect(result.managedPluginRoots).toEqual([managedPluginRoot])
    expect(result.managedRuntimeIdentities.get(managedPluginRoot)).toEqual({
      name: '@example/theme',
      packageId: '@example/theme@project',
      requestId: '@example/theme@project',
      scope: expectedScope,
      source: {
        adapter: 'codex',
        kind: 'marketplace',
        marketplace: 'project',
        plugin: '@example/theme'
      }
    })
    expect(result.instances[0]?.sourceGroup).toBe('project')
  })

  it('preserves a safe npm package spec as the managed public identity', async () => {
    const managedPluginRoot = '/workspace/.oo/.local/plugins/codex/npm/current/oneworks'
    const managedSource = {
      spec: '@example/codex-plugin@2.3.4',
      type: 'npm' as const
    }
    const expectedScope = resolveManagedPluginScope({
      adapter: 'codex',
      name: '@example/codex-plugin',
      source: managedSource
    })
    mocks.loadConfigState.mockResolvedValue({
      globalConfig: {},
      mergedConfig: {},
      workspaceFolder: '/workspace'
    })
    mocks.listManagedPluginInstalls.mockResolvedValue([{
      config: {
        adapter: 'codex',
        name: '@example/codex-plugin',
        source: managedSource
      },
      installDir: '/workspace/.oo/.local/plugins/codex/npm/current',
      nativePluginDir: '/workspace/.oo/.local/plugins/codex/npm/current/native',
      oneworksPluginDir: managedPluginRoot
    }])
    mocks.resolveConfiguredPluginInstances.mockResolvedValue([{
      children: [],
      requestId: managedPluginRoot,
      rootDir: managedPluginRoot,
      scope: 'configured-scope',
      sourceType: 'directory'
    }])

    const result = await discoverPluginInstances()

    expect(result.managedRuntimeIdentities.get(managedPluginRoot)).toEqual({
      name: '@example/codex-plugin',
      packageId: '@example/codex-plugin@2.3.4',
      requestId: '@example/codex-plugin@2.3.4',
      scope: expectedScope,
      source: {
        adapter: 'codex',
        kind: 'package',
        plugin: '@example/codex-plugin@2.3.4'
      }
    })
  })
})
