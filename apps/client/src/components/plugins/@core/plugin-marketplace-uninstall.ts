import type {
  ConfigResponse,
  MutationCommitState,
  PluginMarketplaceCatalogResponse,
  PluginMarketplaceUninstallIdentity
} from '@oneworks/types'

import type {
  MarketplaceConvergenceAuthority,
  MarketplaceSelectionIntentAuthority
} from '#~/plugins/marketplace-mutation-authority'

export interface PluginUninstallOperation {
  authority: MarketplaceSelectionIntentAuthority
  controller: AbortController
  generation: number
  identity: PluginMarketplaceUninstallIdentity
  indeterminateNotified?: boolean
  phase: 'committed' | 'indeterminate' | 'quoting' | 'reconciling' | 'removing'
  reconciliationWait?: {
    cancel: () => void
    promise: Promise<void>
  }
  serverKey: string
  serverRevision: number
}

export interface PluginMarketplaceUninstallConvergenceTasks {
  catalog: Promise<PluginMarketplaceCatalogResponse | undefined>
  config: Promise<ConfigResponse | undefined>
  runtime: Promise<PluginMarketplaceUninstallRuntimeConvergenceResult>
}

export interface PluginMarketplaceUninstallRuntimeConvergenceResult {
  applied: boolean
}

export interface UsePluginMarketplaceUninstallOptions {
  displayName?: string
  identity?: PluginMarketplaceUninstallIdentity
  onRemoved?: () => void
  refreshAfterRemoval: (authority: MarketplaceConvergenceAuthority) => PluginMarketplaceUninstallConvergenceTasks
  serverBaseUrl?: string
  surfaceKey: string
}

export type PluginMarketplaceUninstallReconciliationState = Extract<
  MutationCommitState,
  'committed' | 'committed-indeterminate'
>

export const pluginMarketplaceUninstallIdentitiesMatch = (
  left: PluginMarketplaceUninstallIdentity | undefined,
  right: PluginMarketplaceUninstallIdentity | undefined
) => (
  left?.adapter === right?.adapter &&
  left?.marketplace === right?.marketplace &&
  left?.plugin === right?.plugin &&
  left?.scope === right?.scope
)

export const createPluginMarketplaceUninstallIdentityKey = (
  identity: PluginMarketplaceUninstallIdentity | undefined
) => (
  identity == null
    ? ''
    : JSON.stringify([identity.adapter, identity.marketplace, identity.plugin, identity.scope])
)

const configContainsMarketplaceUninstallIdentity = (
  config: ConfigResponse,
  identity: PluginMarketplaceUninstallIdentity
) => {
  const marketplace = config.sources?.project?.plugins?.marketplaces?.[identity.marketplace]
  if (marketplace == null || marketplace.enabled === false) return false
  const expectedType = identity.adapter === 'claude' ? 'claude-code' : 'codex'
  if (marketplace.type !== expectedType) return false
  const plugin = marketplace.plugins?.[identity.plugin]
  if (plugin == null || plugin.enabled === false) return false
  const configuredScope = plugin.scope?.trim()
  return configuredScope == null || configuredScope === '' || configuredScope === identity.scope
}

const catalogContainsMarketplaceUninstallIdentity = (
  catalog: PluginMarketplaceCatalogResponse,
  identity: PluginMarketplaceUninstallIdentity
) => {
  const plugin = catalog.plugins.find(item =>
    item.marketplace === identity.marketplace && item.name === identity.plugin
  )
  return plugin?.installedSources?.some(source => source === 'project' || source === 'user') === true
}

export const resolvePluginMarketplaceUninstallReconciliationState = (
  identity: PluginMarketplaceUninstallIdentity,
  config: ConfigResponse | undefined,
  catalog: PluginMarketplaceCatalogResponse | undefined
): PluginMarketplaceUninstallReconciliationState => {
  if (config == null || catalog == null) return 'committed-indeterminate'
  const configContainsIdentity = configContainsMarketplaceUninstallIdentity(config, identity)
  const catalogContainsIdentity = catalogContainsMarketplaceUninstallIdentity(catalog, identity)
  if (!configContainsIdentity && !catalogContainsIdentity) return 'committed'
  return 'committed-indeterminate'
}
