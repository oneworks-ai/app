import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { loadMarketplaceCatalogFromSource } from '@oneworks/adapter-claude-code/plugins'
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
  PluginMarketplaceConfigSource,
  PluginMarketplacePluginSourceType
} from '@oneworks/types'

import { loadConfigState } from '#~/services/config/index.js'

const configSourceOrder: PluginMarketplaceConfigSource[] = ['user', 'project', 'global']

const getMarketplaces = (config: Config | undefined): MarketplaceConfig => config?.marketplaces ?? {}

const getMarketplaceConfigSource = (
  sources: Record<PluginMarketplaceConfigSource, MarketplaceConfig>,
  key: string
) => configSourceOrder.find(source => sources[source][key] != null)

const toStringList = (value: string | string[] | undefined) => (
  typeof value === 'string'
    ? [value]
    : value
)

const toErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

const getPluginSourceSummary = (
  source: ClaudeCodeMarketplacePluginSource
): { label: string; type: PluginMarketplacePluginSourceType } => {
  if (typeof source === 'string') {
    return { label: source, type: 'path' }
  }

  switch (source.source) {
    case 'github':
      return { label: source.repo, type: 'github' }
    case 'git-subdir':
      return {
        label: [source.url, source.path].filter(Boolean).join(' · '),
        type: 'git-subdir'
      }
    case 'npm':
      return {
        label: source.version != null ? `${source.package}@${source.version}` : source.package,
        type: 'npm'
      }
    case 'url':
      return { label: source.url, type: 'url' }
  }
}

const toCatalogPlugin = (params: {
  configSource?: PluginMarketplaceConfigSource
  marketplace: MarketplaceConfigEntry
  marketplaceKey: string
  marketplaceTitle?: string
  plugin: ClaudeCodeMarketplacePluginDefinition
}): PluginMarketplaceCatalogPlugin => {
  const pluginConfig = params.marketplace.plugins?.[params.plugin.name]
  const source = getPluginSourceSummary(params.plugin.source)
  const enabled = params.marketplace.enabled !== false && pluginConfig != null && pluginConfig.enabled !== false
  return {
    marketplace: params.marketplaceKey,
    marketplaceEnabled: params.marketplace.enabled !== false,
    name: params.plugin.name,
    declared: pluginConfig != null,
    enabled,
    sourceType: source.type,
    sourceLabel: source.label,
    ...(params.configSource != null ? { configSource: params.configSource } : {}),
    ...(params.marketplaceTitle != null ? { marketplaceTitle: params.marketplaceTitle } : {}),
    ...(params.plugin.description != null ? { description: params.plugin.description } : {}),
    ...(params.plugin.version != null ? { version: params.plugin.version } : {}),
    ...(toStringList(params.plugin.skills) != null ? { skills: toStringList(params.plugin.skills) } : {}),
    ...(toStringList(params.plugin.commands) != null ? { commands: toStringList(params.plugin.commands) } : {}),
    ...(toStringList(params.plugin.agents) != null ? { agents: toStringList(params.plugin.agents) } : {})
  }
}

const loadMarketplacePlugins = async (params: {
  configSource?: PluginMarketplaceConfigSource
  cwd: string
  key: string
  marketplace: MarketplaceConfigEntry
}): Promise<{
  plugins: PluginMarketplaceCatalogPlugin[]
  source: PluginMarketplaceCatalogSource
}> => {
  const source = params.marketplace.options?.source
  if (source == null) {
    return {
      plugins: [],
      source: {
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
    const { catalog } = await loadMarketplaceCatalogFromSource(
      tempDir,
      source,
      params.key,
      (targetDir, managedSource) => installManagedPluginSource(targetDir, params.cwd, managedSource)
    )
    const plugins = catalog.plugins
      .map(plugin =>
        toCatalogPlugin({
          configSource: params.configSource,
          marketplace: params.marketplace,
          marketplaceKey: params.key,
          marketplaceTitle: catalog.name,
          plugin
        })
      )
      .sort((left, right) => left.name.localeCompare(right.name))
    return {
      plugins,
      source: {
        key: params.key,
        type: params.marketplace.type,
        enabled: params.marketplace.enabled !== false,
        pluginCount: plugins.length,
        ...(params.configSource != null ? { configSource: params.configSource } : {}),
        ...(catalog.name != null ? { title: catalog.name } : {})
      }
    }
  } catch (error) {
    return {
      plugins: [],
      source: {
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
  const { globalConfig, mergedConfig, projectConfig, userConfig, workspaceFolder } = await loadConfigState()
  const sourceConfigs: Record<PluginMarketplaceConfigSource, MarketplaceConfig> = {
    global: getMarketplaces(globalConfig),
    project: getMarketplaces(projectConfig),
    user: getMarketplaces(userConfig)
  }
  const marketplaces = Object.entries(getMarketplaces(mergedConfig))
    .sort(([left], [right]) => left.localeCompare(right))

  const results = await Promise.all(
    marketplaces.map(([key, marketplace]) =>
      loadMarketplacePlugins({
        configSource: getMarketplaceConfigSource(sourceConfigs, key),
        cwd: workspaceFolder,
        key,
        marketplace
      })
    )
  )

  return {
    plugins: results.flatMap(result => result.plugins),
    sources: results.map(result => result.source)
  }
}
