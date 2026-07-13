import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { loadMarketplaceCatalogFromSource } from '@oneworks/adapter-claude-code/plugins'
import { loadCodexMarketplaceCatalogFromSource } from '@oneworks/adapter-codex/plugins'
import type { CodexMarketplacePluginDefinition } from '@oneworks/adapter-codex/plugins'
import { installManagedPluginSource } from '@oneworks/managed-plugins'
import type {
  ClaudeCodeMarketplacePluginDefinition,
  ClaudeCodeMarketplacePluginSource,
  Config,
  MarketplaceConfig,
  MarketplaceConfigEntry,
  PluginMarketplaceCatalogPlugin,
  PluginMarketplaceCatalogResponse,
  PluginMarketplaceCatalogSource,
  PluginMarketplaceConfigSource
} from '@oneworks/types'
import { mergeMarketplaceConfigs } from '@oneworks/utils'

import { loadConfigState } from '#~/services/config/index.js'

import { BUILT_IN_PLUGIN_MARKETPLACES } from './built-in-marketplaces'
import { getPluginSourceSummary, resolveMarketplacePluginVersion, toCatalogPlugin } from './marketplace-catalog-view'
import { getMarketplacePluginVersionKey, publishMarketplacePluginVersionSources } from './marketplace-version-resolver'
import type { MarketplacePluginVersionSourceMap } from './marketplace-version-resolver'

const configSourceOrder: PluginMarketplaceConfigSource[] = ['user', 'project', 'global']
const installedSourceOrder: PluginMarketplaceConfigSource[] = ['global', 'project', 'user']
const getMarketplaces = (config: Config | undefined): MarketplaceConfig => config?.marketplaces ?? {}

const getMarketplaceConfigSource = (
  sources: Record<PluginMarketplaceConfigSource, MarketplaceConfig>,
  key: string
) => configSourceOrder.find(source => sources[source][key] != null)

const getPluginInstalledSources = (
  sources: Record<PluginMarketplaceConfigSource, MarketplaceConfig>,
  marketplaceKey: string,
  pluginName: string
) =>
  installedSourceOrder.filter((source) => {
    const marketplace = sources[source][marketplaceKey]
    const plugin = marketplace?.plugins?.[pluginName]
    return marketplace?.enabled !== false && plugin != null && plugin.enabled !== false
  })

const toErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const loadMarketplacePlugins = async (params: {
  builtIn: boolean
  configSource?: PluginMarketplaceConfigSource
  cwd: string
  key: string
  marketplace: MarketplaceConfigEntry
  sourceConfigs: Record<PluginMarketplaceConfigSource, MarketplaceConfig>
  versionSources: MarketplacePluginVersionSourceMap
}): Promise<{
  plugins: PluginMarketplaceCatalogPlugin[]
  source: PluginMarketplaceCatalogSource
}> => {
  const source = params.marketplace.options?.source
  if (source == null) {
    return {
      plugins: [],
      source: {
        builtIn: params.builtIn,
        entry: params.marketplace,
        key: params.key,
        type: params.marketplace.type,
        enabled: params.marketplace.enabled !== false,
        pluginCount: 0,
        error: 'Marketplace is missing options.source.',
        ...(params.configSource != null ? { configSource: params.configSource } : {})
      }
    }
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), 'oneworks-marketplace-'))
  try {
    const installSource = (targetDir: string, managedSource: Parameters<typeof installManagedPluginSource>[2]) =>
      installManagedPluginSource(targetDir, params.cwd, managedSource)
    const loaded = params.marketplace.type === 'codex'
      ? await loadCodexMarketplaceCatalogFromSource(
        tempDir,
        params.marketplace.options!.source,
        params.key,
        installSource,
        { cwd: params.cwd, env: process.env }
      )
      : await loadMarketplaceCatalogFromSource(
        tempDir,
        params.marketplace.options!.source,
        params.key,
        installSource
      )
    const marketplaceTitle = 'title' in loaded.catalog
      ? loaded.catalog.title ?? loaded.catalog.name
      : loaded.catalog.name
    const plugins = loaded.catalog.plugins
      .map((plugin) => {
        const codexPlugin = plugin as CodexMarketplacePluginDefinition
        const pluginSource = params.marketplace.type === 'codex'
          ? codexPlugin.source.source === 'local'
            ? { label: codexPlugin.source.path, type: 'path' as const }
            : {
              label: `${codexPlugin.source.marketplace} · ${codexPlugin.source.pluginId}`,
              type: 'remote' as const
            }
          : getPluginSourceSummary((plugin as ClaudeCodeMarketplacePluginDefinition).source)
        if (params.marketplace.type === 'claude-code') {
          params.versionSources.set(
            getMarketplacePluginVersionKey(params.key, plugin.name),
            (plugin as ClaudeCodeMarketplacePluginDefinition).source
          )
        }
        return toCatalogPlugin({
          builtIn: params.builtIn,
          source: pluginSource,
          configSource: params.configSource,
          marketplace: params.marketplace,
          marketplaceKey: params.key,
          marketplaceTitle,
          installedSources: getPluginInstalledSources(params.sourceConfigs, params.key, plugin.name),
          version: params.marketplace.type === 'codex'
            ? plugin.version
            : resolveMarketplacePluginVersion(plugin as ClaudeCodeMarketplacePluginDefinition),
          plugin
        })
      })
      .sort((left, right) => left.name.localeCompare(right.name))
    return {
      plugins,
      source: {
        builtIn: params.builtIn,
        entry: params.marketplace,
        key: params.key,
        type: params.marketplace.type,
        enabled: params.marketplace.enabled !== false,
        pluginCount: plugins.length,
        ...(params.configSource != null ? { configSource: params.configSource } : {}),
        ...(marketplaceTitle != null ? { title: marketplaceTitle } : {})
      }
    }
  } catch (error) {
    return {
      plugins: [],
      source: {
        builtIn: params.builtIn,
        entry: params.marketplace,
        key: params.key,
        type: params.marketplace.type,
        enabled: params.marketplace.enabled !== false,
        pluginCount: 0,
        error: toErrorMessage(error),
        ...(params.configSource != null ? { configSource: params.configSource } : {})
      }
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

export const listPluginMarketplaceCatalog = async (): Promise<PluginMarketplaceCatalogResponse> => {
  const versionSources = new Map<string, ClaudeCodeMarketplacePluginSource>()
  const { globalSource, mergedConfig, projectSource, userSource, workspaceFolder } = await loadConfigState()
  const sourceConfigs: Record<PluginMarketplaceConfigSource, MarketplaceConfig> = {
    global: getMarketplaces(globalSource?.resolvedConfig),
    project: getMarketplaces(projectSource?.resolvedConfig),
    user: getMarketplaces(userSource?.resolvedConfig)
  }
  const effectiveMarketplaces = mergeMarketplaceConfigs(
    BUILT_IN_PLUGIN_MARKETPLACES,
    getMarketplaces(mergedConfig)
  ) ?? BUILT_IN_PLUGIN_MARKETPLACES
  const marketplaces = Object.entries(effectiveMarketplaces)
    .sort(([left], [right]) => left.localeCompare(right))

  const results = await Promise.all(
    marketplaces.map(([key, marketplace]) =>
      loadMarketplacePlugins({
        builtIn: BUILT_IN_PLUGIN_MARKETPLACES[key] != null,
        configSource: getMarketplaceConfigSource(sourceConfigs, key),
        cwd: workspaceFolder,
        key,
        marketplace,
        sourceConfigs,
        versionSources
      })
    )
  )

  return {
    plugins: results.flatMap(result => result.plugins),
    sources: results.map(result => result.source),
    versionGeneration: publishMarketplacePluginVersionSources(versionSources)
  }
}
