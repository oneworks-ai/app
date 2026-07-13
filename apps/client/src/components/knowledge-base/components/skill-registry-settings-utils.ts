import type { ConfigResponse, ConfigSection } from '@oneworks/types'

import type { SkillHubConfigSource, SkillHubRegistrySummary } from '#~/api.js'

export interface ManagedSkillRegistry {
  configSource: SkillHubConfigSource
  description?: string
  enabled: boolean
  index: number
  key: string
  kind: 'builtIn' | 'configured' | 'legacy'
  registry?: string
  source: string
  title?: string
}

const CONFIG_SOURCES: SkillHubConfigSource[] = ['global', 'project', 'user']

const normalizeNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

export const collectManagedSkillRegistries = (
  configRes?: ConfigResponse,
  resolvedRegistries: SkillHubRegistrySummary[] = []
): ManagedSkillRegistry[] => {
  const builtIns = resolvedRegistries
    .filter(registry => registry.builtIn === true)
    .map((registry): ManagedSkillRegistry => ({
      configSource: registry.configSource,
      description: normalizeNonEmptyString(registry.description),
      enabled: registry.enabled,
      index: -1,
      key: `builtIn:${registry.source}`,
      kind: 'builtIn',
      registry: normalizeNonEmptyString(registry.registry),
      source: registry.source,
      title: normalizeNonEmptyString(registry.title)
    }))
  const builtInSources = new Set(builtIns.map(registry => registry.source))
  const configured = CONFIG_SOURCES.flatMap((configSource) => {
    const general = configRes?.sources?.[configSource]?.general
    const configured = (general?.skillRegistries ?? []).flatMap((entry, index) => {
      const source = normalizeNonEmptyString(entry.source)
      if (source == null || builtInSources.has(source)) return []
      return [{
        configSource,
        description: normalizeNonEmptyString(entry.description),
        enabled: entry.enabled !== false,
        index,
        key: `${configSource}:configured:${source}:${index}`,
        kind: 'configured' as const,
        registry: normalizeNonEmptyString(entry.registry),
        source,
        title: normalizeNonEmptyString(entry.title)
      }]
    })
    const configuredSources = new Set(configured.map(entry => entry.source))
    const legacy = (general?.skillsMeta?.sources ?? []).flatMap((value, index) => {
      const source = normalizeNonEmptyString(value)
      if (source == null || configuredSources.has(source) || builtInSources.has(source)) return []
      return [{
        configSource,
        enabled: true,
        index,
        key: `${configSource}:legacy:${source}:${index}`,
        kind: 'legacy' as const,
        source
      }]
    })
    return [...configured, ...legacy]
  })

  return [...builtIns, ...configured]
}

export const buildBuiltInSkillRegistryToggleValue = (
  general: ConfigSection['general'] | undefined,
  source: string,
  enabled: boolean,
  inheritedEnabled = true
) => {
  const current = general?.skillRegistries ?? []
  const hasEntry = current.some(entry => entry.source.trim() === source)
  return {
    skillRegistries: hasEntry
      ? current.flatMap((entry) => {
        if (entry.source.trim() !== source) return [entry]
        const isToggleOnly = Object.keys(entry).every(key => key === 'source' || key === 'enabled')
        if (enabled && inheritedEnabled && isToggleOnly) return []
        return [{ ...entry, enabled }]
      })
      : [...current, { source, enabled }]
  }
}

export const resolveInheritedBuiltInRegistryEnabled = (
  configRes: ConfigResponse | undefined,
  configSource: SkillHubConfigSource,
  source: string
) => {
  const sourceIndex = CONFIG_SOURCES.indexOf(configSource)
  let globalConfigDisabled = false
  for (const sourceKey of CONFIG_SOURCES) {
    const nextValue = configRes?.sources?.[sourceKey]?.general?.disableGlobalConfig
    if (nextValue != null) globalConfigDisabled = nextValue
  }
  let enabled = true

  for (const lowerSource of CONFIG_SOURCES.slice(0, sourceIndex)) {
    if (lowerSource === 'global' && globalConfigDisabled) continue
    for (const registry of configRes?.sources?.[lowerSource]?.general?.skillRegistries ?? []) {
      if (registry.source.trim() === source && registry.enabled != null) {
        enabled = registry.enabled
      }
    }
  }

  return enabled
}

export const buildSkillRegistryRemovalValue = (
  general: ConfigSection['general'] | undefined,
  registry: ManagedSkillRegistry
) => {
  if (registry.kind === 'builtIn') {
    return {}
  }
  if (registry.kind === 'configured') {
    return {
      skillRegistries: (general?.skillRegistries ?? []).filter((_, index) => index !== registry.index)
    }
  }

  return {
    skillsMeta: {
      ...(general?.skillsMeta ?? {}),
      sources: (general?.skillsMeta?.sources ?? []).filter((_, index) => index !== registry.index)
    }
  }
}
