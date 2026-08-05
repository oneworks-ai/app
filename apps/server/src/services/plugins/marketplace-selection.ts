/* eslint-disable max-lines -- selection transaction keeps layered writes and compensation in one service. */

import path from 'node:path'
import process from 'node:process'

import { updateConfigFile } from '@oneworks/config'
import { withManagedPluginMutationLock } from '@oneworks/managed-plugins'
import type { ManagedPluginMutationRuntime } from '@oneworks/managed-plugins'
import type { Config, MarketplaceConfig, MarketplaceConfigEntry, PluginMarketplaceInstallTarget } from '@oneworks/types'
import { mergeMarketplaceConfigs } from '@oneworks/utils'

import { loadConfigState } from '#~/services/config/index.js'

import { BUILT_IN_PLUGIN_MARKETPLACES } from './built-in-marketplaces'
import { syncPluginMarketplaceSelection } from './marketplace-sync'
import { isOneWorksOfficialPlugin } from './oneworks-official-marketplace'

const getMarketplaces = (config: Config | undefined): MarketplaceConfig => config?.marketplaces ?? {}

const removeEmptyMarketplaceOverride = (
  marketplaces: MarketplaceConfig,
  marketplaceKey: string
) => {
  const entry = marketplaces[marketplaceKey]
  if (entry == null || entry.plugins != null) return marketplaces
  if (entry.enabled != null || entry.syncOnRun != null) return marketplaces
  if (entry.type !== 'oneworks' && entry.options != null) return marketplaces

  const next = { ...marketplaces }
  delete next[marketplaceKey]
  return next
}

export const updateMarketplacePluginDeclaration = (params: {
  baseEntry?: MarketplaceConfigEntry
  enabled: boolean
  marketplaceKey: string
  marketplaceType: MarketplaceConfigEntry['type']
  marketplaces: MarketplaceConfig
  pluginName: string
}): MarketplaceConfig => {
  const current = params.marketplaces[params.marketplaceKey]
  if (!params.enabled && current == null) return params.marketplaces
  const sameType = current?.type === params.marketplaceType
  const plugins = sameType ? { ...current.plugins } : {}
  const currentWithoutPlugins = sameType && current != null
    ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== 'plugins'))
    : undefined
  const baseEntry = !sameType && params.baseEntry?.type === params.marketplaceType
    ? {
      type: params.marketplaceType,
      ...(params.baseEntry.options != null ? { options: params.baseEntry.options } : {})
    }
    : { type: params.marketplaceType }
  const inheritedOneWorksOptions = params.baseEntry?.type === 'oneworks' &&
      (currentWithoutPlugins ?? baseEntry).type === 'oneworks'
    ? params.baseEntry.options
    : undefined

  if (params.enabled) {
    plugins[params.pluginName] = {
      ...(plugins[params.pluginName] ?? {}),
      enabled: true
    }
  } else {
    delete plugins[params.pluginName]
  }

  const nextEntry: MarketplaceConfigEntry = {
    ...(inheritedOneWorksOptions != null ? { options: inheritedOneWorksOptions } : {}),
    ...(currentWithoutPlugins ?? baseEntry),
    ...(Object.keys(plugins).length > 0 ? { plugins } : {})
  } as MarketplaceConfigEntry
  return removeEmptyMarketplaceOverride({
    ...params.marketplaces,
    [params.marketplaceKey]: nextEntry
  }, params.marketplaceKey)
}

const isMarketplacePluginEnabled = (
  marketplaces: MarketplaceConfig,
  marketplaceKey: string,
  pluginName: string
) => {
  const marketplace = marketplaces[marketplaceKey]
  const plugin = marketplace?.plugins?.[pluginName]
  return marketplace?.enabled !== false && plugin != null && plugin.enabled !== false
}

const loadEffectiveMarketplacePluginEnabled = async (marketplaceKey: string, pluginName: string) => {
  const state = await loadConfigState()
  const marketplaces = mergeMarketplaceConfigs(
    BUILT_IN_PLUGIN_MARKETPLACES,
    getMarketplaces(state.mergedConfig)
  ) ?? BUILT_IN_PLUGIN_MARKETPLACES
  return isMarketplacePluginEnabled(marketplaces, marketplaceKey, pluginName)
}

const toPluginsSection = (config: Config | undefined, marketplaces: MarketplaceConfig) => ({
  ...(config?.plugins != null ? { plugins: config.plugins } : {}),
  marketplaces
})

