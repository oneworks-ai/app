import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolvePluginMarketplaceVersions } from '#~/services/plugins/marketplace-version-resolver.js'
import { listPluginMarketplaceCatalog } from '#~/services/plugins/marketplace.js'

const mocks = vi.hoisted(() => ({
  loadCodexMarketplaceCatalogFromSource: vi.fn(),
  loadConfigState: vi.fn(),
  loadMarketplaceCatalogFromSource: vi.fn()
}))

vi.mock('@oneworks/adapter-claude-code/plugins', () => ({
  CLAUDE_CODE_BUILT_IN_PLUGIN_MARKETPLACES: {
    'claude-plugins-official': {
      type: 'claude-code',
      options: { source: { source: 'github', repo: 'anthropics/claude-plugins-official' } }
    }
  },
  loadMarketplaceCatalogFromSource: mocks.loadMarketplaceCatalogFromSource
}))

vi.mock('@oneworks/adapter-codex/plugins', () => ({
  CODEX_BUILT_IN_PLUGIN_MARKETPLACES: {
    'openai-curated-remote': {
      type: 'codex',
      options: {
        source: {
          source: 'app-server',
          marketplace: 'openai-curated-remote',
          includeRemoteCatalog: true
        }
      }
    }
  },
  loadCodexMarketplaceCatalogFromSource: mocks.loadCodexMarketplaceCatalogFromSource
}))

vi.mock('@oneworks/managed-plugins', () => ({
  installManagedPluginSource: vi.fn()
}))

vi.mock('#~/services/config/index.js', () => ({
  loadConfigState: mocks.loadConfigState
}))

