import { readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { ManagedPluginSource } from '@oneworks/types'
import type { ManagedPluginInstall } from '@oneworks/utils/managed-plugin'
import { listManagedPluginInstalls } from '@oneworks/utils/managed-plugin'

import { addAdapterPlugin } from './managed-plugin-install'

const resolveMarketplacePluginAdapter = (type: string) => {
  switch (type) {
    case 'claude-code':
      return 'claude'
    case 'codex':
      return 'codex'
    default:
      return undefined
  }
}

const isSupportedMarketplaceType = (type: string) => (
  type === 'claude-code' || type === 'codex' || type === 'oneworks'
)

const matchesMarketplaceSource = (
  source: ManagedPluginSource,
  marketplace: string,
  plugin: string
) => source.type === 'marketplace' && source.marketplace === marketplace && source.plugin === plugin

const hasLegacyPluginDataTarget = async (install: ManagedPluginInstall) => {
  try {
    await stat(join(install.installDir, 'data'))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return true
    }
  }

  const hooksPath = join(install.oneworksPluginDir, 'hooks.js')
  try {
    return (await readFile(hooksPath, 'utf8')).includes("path.resolve(__dirname, '..', 'data')")
  } catch {
    return false
  }
}

type MarketplaceSyncConfig = Record<string, {
  type: string
  enabled?: boolean
  syncOnRun?: boolean
  plugins?: Record<string, {
    enabled?: boolean
    scope?: string
  }>
}>

export const assertUniqueMarketplacePluginScopes = (marketplaces: MarketplaceSyncConfig | undefined) => {
  const desiredScopes = new Map<string, string>()
  for (const [marketplaceName, marketplace] of Object.entries(marketplaces ?? {})) {
    if (marketplace.enabled === false || !isSupportedMarketplaceType(marketplace.type)) continue
    for (const [pluginName, plugin] of Object.entries(marketplace.plugins ?? {})) {
      if (plugin.enabled === false) continue
      const desiredScope = plugin.scope?.trim() || pluginName
      const owner = desiredScopes.get(desiredScope)
      if (owner != null) {
        throw new Error(
          `Plugin scope "${desiredScope}" is declared by both ${owner} and ${pluginName}@${marketplaceName}.`
        )
      }
      desiredScopes.set(desiredScope, `${pluginName}@${marketplaceName}`)
    }
  }
}

export const syncConfiguredMarketplacePlugins = async (params: {
  cwd: string
  env?: Record<string, string | null | undefined>
  marketplaces: MarketplaceSyncConfig | undefined
}) => {
  const results: Array<{
    marketplace: string
    plugin: string
    action: 'installed' | 'updated' | 'skipped'
  }> = []
  const marketplaces = Object.entries(params.marketplaces ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
  assertUniqueMarketplacePluginScopes(params.marketplaces)

  for (const [marketplaceName, marketplace] of marketplaces) {
    if (marketplace.enabled === false) continue

    const adapter = resolveMarketplacePluginAdapter(marketplace.type)
    if (adapter == null) continue

    const installs = await listManagedPluginInstalls(params.cwd, {
      adapter,
      env: params.env as NodeJS.ProcessEnv | undefined
    })
    const plugins = Object.entries(marketplace.plugins ?? {})
      .sort(([left], [right]) => left.localeCompare(right))

    for (const [pluginName, plugin] of plugins) {
      if (plugin.enabled === false) continue

      const existingInstall = installs.find(install => (
        matchesMarketplaceSource(install.config.source, marketplaceName, pluginName)
      ))
      const desiredScope = plugin.scope?.trim() !== '' ? plugin.scope?.trim() : undefined
      const shouldMigratePluginData = existingInstall == null ? false : await hasLegacyPluginDataTarget(existingInstall)
      const shouldUpdate = existingInstall != null && (
        marketplace.syncOnRun === true ||
        shouldMigratePluginData ||
        (desiredScope ?? pluginName) !== (existingInstall.config.scope ?? existingInstall.config.name) ||
        !matchesMarketplaceSource(existingInstall.config.source, marketplaceName, pluginName)
      )

      if (existingInstall != null && !shouldUpdate) {
        results.push({
          marketplace: marketplaceName,
          plugin: pluginName,
          action: 'skipped'
        })
        continue
      }

      const installed = await addAdapterPlugin(adapter, {
        cwd: params.cwd,
        env: params.env,
        source: `${pluginName}@${marketplaceName}`,
        force: existingInstall != null,
        silent: true,
        ...(desiredScope != null ? { scope: desiredScope } : {})
      })
      if (existingInstall != null && existingInstall.installDir !== installed.installDir) {
        await rm(existingInstall.installDir, { recursive: true, force: true })
      }
      results.push({
        marketplace: marketplaceName,
        plugin: pluginName,
        action: existingInstall == null ? 'installed' : 'updated'
      })
    }
  }

  return results
}
