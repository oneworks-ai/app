import type { KeyedMutator } from 'swr'

import type { PluginMarketplaceUninstallIdentity } from '@oneworks/types'

import { normalizeServerBaseUrl } from '#~/runtime-config'
import type {
  MarketplaceCacheAuthority,
  MarketplaceCacheDomain,
  MarketplaceConvergenceAuthority,
  MarketplaceSelectionAuthority,
  MarketplaceSelectionAuthorityStatus,
  MarketplaceSelectionMutation
} from './marketplace-mutation-authority-types'
import { createMarketplaceSelectionAuthorityKey } from './marketplace-selection-intent-authority'

export type * from './marketplace-mutation-authority-types'
export {
  claimMarketplaceSelectionIntentAuthority,
  claimMarketplaceSourceIntentAuthority,
  createMarketplaceSelectionAuthorityKey
} from './marketplace-selection-intent-authority'

const cacheAuthorities = new Map<string, number>()
const selectionAuthorities = new Map<string, MarketplaceSelectionAuthority>()
const selectionListeners = new Map<string, Set<() => void>>()
let nextAuthorityRevision = 0

export const resolveMarketplaceServerKey = (serverBaseUrl?: string) => (
  normalizeServerBaseUrl(serverBaseUrl) ?? 'current'
)

const createCacheKey = (serverKey: string, domain: MarketplaceCacheDomain) => (
  JSON.stringify([serverKey, domain])
)

const notifySelectionListeners = (serverKey: string) => {
  queueMicrotask(() => selectionListeners.get(serverKey)?.forEach(listener => listener()))
}

export const claimMarketplaceCacheAuthority = (
  serverKey: string,
  domain: MarketplaceCacheDomain
): MarketplaceCacheAuthority => {
  const key = createCacheKey(serverKey, domain)
  const revision = ++nextAuthorityRevision
  cacheAuthorities.set(key, revision)
  return {
    domain,
    isCurrent: () => cacheAuthorities.get(key) === revision,
    release: () => {
      if (cacheAuthorities.get(key) === revision) cacheAuthorities.delete(key)
    },
    revision,
    serverKey
  }
}

export const claimMarketplaceConvergenceAuthority = (
  serverKey: string,
  lifecycleIsCurrent: () => boolean = () => true
): MarketplaceConvergenceAuthority => {
  const authority = {
    catalog: claimMarketplaceCacheAuthority(serverKey, 'catalog'),
    config: claimMarketplaceCacheAuthority(serverKey, 'config'),
    runtime: claimMarketplaceCacheAuthority(serverKey, 'runtime')
  }
  return {
    catalog: {
      ...authority.catalog,
      isCurrent: () => lifecycleIsCurrent() && authority.catalog.isCurrent()
    },
    config: {
      ...authority.config,
      isCurrent: () => lifecycleIsCurrent() && authority.config.isCurrent()
    },
    release: () => {
      authority.catalog.release()
      authority.config.release()
      authority.runtime.release()
    },
    runtime: {
      ...authority.runtime,
      isCurrent: () => lifecycleIsCurrent() && authority.runtime.isCurrent()
    }
  }
}

export const publishMarketplaceSelectionAuthority = (
  serverKey: string,
  selection: MarketplaceSelectionMutation,
  status: MarketplaceSelectionAuthorityStatus
): MarketplaceSelectionAuthority => {
  const key = createMarketplaceSelectionAuthorityKey(serverKey, selection)
  const revision = ++nextAuthorityRevision
  const authority: MarketplaceSelectionAuthority = {
    ...selection,
    isCurrent: () => selectionAuthorities.get(key)?.revision === revision,
    key,
    revision,
    serverKey,
    status
  }
  if ((selectionListeners.get(serverKey)?.size ?? 0) > 0) {
    selectionAuthorities.set(key, authority)
    notifySelectionListeners(serverKey)
  }
  return authority
}

export const publishMarketplaceUninstallAuthority = (
  serverKey: string,
  identity: PluginMarketplaceUninstallIdentity
) =>
  publishMarketplaceSelectionAuthority(serverKey, {
    enabled: false,
    marketplace: identity.marketplace,
    plugin: identity.plugin,
    target: 'project'
  }, 'confirmed')

export const clearMarketplaceSelectionAuthority = (
  authority: MarketplaceSelectionAuthority
) => {
  if (!authority.isCurrent()) return
  selectionAuthorities.delete(authority.key)
  notifySelectionListeners(authority.serverKey)
}

export const captureMarketplaceSelectionSupersession = (
  serverKey: string,
  scopes: Array<
    & Pick<MarketplaceSelectionMutation, 'marketplace'>
    & Partial<Pick<MarketplaceSelectionMutation, 'plugin' | 'target'>>
  >
) => {
  const captured = [...selectionAuthorities.values()].filter(authority =>
    authority.serverKey === serverKey && scopes.some(scope =>
      authority.marketplace === scope.marketplace &&
      (scope.plugin == null || authority.plugin === scope.plugin) &&
      (scope.target == null || authority.target === scope.target)
    )
  )
  return () => {
    const current = captured.filter(authority => authority.isCurrent())
    current.forEach(authority => selectionAuthorities.delete(authority.key))
    if (current.length > 0) notifySelectionListeners(serverKey)
  }
}
export const listMarketplaceSelectionAuthorities = (serverKey: string) => (
  [...selectionAuthorities.values()].filter(authority => authority.serverKey === serverKey)
)
export const subscribeMarketplaceSelectionAuthorities = (
  serverKey: string,
  listener: () => void
) => {
  const listeners = selectionListeners.get(serverKey) ?? new Set<() => void>()
  listeners.add(listener)
  selectionListeners.set(serverKey, listeners)
  let active = true
  return () => {
    if (!active) return
    active = false
    if (selectionListeners.get(serverKey) !== listeners || !listeners.has(listener)) return
    listeners.delete(listener)
    if (listeners.size === 0) {
      selectionListeners.delete(serverKey)
      for (const authority of selectionAuthorities.values()) {
        if (authority.serverKey === serverKey) selectionAuthorities.delete(authority.key)
      }
    }
  }
}
export const applyMarketplaceCacheRefresh = async <T>(params: {
  authority: MarketplaceCacheAuthority
  load: () => Promise<T>
  mutate: KeyedMutator<T>
}) => {
  const value = await params.load()
  if (!params.authority.isCurrent()) return undefined
  await params.mutate(
    current => params.authority.isCurrent() ? value : current,
    { revalidate: false }
  )
  return params.authority.isCurrent() ? value : undefined
}

export const settleMarketplaceConvergence = async (
  authority: MarketplaceConvergenceAuthority,
  createTasks: () => Promise<unknown>[]
) => {
  try {
    return await Promise.allSettled(createTasks())
  } finally {
    authority.release()
  }
}
