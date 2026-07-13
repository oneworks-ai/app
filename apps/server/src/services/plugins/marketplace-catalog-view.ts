import type {
  ClaudeCodeMarketplacePluginDefinition,
  ClaudeCodeMarketplacePluginSource,
  MarketplaceConfigEntry,
  PluginMarketplaceCatalogPlugin,
  PluginMarketplaceConfigSource,
  PluginMarketplacePluginSourceType
} from '@oneworks/types'

const normalizeNonEmptyString = (value: string | undefined) => {
  const normalized = value?.trim()
  return normalized === '' ? undefined : normalized
}

const SEMVER_TAG_PATTERN = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/u

const getSemanticVersionFromRef = (ref: string | undefined) => {
  const normalized = normalizeNonEmptyString(ref)?.replace(/^refs\/tags\//u, '')
  if (normalized == null) return undefined
  return SEMVER_TAG_PATTERN.exec(normalized)?.[1]
}

export const resolveMarketplacePluginVersion = (
  plugin: ClaudeCodeMarketplacePluginDefinition
) => {
  const declaredVersion = normalizeNonEmptyString(plugin.version)
  if (declaredVersion != null) return declaredVersion
  if (typeof plugin.source === 'string') return undefined

  if (plugin.source.source === 'npm') {
    return normalizeNonEmptyString(plugin.source.version)
  }
  return getSemanticVersionFromRef(plugin.source.ref)
}

export const getPluginSourceSummary = (
  source: ClaudeCodeMarketplacePluginSource
): { label: string; type: PluginMarketplacePluginSourceType } => {
  if (typeof source === 'string') return { label: source, type: 'path' }

  switch (source.source) {
    case 'github':
      return { label: source.repo, type: 'github' }
    case 'git-subdir':
      return { label: [source.url, source.path].filter(Boolean).join(' · '), type: 'git-subdir' }
    case 'npm':
      return {
        label: source.version != null ? `${source.package}@${source.version}` : source.package,
        type: 'npm'
      }
    case 'url':
      return { label: source.url, type: 'url' }
  }
}

const toStringList = (value: string | string[] | undefined) => (
  typeof value === 'string' ? [value] : value
)

export const toCatalogPlugin = (params: {
  builtIn: boolean
  source: { label: string; type: PluginMarketplacePluginSourceType }
  configSource?: PluginMarketplaceConfigSource
  marketplace: MarketplaceConfigEntry
  marketplaceKey: string
  marketplaceTitle?: string
  installedSources?: PluginMarketplaceConfigSource[]
  version?: string
  plugin:
    & Pick<
      ClaudeCodeMarketplacePluginDefinition,
      'agents' | 'commands' | 'description' | 'name' | 'skills' | 'version'
    >
    & {
      displayName?: string
      featured?: boolean
      icon?: PluginMarketplaceCatalogPlugin['icon']
      installable?: boolean
      nativeEnabled?: boolean
      nativeInstalled?: boolean
    }
}): PluginMarketplaceCatalogPlugin => {
  const pluginConfig = params.marketplace.plugins?.[params.plugin.name]
  const version = normalizeNonEmptyString(params.version ?? params.plugin.version)
  return {
    builtIn: params.builtIn,
    marketplace: params.marketplaceKey,
    marketplaceType: params.marketplace.type,
    marketplaceEnabled: params.marketplace.enabled !== false,
    name: params.plugin.name,
    declared: pluginConfig != null,
    enabled: params.marketplace.enabled !== false && pluginConfig != null && pluginConfig.enabled !== false,
    sourceType: params.source.type,
    sourceLabel: params.source.label,
    ...(params.configSource != null ? { configSource: params.configSource } : {}),
    ...(params.marketplaceTitle != null ? { marketplaceTitle: params.marketplaceTitle } : {}),
    ...(params.installedSources != null && params.installedSources.length > 0
      ? { installedSources: params.installedSources }
      : {}),
    ...(params.plugin.description != null ? { description: params.plugin.description } : {}),
    ...(params.plugin.displayName != null ? { displayName: params.plugin.displayName } : {}),
    ...(params.plugin.featured != null ? { featured: params.plugin.featured } : {}),
    ...(params.plugin.icon != null ? { icon: params.plugin.icon } : {}),
    ...(params.plugin.installable != null ? { installable: params.plugin.installable } : {}),
    ...(params.plugin.nativeEnabled != null ? { nativeEnabled: params.plugin.nativeEnabled } : {}),
    ...(params.plugin.nativeInstalled != null ? { nativeInstalled: params.plugin.nativeInstalled } : {}),
    ...(version != null ? { version } : {}),
    ...(toStringList(params.plugin.skills) != null ? { skills: toStringList(params.plugin.skills) } : {}),
    ...(toStringList(params.plugin.commands) != null ? { commands: toStringList(params.plugin.commands) } : {}),
    ...(toStringList(params.plugin.agents) != null ? { agents: toStringList(params.plugin.agents) } : {})
  }
}