const setPluginMarketplaceSelectionUnlocked = async (params: {
  enabled: boolean
  marketplace: string
  plugin: string
  target: PluginMarketplaceInstallTarget
}, mutationRuntime?: ManagedPluginMutationRuntime) => {
  const syncSelection = (selection: { enabled: boolean; marketplace: string; plugin: string }) => (
    mutationRuntime == null
      ? syncPluginMarketplaceSelection(selection)
      : syncPluginMarketplaceSelection(selection, mutationRuntime)
  )
  const state = await loadConfigState()
  const effectiveMarketplaces = mergeMarketplaceConfigs(
    BUILT_IN_PLUGIN_MARKETPLACES,
    getMarketplaces(state.mergedConfig)
  ) ?? BUILT_IN_PLUGIN_MARKETPLACES
  const effectiveMarketplace = effectiveMarketplaces[params.marketplace]
  if (effectiveMarketplace == null) {
    throw new Error(`Plugin marketplace ${params.marketplace} is not configured.`)
  }
  if (
    effectiveMarketplace.type === 'oneworks' &&
    !isOneWorksOfficialPlugin(params.marketplace, params.plugin)
  ) {
    throw new Error(`Plugin ${params.plugin} is not in the official One Works marketplace.`)
  }
  const wasEnabled = isMarketplacePluginEnabled(effectiveMarketplaces, params.marketplace, params.plugin)
  const targetConfig = params.target === 'global'
    ? state.globalSource?.rawConfig
    : state.projectSource?.rawConfig
  const writes: Array<{
    current: Config | undefined
    resolveNext: (current: Config | undefined) => MarketplaceConfig
    source: 'global' | 'project' | 'user'
  }> = [{
    current: targetConfig,
    resolveNext: current =>
      updateMarketplacePluginDeclaration({
        ...(
          effectiveMarketplace.type === 'oneworks' ||
            (params.target === 'global' && BUILT_IN_PLUGIN_MARKETPLACES[params.marketplace] == null)
            ? { baseEntry: effectiveMarketplace }
            : {}
        ),
        enabled: params.enabled,
        marketplaceKey: params.marketplace,
        marketplaceType: effectiveMarketplace.type,
        marketplaces: getMarketplaces(current),
        pluginName: params.plugin
      }),
    source: params.target
  }]

  if (params.target === 'project') {
    const userConfig = state.userSource?.rawConfig
    if (getMarketplaces(userConfig)[params.marketplace]?.plugins?.[params.plugin] != null) {
      writes.push({
        current: userConfig,
        resolveNext: current =>
          updateMarketplacePluginDeclaration({
            enabled: false,
            marketplaceKey: params.marketplace,
            marketplaceType: effectiveMarketplace.type,
            marketplaces: getMarketplaces(current),
            pluginName: params.plugin
          }),
        source: 'user'
      })
    }
  }

  const completed: typeof writes = []
  try {
    for (const write of writes) {
      await updateConfigFile({
        workspaceFolder: state.workspaceFolder,
        source: write.source,
        section: 'plugins',
        resolveValue: current => toPluginsSection(current, write.resolveNext(current))
      })
      completed.push(write)
    }
    return await syncSelection({
      enabled: await loadEffectiveMarketplacePluginEnabled(params.marketplace, params.plugin),
      marketplace: params.marketplace,
      plugin: params.plugin
    })
  } catch (error) {
    for (const write of completed.reverse()) {
      try {
        await updateConfigFile({
          workspaceFolder: state.workspaceFolder,
          source: write.source,
          section: 'plugins',
          value: toPluginsSection(write.current, getMarketplaces(write.current))
        })
      } catch {
        // Preserve the original selection error; later config reload remains authoritative.
      }
    }
    try {
      await syncSelection({
        enabled: wasEnabled,
        marketplace: params.marketplace,
        plugin: params.plugin
      })
    } catch {
      // Preserve the original error; restored config will reconcile on the next sync.
    }
    throw error
  }
}

export const setPluginMarketplaceSelection = async (params: {
  enabled: boolean
  marketplace: string
  plugin: string
  target: PluginMarketplaceInstallTarget
}, mutationRuntime?: ManagedPluginMutationRuntime) => {
  const { workspaceFolder } = await loadConfigState()
  return withManagedPluginMutationLock({
    cwd: workspaceFolder,
    env: process.env,
    runtime: mutationRuntime
  }, async () => {
    const currentState = await loadConfigState()
    if (path.resolve(currentState.workspaceFolder) !== path.resolve(workspaceFolder)) {
      throw new Error('Workspace changed while preparing plugin marketplace selection.')
    }
    return setPluginMarketplaceSelectionUnlocked(params, mutationRuntime)
  })
}
