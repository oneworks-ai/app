import type {
  ConfigResponse,
  PluginMarketplaceCatalogResponse,
  PluginMarketplaceUninstallIdentity
} from '@oneworks/types'

import { isApiRemoteWorkspaceConnectionError, isApiRequestTimeoutError } from '#~/api/base'
import { claimMarketplaceConvergenceAuthority } from '#~/plugins/marketplace-mutation-authority'

import { resolvePluginMarketplaceUninstallReconciliationState } from './plugin-marketplace-uninstall'
import type {
  PluginMarketplaceUninstallConvergenceTasks,
  PluginMarketplaceUninstallReconciliationState,
  PluginMarketplaceUninstallRuntimeConvergenceResult
} from './plugin-marketplace-uninstall'

export const isPluginMarketplaceUninstallCommitUnknownError = (error: unknown) => (
  error instanceof TypeError ||
  isApiRequestTimeoutError(error) ||
  isApiRemoteWorkspaceConnectionError(error)
)

const getFulfilledValue = <T>(result: PromiseSettledResult<unknown>) => (
  result.status === 'fulfilled' ? result.value as T : undefined
)

export const reconcilePluginMarketplaceUninstall = async (params: {
  identity: PluginMarketplaceUninstallIdentity
  isServerCurrent: () => boolean
  refresh: (
    authority: ReturnType<typeof claimMarketplaceConvergenceAuthority>
  ) => PluginMarketplaceUninstallConvergenceTasks
  serverKey: string
}): Promise<{
  isCurrent: () => boolean
  release: () => void
  refreshFailed: boolean
  state: PluginMarketplaceUninstallReconciliationState
}> => {
  const authority = claimMarketplaceConvergenceAuthority(params.serverKey, params.isServerCurrent)
  const isCurrent = () =>
    authority.config.isCurrent() &&
    authority.catalog.isCurrent() &&
    authority.runtime.isCurrent()
  const indeterminate = (refreshFailed: boolean) => ({
    isCurrent,
    refreshFailed,
    release: authority.release,
    state: 'committed-indeterminate' as const
  })
  let refreshResults: PromiseSettledResult<unknown>[]
  try {
    const tasks = params.refresh(authority)
    refreshResults = await Promise.allSettled([tasks.config, tasks.catalog, tasks.runtime])
  } catch {
    return indeterminate(true)
  }
  const refreshFailed = refreshResults.some(result => result.status === 'rejected')
  const runtime = getFulfilledValue<PluginMarketplaceUninstallRuntimeConvergenceResult>(refreshResults[2]!)
  if (refreshFailed || runtime?.applied !== true || !isCurrent()) return indeterminate(refreshFailed)
  return {
    isCurrent,
    refreshFailed,
    release: authority.release,
    state: resolvePluginMarketplaceUninstallReconciliationState(
      params.identity,
      getFulfilledValue<ConfigResponse>(refreshResults[0]!),
      getFulfilledValue<PluginMarketplaceCatalogResponse>(refreshResults[1]!)
    )
  }
}
