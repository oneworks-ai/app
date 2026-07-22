import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  setPluginMarketplaceSelection,
  updateMarketplacePluginDeclaration
} from '#~/services/plugins/marketplace-selection.js'

const mocks = vi.hoisted(() => ({
  loadConfigState: vi.fn(),
  syncPluginMarketplaceSelection: vi.fn(),
  updateConfigFile: vi.fn()
}))

vi.mock('@oneworks/config', () => ({
  updateConfigFile: mocks.updateConfigFile
}))

vi.mock('#~/services/config/index.js', () => ({
  loadConfigState: mocks.loadConfigState
}))

vi.mock('#~/services/plugins/marketplace-sync.js', () => ({
  syncPluginMarketplaceSelection: mocks.syncPluginMarketplaceSelection
}))

describe('plugin marketplace selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updateConfigFile.mockResolvedValue({ configPath: '/config' })
    mocks.syncPluginMarketplaceSelection.mockResolvedValue([])
  })

  it('preserves marketplace configuration while updating one plugin declaration', () => {
    const marketplaces = {
      team: {
        type: 'codex' as const,
        syncOnRun: true,
        options: { source: { source: 'github' as const, repo: 'acme/plugins' } },
        plugins: { existing: { scope: 'custom' } }
      }
    }
    expect(updateMarketplacePluginDeclaration({
      enabled: true,
      marketplaceKey: 'team',
      marketplaceType: 'codex',
      marketplaces,
      pluginName: 'demo'
    })).toEqual({
      team: {
        ...marketplaces.team,
        plugins: {
          existing: { scope: 'custom' },
          demo: { enabled: true }
        }
      }
    })
  })

  it('pins official One Works selections and removes the empty override on uninstall', () => {
    const baseEntry = {
      type: 'oneworks' as const,
      options: { version: '0.1.0-beta.7' }
    }
    const installed = updateMarketplacePluginDeclaration({
      baseEntry,
      enabled: true,
      marketplaceKey: 'oneworks-official',
      marketplaceType: 'oneworks',
      marketplaces: { 'oneworks-official': { type: 'oneworks' } },
      pluginName: '@oneworks/plugin-logger'
    })

    expect(installed).toEqual({
      'oneworks-official': {
        type: 'oneworks',
        options: { version: '0.1.0-beta.7' },
        plugins: { '@oneworks/plugin-logger': { enabled: true } }
      }
    })
    expect(updateMarketplacePluginDeclaration({
      baseEntry,
      enabled: false,
      marketplaceKey: 'oneworks-official',
      marketplaceType: 'oneworks',
      marketplaces: installed,
      pluginName: '@oneworks/plugin-logger'
    })).toEqual({})
  })

  it('rejects packages outside the official One Works catalog before writing config', async () => {
    mocks.loadConfigState.mockResolvedValue({
      workspaceFolder: '/workspace',
      mergedConfig: {
        marketplaces: {
          'oneworks-official': { type: 'oneworks' }
        }
      }
    })

    await expect(setPluginMarketplaceSelection({
      enabled: true,
      marketplace: 'oneworks-official',
      plugin: '@oneworks/plugin-not-published',
      target: 'project'
    })).rejects.toThrow('not in the official One Works marketplace')
    expect(mocks.updateConfigFile).not.toHaveBeenCalled()
  })

  it('writes project scope and removes a legacy user declaration without dropping sibling config', async () => {
    const state = {
      workspaceFolder: '/workspace',
      mergedConfig: {
        marketplaces: {
          'openai-plugins': {
            type: 'codex',
            plugins: { actively: { enabled: true } }
          }
        }
      },
      projectSource: {
        rawConfig: {
          plugins: [{ id: 'existing-runtime-plugin' }],
          marketplaces: {
            'openai-plugins': {
              type: 'codex',
              plugins: { aiera: { enabled: true } }
            }
          }
        }
      },
      userSource: {
        rawConfig: {
          marketplaces: {
            'openai-plugins': {
              type: 'codex',
              plugins: { actively: { enabled: true } }
            }
          }
        }
      }
    }
    mocks.loadConfigState.mockResolvedValue(state)

    await setPluginMarketplaceSelection({
      enabled: true,
      marketplace: 'openai-plugins',
      plugin: 'actively',
      target: 'project'
    })

    expect(mocks.updateConfigFile).toHaveBeenNthCalledWith(1, {
      workspaceFolder: '/workspace',
      source: 'project',
      section: 'plugins',
      value: {
        plugins: [{ id: 'existing-runtime-plugin' }],
        marketplaces: {
          'openai-plugins': {
            type: 'codex',
            plugins: {
              aiera: { enabled: true },
              actively: { enabled: true }
            }
          }
        }
      }
    })
    expect(mocks.updateConfigFile).toHaveBeenNthCalledWith(2, {
      workspaceFolder: '/workspace',
      source: 'user',
      section: 'plugins',
      value: { marketplaces: {} }
    })
    expect(mocks.syncPluginMarketplaceSelection).toHaveBeenCalledWith({
      enabled: true,
      marketplace: 'openai-plugins',
      plugin: 'actively'
    })
  })

  it('copies custom source options when promoting a project marketplace to global scope', async () => {
    const state = {
      workspaceFolder: '/workspace',
      mergedConfig: {
        marketplaces: {
          team: {
            type: 'claude-code',
            options: { source: { source: 'github', repo: 'acme/team-plugins' } },
            plugins: { reviewer: { enabled: true } }
          }
        }
      }
    }
    mocks.loadConfigState.mockResolvedValue(state)

    await setPluginMarketplaceSelection({
      enabled: true,
      marketplace: 'team',
      plugin: 'reviewer',
      target: 'global'
    })

    expect(mocks.updateConfigFile).toHaveBeenCalledWith({
      workspaceFolder: '/workspace',
      source: 'global',
      section: 'plugins',
      value: {
        marketplaces: {
          team: {
            type: 'claude-code',
            options: { source: { source: 'github', repo: 'acme/team-plugins' } },
            plugins: { reviewer: { enabled: true } }
          }
        }
      }
    })
  })
})
