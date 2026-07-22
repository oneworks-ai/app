import { describe, expect, it } from 'vitest'

import type { PluginMarketplaceCatalogPlugin } from '@oneworks/types'

import {
  commitMarketplaceConfigUpdate,
  createMarketplaceEnabledOverride,
  createMarketplaceSourceEntries,
  filterAndSortMarketplacePlugins,
  interleaveMarketplacePlugins,
  isMarketplacePluginInstallable,
  isPluginInstalledForTarget,
  syncMarketplacePluginsWithCompensation
} from '#~/components/plugins/PluginMarketplaceLanding'

describe('plugin marketplace config overrides', () => {
  it('does not copy inherited source options into a built-in source override', () => {
    expect(createMarketplaceEnabledOverride('codex', undefined, false)).toEqual({
      type: 'codex',
      enabled: false
    })
  })

  it('preserves a One Works marketplace version while toggling its override', () => {
    expect(createMarketplaceEnabledOverride('oneworks', {
      type: 'oneworks',
      options: { version: '0.1.0-beta.7' }
    }, false)).toEqual({
      type: 'oneworks',
      enabled: false,
      options: { version: '0.1.0-beta.7' }
    })
  })

  it('creates separate Codex and Claude entries for a multi-format source', () => {
    expect(createMarketplaceSourceEntries({
      baseKey: 'team-plugins',
      formats: ['claude-code', 'codex'],
      occupied: {
        'team-plugins-claude': {
          type: 'claude-code'
        }
      },
      options: {
        source: {
          source: 'git',
          url: 'https://github.com/acme/plugins.git'
        }
      }
    })).toEqual({
      'team-plugins-claude-2': {
        type: 'claude-code',
        enabled: true,
        options: {
          source: {
            source: 'git',
            url: 'https://github.com/acme/plugins.git'
          }
        }
      },
      'team-plugins-codex': {
        type: 'codex',
        enabled: true,
        options: {
          source: {
            source: 'git',
            url: 'https://github.com/acme/plugins.git'
          }
        }
      }
    })
  })

  it('combines marketplace filters and name sorting', () => {
    const plugins: PluginMarketplaceCatalogPlugin[] = [
      {
        builtIn: true,
        declared: true,
        enabled: true,
        marketplace: 'openai-plugins',
        marketplaceEnabled: true,
        marketplaceType: 'codex',
        name: 'zeta',
        sourceLabel: './plugins/zeta',
        sourceType: 'path'
      },
      {
        configSource: 'user',
        declared: false,
        description: 'Review pull requests',
        enabled: false,
        marketplace: 'team-tools',
        marketplaceEnabled: true,
        marketplaceType: 'claude-code',
        name: 'alpha',
        sourceLabel: 'acme/alpha',
        sourceType: 'github'
      }
    ]

    expect(
      filterAndSortMarketplacePlugins(plugins, {
        format: 'claude-code',
        marketplace: 'team-tools',
        query: 'review',
        sort: 'nameDesc',
        source: 'user',
        status: 'disabled'
      }).map(plugin => plugin.name)
    ).toEqual(['alpha'])

    expect(
      filterAndSortMarketplacePlugins(plugins, {
        format: 'all',
        marketplace: '',
        query: '',
        sort: 'nameAsc',
        source: 'all',
        status: 'all'
      }).map(plugin => plugin.name)
    ).toEqual(['alpha', 'zeta'])

    expect(
      filterAndSortMarketplacePlugins([
        { ...plugins[1]!, marketplace: 'all' }
      ], {
        format: 'all',
        marketplace: 'all',
        query: '',
        sort: 'default',
        source: 'all',
        status: 'all'
      }).map(plugin => plugin.name)
    ).toEqual(['alpha'])
  })

  it('matches marketplace display names and localized search keywords', () => {
    const plugin = {
      declared: false,
      displayName: 'China Edition Theme',
      enabled: false,
      marketplace: 'oneworks-official',
      marketplaceEnabled: true,
      marketplaceType: 'oneworks',
      name: '@oneworks/plugin-china-red-theme',
      searchKeywords: ['中国方案主题'],
      sourceLabel: '@oneworks/plugin-china-red-theme@0.1.0-beta.7',
      sourceType: 'npm'
    } satisfies PluginMarketplaceCatalogPlugin
    const search = (query: string) =>
      filterAndSortMarketplacePlugins([plugin], {
        format: 'all',
        marketplace: '',
        query,
        sort: 'default',
        source: 'all',
        status: 'all'
      })

    expect(search('China Edition Theme')).toEqual([plugin])
    expect(search('中国方案主题')).toEqual([plugin])
  })

  it('interleaves marketplaces for the default order while preserving each marketplace order', () => {
    const createPlugin = (marketplace: string, name: string): PluginMarketplaceCatalogPlugin => ({
      declared: true,
      enabled: false,
      marketplace,
      marketplaceEnabled: true,
      marketplaceType: marketplace === 'openai-plugins' ? 'codex' : 'claude-code',
      name,
      sourceLabel: name,
      sourceType: 'path'
    })
    const plugins = [
      createPlugin('claude-plugins-official', 'alpha'),
      createPlugin('claude-plugins-official', 'bravo'),
      createPlugin('claude-plugins-official', 'charlie'),
      createPlugin('openai-plugins', 'actively'),
      createPlugin('openai-plugins', 'base44')
    ]

    expect(interleaveMarketplacePlugins(plugins).map(plugin => plugin.name)).toEqual([
      'alpha',
      'actively',
      'bravo',
      'base44',
      'charlie'
    ])

    expect(
      filterAndSortMarketplacePlugins(plugins, {
        format: 'all',
        marketplace: '',
        query: '',
        sort: 'default',
        source: 'all',
        status: 'all'
      }).map(plugin => plugin.name)
    ).toEqual(['alpha', 'actively', 'bravo', 'base44', 'charlie'])
  })

  it('preserves only an existing override with the same marketplace type', () => {
    expect(createMarketplaceEnabledOverride('claude-code', {
      type: 'claude-code',
      plugins: { reviewer: { scope: 'review' } }
    }, true)).toEqual({
      type: 'claude-code',
      enabled: true,
      plugins: { reviewer: { scope: 'review' } }
    })

    expect(createMarketplaceEnabledOverride('codex', {
      type: 'claude-code',
      options: { source: { source: 'directory', path: '/inherited' } }
    }, true)).toEqual({
      type: 'codex',
      enabled: true
    })
  })

  it('treats legacy user declarations as project installs', () => {
    const plugin = {
      declared: true,
      enabled: true,
      installedSources: ['user'],
      marketplace: 'openai-plugins',
      marketplaceEnabled: true,
      marketplaceType: 'codex',
      name: 'demo',
      sourceLabel: './plugins/demo',
      sourceType: 'path'
    } satisfies PluginMarketplaceCatalogPlugin

    expect(isPluginInstalledForTarget(plugin, 'project')).toBe(true)
    expect(isPluginInstalledForTarget(plugin, 'global')).toBe(false)
  })

  it('blocks unavailable or disabled marketplace entries from every install surface', () => {
    const plugin = {
      declared: false,
      enabled: false,
      marketplace: 'openai-curated-remote',
      marketplaceEnabled: true,
      marketplaceType: 'codex',
      name: 'figma',
      sourceLabel: 'figma',
      sourceType: 'remote'
    } satisfies PluginMarketplaceCatalogPlugin

    expect(isMarketplacePluginInstallable(plugin)).toBe(true)
    expect(isMarketplacePluginInstallable({ ...plugin, installable: false })).toBe(false)
    expect(isMarketplacePluginInstallable({ ...plugin, marketplaceEnabled: false })).toBe(false)
  })

  it('continues after a committed config write when cache refresh fails', async () => {
    const calls: string[] = []
    await expect(commitMarketplaceConfigUpdate(
      async () => calls.push('update'),
      async () => {
        calls.push('refresh')
        throw new Error('offline')
      }
    )).resolves.toBeUndefined()
    expect(calls).toEqual(['update', 'refresh'])
  })

  it('compensates completed plugin operations in reverse order', async () => {
    const calls: string[] = []
    await expect(syncMarketplacePluginsWithCompensation({
      enabled: true,
      marketplace: 'team-tools',
      plugins: ['first', 'second'],
      sync: async (_marketplace, plugin, enabled) => {
        calls.push(`${plugin}:${enabled}`)
        if (plugin === 'second' && enabled) throw new Error('install failed')
      }
    })).rejects.toThrow('install failed')
    expect(calls).toEqual(['first:true', 'second:true', 'first:false'])
  })
})
