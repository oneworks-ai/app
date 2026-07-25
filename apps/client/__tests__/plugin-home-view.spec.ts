import { describe, expect, it } from 'vitest'

import type { PluginMarketplaceCatalogPlugin } from '@oneworks/types'

import {
  groupRecommendedMarketplacePlugins,
  selectRecommendedMarketplacePlugins
} from '#~/components/plugins/plugin-recommendations'
import {
  createMarketplacePluginRouteKey,
  resolveMarketplacePluginRouteKey,
  resolvePluginLocation
} from '#~/routes/plugin-routes'

const createPlugin = (
  name: string,
  overrides: Partial<PluginMarketplaceCatalogPlugin> = {}
): PluginMarketplaceCatalogPlugin => ({
  builtIn: true,
  declared: false,
  enabled: false,
  marketplace: 'official',
  marketplaceEnabled: true,
  marketplaceType: 'codex',
  name,
  sourceLabel: `./plugins/${name}`,
  sourceType: 'path',
  ...overrides
})

describe('selectRecommendedMarketplacePlugins', () => {
  it('keeps only available built-in plugins that are not installed', () => {
    expect(
      selectRecommendedMarketplacePlugins([
        createPlugin('available'),
        createPlugin('installed', { installedSources: ['global'] }),
        createPlugin('custom', { builtIn: false }),
        createPlugin('disabled-source', { marketplaceEnabled: false })
      ]).map(plugin => plugin.name)
    ).toEqual(['available'])
  })

  it('respects the homepage display limit', () => {
    const plugins = Array.from({ length: 12 }, (_, index) => createPlugin(`plugin-${index}`))
    expect(selectRecommendedMarketplacePlugins(plugins)).toHaveLength(10)
  })

  it('keeps OpenAI plugins while ordering featured entries before ordinary entries', () => {
    expect(
      selectRecommendedMarketplacePlugins([
        createPlugin('ordinary'),
        createPlugin('notion', {
          featured: true,
          marketplace: 'openai-curated-remote',
          nativeInstalled: false
        }),
        createPlugin('figma', {
          featured: true,
          marketplace: 'openai-curated-remote',
          nativeInstalled: true
        })
      ]).map(plugin => plugin.name)
    ).toEqual(['notion', 'ordinary'])
  })

  it('falls back to available plugins when every featured plugin is already installed', () => {
    expect(
      selectRecommendedMarketplacePlugins([
        createPlugin('ordinary'),
        createPlugin('figma', {
          featured: true,
          marketplace: 'openai-curated-remote',
          nativeInstalled: true
        })
      ]).map(plugin => plugin.name)
    ).toEqual(['ordinary'])
  })

  it('prioritizes featured One Works plugins before external recommendations', () => {
    expect(
      selectRecommendedMarketplacePlugins([
        createPlugin('ordinary-openai', {
          marketplace: 'openai-curated-remote'
        }),
        createPlugin('figma', {
          featured: true,
          marketplace: 'openai-curated-remote'
        }),
        createPlugin('@oneworks/plugin-cua-driver', {
          category: 'automation',
          featured: true,
          marketplace: 'oneworks-official',
          marketplaceType: 'oneworks'
        }),
        createPlugin('@oneworks/plugin-demo', {
          category: 'developer-tools',
          featured: true,
          marketplace: 'oneworks-official',
          marketplaceType: 'oneworks'
        }),
        createPlugin('@oneworks/plugin-logger', {
          marketplace: 'oneworks-official',
          marketplaceType: 'oneworks'
        })
      ]).map(plugin => plugin.name)
    ).toEqual([
      '@oneworks/plugin-cua-driver',
      '@oneworks/plugin-demo',
      'figma',
      'ordinary-openai',
      '@oneworks/plugin-logger'
    ])
  })
})

describe('groupRecommendedMarketplacePlugins', () => {
  it('groups recommendations by category in a stable product order', () => {
    const groups = groupRecommendedMarketplacePlugins([
      createPlugin('figma', { displayName: 'Figma' }),
      createPlugin('@oneworks/plugin-china-red-theme', { category: 'themes' }),
      createPlugin('data-analytics', { category: 'Data & Analytics' }),
      createPlugin('@oneworks/plugin-demo', { category: 'developer-tools' }),
      createPlugin('@oneworks/plugin-cua-driver', { category: 'automation' })
    ])

    expect(groups.map(group => ({
      category: group.category,
      plugins: group.plugins.map(plugin => plugin.name)
    }))).toEqual([
      {
        category: 'automation',
        plugins: ['@oneworks/plugin-cua-driver']
      },
      {
        category: 'development',
        plugins: ['@oneworks/plugin-demo']
      },
      {
        category: 'themes',
        plugins: ['@oneworks/plugin-china-red-theme']
      },
      {
        category: 'creative',
        plugins: ['figma']
      },
      {
        category: 'data',
        plugins: ['data-analytics']
      }
    ])
  })
})

describe('plugin homepage routing', () => {
  it('round-trips a stable opaque marketplace plugin key without exposing its source URL', () => {
    const key = createMarketplacePluginRouteKey('official/插件', 'reviewer')

    expect(key).not.toContain('official')
    expect(key).not.toContain('插件')
    expect(resolveMarketplacePluginRouteKey(key)).toEqual({
      marketplace: 'official/插件',
      plugin: 'reviewer'
    })
    expect(resolveMarketplacePluginRouteKey('market:not-hex')).toBeUndefined()
  })

  it('keeps /plugins as the homepage', () => {
    expect(resolvePluginLocation('/plugins', '')).toMatchObject({
      page: 'home',
      pathname: '/plugins',
      shouldReplace: false
    })
  })

  it('keeps the legacy create query redirect', () => {
    expect(resolvePluginLocation('/plugins', '?mode=create')).toMatchObject({
      page: 'create',
      pathname: '/plugins/create',
      search: '',
      shouldReplace: true
    })
  })
})
