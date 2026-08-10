import { useCallback } from 'react'
import type { KeyedMutator } from 'swr'

import type { PluginMarketplaceCatalogResponse } from '@oneworks/types'

import { listPluginMarketplaceCatalog } from '#~/plugins/marketplace-api'
import {
  applyMarketplaceCacheRefresh,
  claimMarketplaceConvergenceAuthority,
  settleMarketplaceConvergence
} from '#~/plugins/marketplace-mutation-authority'
import type { MarketplaceCacheAuthority } from '#~/plugins/marketplace-mutation-authority'
import type { PluginRefreshOptions } from '#~/plugins/plugin-context'

export const useMarketplaceSelectionConvergence = ({
  loadCatalog,
  mutateCatalog,
  refreshAfterSuccess,
  refreshPlugins,
  serverBaseUrl,
  serverKey
}: {
  loadCatalog?: () => Promise<PluginMarketplaceCatalogResponse>
  mutateCatalog: KeyedMutator<PluginMarketplaceCatalogResponse>
  refreshAfterSuccess?: UseConvergenceRefresh
  refreshPlugins: (options?: PluginRefreshOptions) => Promise<unknown>
  serverBaseUrl?: string
  serverKey: string
}) =>
  useCallback((isServerCurrent: () => boolean) => {
    const rawAuthority = claimMarketplaceConvergenceAuthority(serverKey)
    const withServerAuthority = (authority: MarketplaceCacheAuthority): MarketplaceCacheAuthority => ({
      ...authority,
      isCurrent: () => isServerCurrent() && authority.isCurrent()
    })
    const authority = {
      catalog: withServerAuthority(rawAuthority.catalog),
      config: withServerAuthority(rawAuthority.config),
      release: rawAuthority.release,
      runtime: withServerAuthority(rawAuthority.runtime)
    }
    return settleMarketplaceConvergence(authority, () => [
      refreshAfterSuccess?.(authority) ?? Promise.resolve(),
      refreshPlugins({ isCurrent: authority.runtime.isCurrent }),
      applyMarketplaceCacheRefresh({
        authority: authority.catalog,
        load: () => loadCatalog?.() ?? listPluginMarketplaceCatalog({ serverBaseUrl }),
        mutate: mutateCatalog
      })
    ]).then(() => undefined).catch(() => undefined)
  }, [loadCatalog, mutateCatalog, refreshAfterSuccess, refreshPlugins, serverBaseUrl, serverKey])

type UseConvergenceRefresh = NonNullable<
  import('../@core/marketplace-plugin-selection').UseMarketplacePluginSelectionOptions['refreshAfterSuccess']
>