describe('plugin marketplace catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadMarketplaceCatalogFromSource.mockResolvedValue({
      catalog: {
        name: 'Claude catalog',
        plugins: [{ name: 'demo', source: { source: 'github', repo: 'acme/demo' } }]
      }
    })
    mocks.loadCodexMarketplaceCatalogFromSource.mockResolvedValue({
      catalog: {
        name: 'Codex catalog',
        plugins: [{ name: 'demo', source: { source: 'local', path: './plugins/demo' } }]
      },
      rootDir: '/tmp/catalog'
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('attributes global, raw project, and user marketplace declarations to their actual layers', async () => {
    const globalEntry = {
      type: 'claude-code' as const,
      options: { source: { source: 'directory' as const, path: '/global' } }
    }
    const projectEntry = {
      type: 'claude-code' as const,
      options: { source: { source: 'directory' as const, path: '/project' } }
    }
    const userEntry = {
      type: 'claude-code' as const,
      options: { source: { source: 'directory' as const, path: '/user' } }
    }
    mocks.loadConfigState.mockResolvedValue({
      globalSource: {
        rawConfig: { marketplaces: { global: globalEntry } },
        resolvedConfig: { marketplaces: { global: globalEntry } }
      },
      projectConfig: {
        marketplaces: {
          global: globalEntry,
          project: projectEntry
        }
      },
      projectSource: { resolvedConfig: { marketplaces: { project: projectEntry } } },
      userSource: {
        rawConfig: { marketplaces: { user: userEntry } },
        resolvedConfig: { marketplaces: { user: userEntry } }
      },
      mergedConfig: {
        marketplaces: {
          global: globalEntry,
          project: projectEntry,
          user: userEntry
        }
      },
      workspaceFolder: '/workspace'
    })

    const response = await listPluginMarketplaceCatalog()
    const byKey = new Map(response.sources.map(source => [source.key, source]))

    expect(byKey.get('global')?.configSource).toBe('global')
    expect(byKey.get('project')?.configSource).toBe('project')
    expect(byKey.get('user')?.configSource).toBe('user')
  })

  it('includes the version-pinned official One Works plugin catalog', async () => {
    mocks.loadConfigState.mockResolvedValue({
      mergedConfig: {},
      workspaceFolder: '/workspace'
    })

    const response = await listPluginMarketplaceCatalog()
    const official = response.plugins.filter(plugin => plugin.marketplace === 'oneworks-official')

    expect(response.sources).toContainEqual(expect.objectContaining({
      builtIn: true,
      key: 'oneworks-official',
      pluginCount: 14,
      title: 'One Works',
      type: 'oneworks'
    }))
    expect(official).toHaveLength(14)
    expect(official).toContainEqual(expect.objectContaining({
      displayName: 'Logger',
      marketplaceType: 'oneworks',
      name: '@oneworks/plugin-logger',
      sourceLabel: '@oneworks/plugin-logger@0.1.0-beta.7',
      sourceType: 'npm',
      version: '0.1.0-beta.7'
    }))
    expect(official).toContainEqual(expect.objectContaining({
      displayName: 'China Edition Theme',
      name: '@oneworks/plugin-china-red-theme',
      searchKeywords: ['中国方案主题']
    }))
  })

  it('reports every config layer that enables a marketplace plugin', async () => {
    const marketplace = {
      type: 'claude-code' as const,
      options: { source: { source: 'directory' as const, path: '/plugins' } },
      plugins: { demo: { enabled: true } }
    }
    mocks.loadConfigState.mockResolvedValue({
      globalSource: { resolvedConfig: { marketplaces: { shared: marketplace } } },
      projectSource: { resolvedConfig: { marketplaces: { shared: marketplace } } },
      userSource: {
        resolvedConfig: {
          marketplaces: {
            shared: {
              ...marketplace,
              plugins: { demo: { enabled: false } }
            }
          }
        }
      },
      mergedConfig: { marketplaces: { shared: marketplace } },
      workspaceFolder: '/workspace'
    })

    const response = await listPluginMarketplaceCatalog()
    expect(response.plugins.find(plugin => plugin.marketplace === 'shared')).toEqual(
      expect.objectContaining({
        name: 'demo',
        installedSources: ['global', 'project']
      })
    )
  })

  it('resolves a missing external plugin version from its pinned manifest', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ version: '1.0.2' }),
      ok: true
    })
    vi.stubGlobal('fetch', fetchMock)
    mocks.loadMarketplaceCatalogFromSource.mockResolvedValue({
      catalog: {
        name: 'Claude catalog',
        plugins: [{
          name: 'adobe-for-creativity',
          source: {
            source: 'git-subdir',
            url: 'https://github.com/adobe/skills.git',
            path: 'plugins/creative-cloud/adobe-for-creativity',
            ref: 'main',
            sha: 'manifest-version-test-sha'
          }
        }]
      }
    })
    const marketplace = {
      type: 'claude-code' as const,
      options: { source: { source: 'directory' as const, path: '/plugins' } }
    }
    mocks.loadConfigState.mockResolvedValue({
      mergedConfig: { marketplaces: { shared: marketplace } },
      workspaceFolder: '/workspace'
    })

    const response = await listPluginMarketplaceCatalog()
    await expect(resolvePluginMarketplaceVersions(response.versionGeneration, [
      { marketplace: 'shared', plugin: 'adobe-for-creativity' },
      { marketplace: 'shared', plugin: 'adobe-for-creativity' }
    ])).resolves.toEqual({
      found: true,
      retryable: [],
      versions: [{ marketplace: 'shared', plugin: 'adobe-for-creativity', version: '1.0.2' }]
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/adobe/skills/manifest-version-test-sha/plugins/creative-cloud/adobe-for-creativity/.claude-plugin/plugin.json',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('retries a manifest lookup after a transient failure instead of caching the failure', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce({ json: async () => ({ version: '2.0.0' }), ok: true })
    vi.stubGlobal('fetch', fetchMock)
    mocks.loadMarketplaceCatalogFromSource.mockResolvedValue({
      catalog: {
        plugins: [{
          name: 'retryable',
          source: { source: 'github', repo: 'acme/retryable', sha: 'retry-version-test-sha' }
        }]
      }
    })
    const marketplace = {
      type: 'claude-code' as const,
      options: { source: { source: 'directory' as const, path: '/plugins' } }
    }
    mocks.loadConfigState.mockResolvedValue({
      mergedConfig: { marketplaces: { shared: marketplace } },
      workspaceFolder: '/workspace'
    })

    const response = await listPluginMarketplaceCatalog()
    await expect(resolvePluginMarketplaceVersions(response.versionGeneration, [
      { marketplace: 'shared', plugin: 'retryable' }
    ])).resolves.toEqual({
      found: true,
      retryable: [{ marketplace: 'shared', plugin: 'retryable' }],
      versions: []
    })
    await expect(resolvePluginMarketplaceVersions(response.versionGeneration, [
      { marketplace: 'shared', plugin: 'retryable' }
    ])).resolves.toEqual({
      found: true,
      retryable: [],
      versions: [{ marketplace: 'shared', plugin: 'retryable', version: '2.0.0' }]
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
