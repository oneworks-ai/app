import { rm } from 'node:fs/promises'

import { assertUniqueMarketplacePluginScopes, syncConfiguredMarketplacePlugins } from '@oneworks/managed-plugins'
import type { Config, MarketplaceConfig } from '@oneworks/types'
import { mergeMarketplaceConfigs } from '@oneworks/utils'
import { listManagedPluginInstalls } from '@oneworks/utils/managed-plugin'

import { loadConfigState } from '#~/services/config/index.js'

import { BUILT_IN_PLUGIN_MARKETPLACES } from './built-in-marketplaces'

const getMarketplaces = (config: Config | undefined): MarketplaceConfig => config?.marketplaces ?? {}

export const syncPluginMarketplaceSelection = async (params: {
  enabled: boolean
  marketplace: string
  plugin: string
}) => {
  const { mergedConfig, workspaceFolder } = await loadConfigState()
  const effectiveMarketplaces = mergeMarketplaceConfigs(
    BUILT_IN_PLUGIN_MARKETPLACES,
    getMarketplaces(mergedConfig)
  ) ?? BUILT_IN_PLUGIN_MARKETPLACES
  const marketplace = effectiveMarketplaces[params.marketplace]
  if (marketplace == null) {
    throw new Error(`Plugin marketplace ${params.marketplace} is not configured.`)
  }
  const adapter = marketplace.type === 'codex' ? 'codex' : 'claude'

  if (params.enabled) {
    assertUniqueMarketplacePluginScopes(effectiveMarketplaces)
    const declaredPlugin = marketplace.plugins?.[params.plugin]
    if (declaredPlugin == null || declaredPlugin.enabled === false) {
      throw new Error(`Plugin ${params.plugin}@${params.marketplace} is not enabled in config.`)
    }
    return syncConfiguredMarketplacePlugins({
      cwd: workspaceFolder,
      marketplaces: { [params.marketplace]: marketplace }
    })
  }

  const effectivePlugin = marketplace.plugins?.[params.plugin]
  if (marketplace.enabled !== false && effectivePlugin != null && effectivePlugin.enabled !== false) {
    return [{
      marketplace: params.marketplace,
      plugin: params.plugin,
      action: 'skipped' as const
    }]
  }

  const installs = await listManagedPluginInstalls(workspaceFolder, { adapter })
  const matchingInstalls = installs.filter(install => (
    install.config.source.type === 'marketplace' &&
    install.config.source.marketplace === params.marketplace &&
    install.config.source.plugin === params.plugin
  ))
  await Promise.all(matchingInstalls.map(install => rm(install.installDir, { recursive: true, force: true })))
  return matchingInstalls.map(() => ({
    marketplace: params.marketplace,
    plugin: params.plugin,
    action: 'removed' as const
  }))
}
