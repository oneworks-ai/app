import type { KeyedMutator } from 'swr'

import type {
  PluginMarketplaceCatalogPlugin,
  PluginMarketplaceCatalogResponse,
  PluginMarketplaceConfigSource,
  PluginMarketplaceInstallTarget
} from '@oneworks/types'

import type { PluginRefreshOptions } from '#~/plugins/plugin-context'

export interface MarketplacePluginSelection {
  enabled: boolean
  marketplace: string
  plugin: string
  target: PluginMarketplaceInstallTarget
}

export interface MarketplacePluginSelectionResult {
  enabled: boolean
  plugin: PluginMarketplaceCatalogPlugin
  target: PluginMarketplaceInstallTarget
}

export interface UseMarketplacePluginSelectionOptions {
  mutateCatalog: KeyedMutator<PluginMarketplaceCatalogResponse>
  onError: (error: unknown) => void
  onSuccess: (result: MarketplacePluginSelectionResult) => void
  refreshPlugins: (options?: PluginRefreshOptions) => Promise<unknown>
  serverBaseUrl?: string
  loadCatalog?: () => Promise<PluginMarketplaceCatalogResponse>
  syncSelection?: (
    marketplace: string,
    plugin: string,
    enabled: boolean,
    target: PluginMarketplaceInstallTarget,
    options: { serverBaseUrl?: string }
  ) => Promise<unknown>
}

export interface MarketplacePluginSelectionController {
  getState: (
    plugin: PluginMarketplaceCatalogPlugin,
    target: PluginMarketplaceInstallTarget
  ) => {
    installed: boolean
    pending: boolean
  }
  toggle: (
    plugin: PluginMarketplaceCatalogPlugin,
    target: PluginMarketplaceInstallTarget
  ) => Promise<void>
}

export const createMarketplaceSelectionKey = (
  scopeKey: string,
  plugin: PluginMarketplaceCatalogPlugin,
  target: PluginMarketplaceInstallTarget
) => JSON.stringify([scopeKey, plugin.marketplace, plugin.name, target])

export const updateMarketplaceSelectionKeys = (
  current: ReadonlySet<string>,
  key: string,
  enabled: boolean
) => {
  const next = new Set(current)
  if (enabled) next.add(key)
  else next.delete(key)
  return next
}

const updateInstalledSources = (
  sources: PluginMarketplaceConfigSource[] | undefined,
  enabled: boolean,
  target: PluginMarketplaceInstallTarget
) => {
  const retained = (sources ?? []).filter(source =>
    target === 'global'
      ? source !== 'global'
      : source !== 'project' && source !== 'user'
  )
  return enabled ? [...retained, target] : retained
}

export const isPluginInstalledForTarget = (
  plugin: PluginMarketplaceCatalogPlugin,
  target: PluginMarketplaceInstallTarget
) =>
  target === 'global'
    ? plugin.installedSources?.includes('global') === true
    : plugin.installedSources?.some(source => source === 'project' || source === 'user') === true

export const isMarketplacePluginInstallable = (plugin: PluginMarketplaceCatalogPlugin) => (
  plugin.installable !== false && plugin.marketplaceEnabled
)

export const getMarketplacePluginSelectionState = (
  scopeKey: string,
  committed: Readonly<Record<string, boolean>>,
  pending: ReadonlySet<string>,
  plugin: PluginMarketplaceCatalogPlugin,
  target: PluginMarketplaceInstallTarget
) => {
  const key = createMarketplaceSelectionKey(scopeKey, plugin, target)
  return {
    installed: committed[key] ?? isPluginInstalledForTarget(plugin, target),
    pending: pending.has(key)
  }
}

export const applyMarketplacePluginSelection = (
  catalog: PluginMarketplaceCatalogResponse,
  selection: MarketplacePluginSelection
): PluginMarketplaceCatalogResponse => ({
  ...catalog,
  plugins: catalog.plugins.map((plugin) => {
    if (plugin.marketplace !== selection.marketplace || plugin.name !== selection.plugin) return plugin
    const installedSources = updateInstalledSources(
      plugin.installedSources,
      selection.enabled,
      selection.target
    )
    if (installedSources.length > 0) return { ...plugin, installedSources }
    const { installedSources: _installedSources, ...pluginWithoutInstalledSources } = plugin
    return pluginWithoutInstalledSources
  })
})

export const applyMarketplacePluginSelections = (
  catalog: PluginMarketplaceCatalogResponse,
  selections: Iterable<MarketplacePluginSelection>
) => {
  let result = catalog
  for (const selection of selections) {
    result = applyMarketplacePluginSelection(result, selection)
  }
  return result
}
