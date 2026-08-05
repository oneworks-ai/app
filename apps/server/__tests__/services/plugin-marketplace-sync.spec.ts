import { beforeEach, describe, expect, it, vi } from 'vitest'

import { syncPluginMarketplaceSelection } from '#~/services/plugins/marketplace-sync.js'

const mocks = vi.hoisted(() => ({
  assertUniqueMarketplacePluginScopes: vi.fn(),
  listManagedPluginInstalls: vi.fn(),
  loadConfigState: vi.fn(),
  removeManagedPluginInstall: vi.fn(),
  resolveConfiguredPluginInstances: vi.fn(),
  syncConfiguredMarketplacePlugins: vi.fn()
}))

vi.mock('@oneworks/managed-plugins', () => ({
  assertUniqueMarketplacePluginScopes: mocks.assertUniqueMarketplacePluginScopes,
  removeManagedPluginInstall: mocks.removeManagedPluginInstall,
  syncConfiguredMarketplacePlugins: mocks.syncConfiguredMarketplacePlugins,
  withManagedPluginMutationLock: (_params: unknown, callback: () => Promise<unknown>) => callback()
}))

vi.mock('@oneworks/utils/managed-plugin', () => ({
  listManagedPluginInstalls: mocks.listManagedPluginInstalls
}))

vi.mock('@oneworks/utils/plugin-resolver', () => ({
  resolveConfiguredPluginInstances: mocks.resolveConfiguredPluginInstances
}))

vi.mock('#~/services/config/index.js', () => ({
  loadConfigState: mocks.loadConfigState
}))

describe('plugin marketplace sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.syncConfiguredMarketplacePlugins.mockResolvedValue([])
    mocks.listManagedPluginInstalls.mockResolvedValue([])
    mocks.resolveConfiguredPluginInstances.mockResolvedValue([])
    mocks.removeManagedPluginInstall.mockResolvedValue(undefined)
  })

  it('installs an enabled Codex marketplace plugin immediately', async () => {
    mocks.loadConfigState.mockResolvedValue({
      workspaceFolder: '/workspace',
      mergedConfig: {
        marketplaces: {
          'openai-plugins': {
            type: 'codex',
            plugins: { github: { enabled: true } },
            options: { source: { source: 'github', repo: 'openai/plugins' } }
          }
        }
      }
    })

    await syncPluginMarketplaceSelection({
      enabled: true,
      marketplace: 'openai-plugins',
      plugin: 'github'
    })

    expect(mocks.syncConfiguredMarketplacePlugins).toHaveBeenCalledWith({
      cwd: '/workspace',
      marketplaces: {
        'openai-plugins': expect.objectContaining({ type: 'codex' })
      }
    })
    expect(mocks.assertUniqueMarketplacePluginScopes).toHaveBeenCalledWith(
      expect.objectContaining({ 'openai-plugins': expect.any(Object) })
    )
  })

  it('installs and removes a version-pinned native One Works plugin without deleting the shared cache', async () => {
    mocks.loadConfigState.mockResolvedValue({
      workspaceFolder: '/workspace',
      mergedConfig: {
        marketplaces: {
          'oneworks-official': {
            type: 'oneworks',
            plugins: { '@oneworks/plugin-logger': { enabled: true, scope: 'logs' } }
          }
        }
      }
    })

    await expect(syncPluginMarketplaceSelection({
      enabled: true,
      marketplace: 'oneworks-official',
      plugin: '@oneworks/plugin-logger'
    })).resolves.toEqual([{
      marketplace: 'oneworks-official',
      plugin: '@oneworks/plugin-logger',
      action: 'installed'
    }])
    expect(mocks.resolveConfiguredPluginInstances).toHaveBeenCalledWith({
      cwd: '/workspace',
      plugins: [{
        id: '@oneworks/plugin-logger',
        scope: 'logs',
        version: '0.1.0-rc.7'
      }]
    })

    mocks.loadConfigState.mockResolvedValue({
      workspaceFolder: '/workspace',
      mergedConfig: { marketplaces: { 'oneworks-official': { type: 'oneworks' } } }
    })
    await expect(syncPluginMarketplaceSelection({
      enabled: false,
      marketplace: 'oneworks-official',
      plugin: '@oneworks/plugin-logger'
    })).resolves.toEqual([{
      marketplace: 'oneworks-official',
      plugin: '@oneworks/plugin-logger',
      action: 'removed'
    }])
    expect(mocks.listManagedPluginInstalls).not.toHaveBeenCalled()
  })

  it('removes only the matching managed marketplace install', async () => {
    const workspaceFolder = '/workspace'
    const installDir = '/managed/codex/openai-plugins--github/install'
    mocks.loadConfigState.mockResolvedValue({ workspaceFolder, mergedConfig: {} })
    const install = {
      installDir,
      config: {
        adapter: 'codex',
        source: { type: 'marketplace', marketplace: 'openai-plugins', plugin: 'github' }
      }
    }
    mocks.listManagedPluginInstalls.mockResolvedValue([install])

    const result = await syncPluginMarketplaceSelection({
      enabled: false,
      marketplace: 'openai-plugins',
      plugin: 'github'
    })

    expect(result).toEqual([{
      marketplace: 'openai-plugins',
      plugin: 'github',
      action: 'removed'
    }])
    expect(mocks.removeManagedPluginInstall).toHaveBeenCalledWith({
      cwd: workspaceFolder,
      install
    })
    expect(mocks.listManagedPluginInstalls).toHaveBeenCalledWith(workspaceFolder, { adapter: 'codex' })
  })

  it('keeps the managed install when another config layer still enables the plugin', async () => {
    mocks.loadConfigState.mockResolvedValue({
      workspaceFolder: '/workspace',
      mergedConfig: {
        marketplaces: {
          'openai-plugins': {
            type: 'codex',
            plugins: { github: { enabled: true } }
          }
        }
      }
    })

    await expect(syncPluginMarketplaceSelection({
      enabled: false,
      marketplace: 'openai-plugins',
      plugin: 'github'
    })).resolves.toEqual([{
      marketplace: 'openai-plugins',
      plugin: 'github',
      action: 'skipped'
    }])
    expect(mocks.listManagedPluginInstalls).not.toHaveBeenCalled()
  })
})
