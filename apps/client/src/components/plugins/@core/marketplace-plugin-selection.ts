import type { KeyedMutator } from 'swr'

import type {
  PluginMarketplaceCatalogPlugin,
  PluginMarketplaceCatalogResponse,
  PluginMarketplaceInstallTarget
} from '@oneworks/types'

import { ApiError, isApiRemoteWorkspaceConnectionError, isApiRequestTimeoutError } from '#~/api/base'
import type {
  MarketplaceConvergenceAuthority,
  MarketplaceSelectionAuthority,
  MarketplaceSelectionIntentAuthority,
  MarketplaceSelectionMutation
} from '#~/plugins/marketplace-mutation-authority'
import type { PluginRefreshOptions } from '#~/plugins/plugin-context'

export type MarketplacePluginSelection = MarketplaceSelectionMutation

export const isMarketplaceSelectionCommitUnknownError = (error: unknown) =>
  !(error instanceof ApiError) ||
  isApiRequestTimeoutError(error) || isApiRemoteWorkspaceConnectionError(error)

export interface MarketplacePluginSelectionResult {
  enabled: boolean
  plugin: PluginMarketplaceCatalogPlugin
  target: PluginMarketplaceInstallTarget
}

export interface MarketplaceSelectionOperation {
  authority: MarketplaceSelectionIntentAuthority
  consumers: number
  promise: Promise<MarketplacePluginSelection>
  selection: MarketplacePluginSelection
  settled: boolean
  token: object
}

export interface MarketplaceSelectionViewAuthority {
  authority: MarketplaceSelectionAuthority
  contextRevision: number
  plugin: PluginMarketplaceCatalogPlugin
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

export interface UseMarketplacePluginSelectionOptions {
  catalog?: PluginMarketplaceCatalogResponse
  contextKey: string
  loadCatalog?: () => Promise<PluginMarketplaceCatalogResponse>
  mutateCatalog: KeyedMutator<PluginMarketplaceCatalogResponse>
  onError: (error: unknown) => void
  onSuccess: (result: MarketplacePluginSelectionResult) => void
  refreshAfterSuccess?: (authority: MarketplaceConvergenceAuthority) => Promise<unknown>
  refreshPlugins: (options?: PluginRefreshOptions) => Promise<unknown>
  serverBaseUrl?: string
  syncSelection?: (
    marketplace: string,
    plugin: string,
    enabled: boolean,
    target: PluginMarketplaceInstallTarget,
    options: { serverBaseUrl?: string }
  ) => Promise<unknown>
}

export const createMarketplaceSelectionKey = (
  serverKey: string,
  plugin: Pick<PluginMarketplaceCatalogPlugin, 'marketplace' | 'name'>,
  target: PluginMarketplaceInstallTarget
) => JSON.stringify([serverKey, plugin.marketplace, plugin.name, target])

export const isPluginInstalledForTarget = (
  plugin: Pick<PluginMarketplaceCatalogPlugin, 'installedSources'>,
  target: PluginMarketplaceInstallTarget
) =>
  target === 'global'
    ? plugin.installedSources?.includes('global') === true
    : plugin.installedSources?.some(source => source === 'project' || source === 'user') === true

export const isMarketplacePluginInstallable = (
  plugin: Pick<PluginMarketplaceCatalogPlugin, 'installable' | 'marketplaceEnabled'>
) => plugin.installable !== false && plugin.marketplaceEnabled

export const getMarketplacePluginSelectionState = (
  serverKey: string,
  authorities: ReadonlyMap<string, MarketplaceSelectionAuthority>,
  pending: ReadonlySet<string>,
  plugin: PluginMarketplaceCatalogPlugin,
  target: PluginMarketplaceInstallTarget
) => {
  const key = createMarketplaceSelectionKey(serverKey, plugin, target)
  const authority = authorities.get(key)
  return {
    installed: authority?.status === 'confirmed'
      ? authority.enabled
      : isPluginInstalledForTarget(plugin, target),
    pending: pending.has(key)
  }
}

export const marketplaceCatalogMatchesSelection = (
  catalog: PluginMarketplaceCatalogResponse,
  selection: MarketplacePluginSelection
) => {
  const plugin = catalog.plugins.find(item =>
    item.marketplace === selection.marketplace && item.name === selection.plugin
  )
  return plugin != null && isPluginInstalledForTarget(plugin, selection.target) === selection.enabled
}
