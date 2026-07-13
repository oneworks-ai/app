const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const optionalString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const stringList = (value: unknown) => (
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
)

export interface CodexAppServerPluginInterface {
  composerIcon?: string
  composerIconUrl?: string
  displayName?: string
  logo?: string
  logoUrl?: string
  longDescription?: string
  shortDescription?: string
}

export interface CodexAppServerPluginSummary {
  availability?: string
  enabled: boolean
  id: string
  installPolicy?: string
  installed: boolean
  interface?: CodexAppServerPluginInterface
  localVersion?: string
  name: string
  remotePluginId?: string
  remoteVersion?: string
  source: {
    path?: string
    type: 'git' | 'local' | 'remote'
  }
}

export interface CodexAppServerMarketplace {
  name: string
  path?: string
  plugins: CodexAppServerPluginSummary[]
  title?: string
}

export interface CodexAppServerPluginList {
  featuredPluginIds: string[]
  marketplaces: CodexAppServerMarketplace[]
}

const parsePluginInterface = (value: unknown): CodexAppServerPluginInterface | undefined => {
  if (!isRecord(value)) return undefined
  return {
    ...(optionalString(value.composerIcon) != null ? { composerIcon: optionalString(value.composerIcon) } : {}),
    ...(optionalString(value.composerIconUrl) != null
      ? { composerIconUrl: optionalString(value.composerIconUrl) }
      : {}),
    ...(optionalString(value.displayName) != null ? { displayName: optionalString(value.displayName) } : {}),
    ...(optionalString(value.logo) != null ? { logo: optionalString(value.logo) } : {}),
    ...(optionalString(value.logoUrl) != null ? { logoUrl: optionalString(value.logoUrl) } : {}),
    ...(optionalString(value.longDescription) != null
      ? { longDescription: optionalString(value.longDescription) }
      : {}),
    ...(optionalString(value.shortDescription) != null
      ? { shortDescription: optionalString(value.shortDescription) }
      : {})
  }
}

export const parseCodexAppServerPluginSummary = (
  value: unknown
): CodexAppServerPluginSummary | undefined => {
  if (!isRecord(value) || !isRecord(value.source)) return undefined
  const id = optionalString(value.id)
  const name = optionalString(value.name)
  const sourceType = value.source.type
  const shareContext = isRecord(value.shareContext) ? value.shareContext : undefined
  if (
    id == null ||
    name == null ||
    typeof value.enabled !== 'boolean' ||
    typeof value.installed !== 'boolean' ||
    (sourceType !== 'git' && sourceType !== 'local' && sourceType !== 'remote')
  ) return undefined
  return {
    ...(optionalString(value.availability) != null ? { availability: optionalString(value.availability) } : {}),
    enabled: value.enabled,
    id,
    installed: value.installed,
    name,
    source: {
      type: sourceType,
      ...(optionalString(value.source.path) != null ? { path: optionalString(value.source.path) } : {})
    },
    ...(optionalString(value.installPolicy) != null ? { installPolicy: optionalString(value.installPolicy) } : {}),
    ...(parsePluginInterface(value.interface) != null ? { interface: parsePluginInterface(value.interface) } : {}),
    ...(optionalString(value.localVersion) != null ? { localVersion: optionalString(value.localVersion) } : {}),
    ...(optionalString(value.remotePluginId) != null ? { remotePluginId: optionalString(value.remotePluginId) } : {}),
    ...(optionalString(shareContext?.remoteVersion) != null
      ? { remoteVersion: optionalString(shareContext?.remoteVersion) }
      : {})
  }
}

export const parseCodexAppServerPluginList = (value: unknown): CodexAppServerPluginList => {
  if (!isRecord(value) || !Array.isArray(value.marketplaces)) {
    throw new TypeError('Invalid Codex app-server plugin/list response.')
  }
  return {
    featuredPluginIds: stringList(value.featuredPluginIds),
    marketplaces: value.marketplaces.flatMap((marketplace) => {
      if (!isRecord(marketplace) || !Array.isArray(marketplace.plugins)) return []
      const name = optionalString(marketplace.name)
      if (name == null) return []
      const marketplaceInterface = isRecord(marketplace.interface) ? marketplace.interface : undefined
      return [{
        name,
        plugins: marketplace.plugins.flatMap(plugin => {
          const parsed = parseCodexAppServerPluginSummary(plugin)
          return parsed == null ? [] : [parsed]
        }),
        ...(optionalString(marketplace.path) != null ? { path: optionalString(marketplace.path) } : {}),
        ...(optionalString(marketplaceInterface?.displayName) != null
          ? { title: optionalString(marketplaceInterface?.displayName) }
          : {})
      }]
    })
  }
}
