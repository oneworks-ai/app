import { describe, expect, it } from 'vitest'

import type { PluginMarketplaceCatalogPlugin } from '@oneworks/types'

import { selectRecommendedMarketplacePlugins } from '#~/components/plugins/PluginHomeView'
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

  it('uses the Codex featured set and hides plugins already installed by the native host', () => {
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
    ).toEqual(['notion'])
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
