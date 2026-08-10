import type { PluginMarketplaceInstallTarget } from '@oneworks/types'

export type MarketplaceCacheDomain = 'catalog' | 'config' | 'runtime'
export type MarketplaceSelectionAuthorityStatus = 'confirmed' | 'indeterminate'

export interface MarketplaceSelectionMutation {
  enabled: boolean
  marketplace: string
  plugin: string
  target: PluginMarketplaceInstallTarget
}

export interface MarketplaceCacheAuthority {
  domain: MarketplaceCacheDomain
  isCurrent: () => boolean
  release: () => void
  revision: number
  serverKey: string
}

export interface MarketplaceConvergenceAuthority {
  catalog: MarketplaceCacheAuthority
  config: MarketplaceCacheAuthority
  release: () => void
  runtime: MarketplaceCacheAuthority
}

export interface MarketplaceSelectionAuthority extends MarketplaceSelectionMutation {
  isCurrent: () => boolean
  key: string
  revision: number
  serverKey: string
  status: MarketplaceSelectionAuthorityStatus
}

export interface MarketplaceSelectionIntentAuthority {
  isCurrent: () => boolean
  key: string
  release: () => void
  revision: number
  serverKey: string
}

export interface MarketplaceSourceIntentAuthority {
  isCurrent: () => boolean
  key: string
  marketplace: string
  release: () => void
  revision: number
  serverKey: string
}
