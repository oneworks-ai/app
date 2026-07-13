import type { ConfigSource, ResolvedConfigState } from '@oneworks/config'
import type { ConfiguredSkillInstallConfig, ConfiguredSkillRegistry } from '@oneworks/types'
import {
  buildSkillsConfigValue,
  isSameDeclaredSkill,
  matchesDeclaredSkillSelector,
  normalizeProjectSkillInstall,
  resolveConfiguredSkillInstalls,
  resolveConfiguredSkillRegistries,
  resolveSkillsMeta,
  resolveSkillsRegistry
} from '@oneworks/utils'
import { toSkillSlug } from '@oneworks/utils/skills-cli'

import { BUILT_IN_SKILL_REGISTRIES } from './built-in-skill-registries'
import { getSourceConfig, toConfigLabel } from './config-source'
import type { SkillHubRegistrySummary } from './types'

export const ALL_REGISTRIES = 'all'
export const DEFAULT_SEARCH_LIMIT = 100
export const MAX_SEARCH_LIMIT = 500
export interface ResolvedConfiguredSkillRegistryEntry extends ConfiguredSkillRegistry {
  builtIn?: boolean
  configLabel: string
  configSource: ConfigSource
  effectiveRegistry?: string
  key: string
}

const toRegistryKey = (configSource: ConfigSource, source: string) => `${configSource}:${source}`

export const normalizeSearchLimit = (limit: number | undefined) => {
  if (limit == null || !Number.isFinite(limit)) return DEFAULT_SEARCH_LIMIT
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_SEARCH_LIMIT)
}

export const normalizeNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

export const resolveSkillHubRegistries = (params: {
  includeBuiltIns?: boolean
  state: ResolvedConfigState
  workspaceFolder: string
}) => {
  const entries = new Map<string, ResolvedConfiguredSkillRegistryEntry>()

  for (const configSource of ['global', 'project', 'user'] as const) {
    const config = getSourceConfig(params.state, configSource)
    const defaultRegistry = resolveSkillsRegistry(config?.skills)
    const configLabel = toConfigLabel(params.workspaceFolder, configSource)

    for (const entry of resolveConfiguredSkillRegistries(config)) {
      const previous = entries.get(entry.source)
      const merged = { ...previous, ...entry }
      entries.set(entry.source, {
        ...entry,
        ...merged,
        configSource,
        configLabel,
        key: toRegistryKey(configSource, entry.source),
        ...(merged.registry == null && defaultRegistry == null && previous?.effectiveRegistry == null
          ? {}
          : { effectiveRegistry: merged.registry ?? defaultRegistry ?? previous?.effectiveRegistry })
      })
    }

    for (const source of resolveSkillsMeta(config)?.sources ?? []) {
      if (entries.has(source)) continue
      entries.set(source, {
        source,
        configSource,
        configLabel,
        key: toRegistryKey(configSource, source)
      })
    }
  }

  if (params.includeBuiltIns !== false) {
    const configSource = 'project' as const
    const configLabel = toConfigLabel(params.workspaceFolder, configSource)
    for (const registry of BUILT_IN_SKILL_REGISTRIES) {
      if (entries.has(registry.source)) continue
      entries.set(registry.source, {
        ...registry,
        builtIn: true,
        configSource,
        configLabel,
        key: toRegistryKey(configSource, registry.source)
      })
    }
  }

  return Array.from(entries.values())
}

export const findDeclaredRegistrySkill = (
  declared: Array<string | ConfiguredSkillInstallConfig>,
  registryEntry: ResolvedConfiguredSkillRegistryEntry,
  skillName: string
) => {
  const skillSlug = toSkillSlug(skillName)

  return declared.find((item) => {
    const normalized = normalizeProjectSkillInstall(item)
    if (normalized == null) return false
    if (normalized.source == null) return false
    if (normalized.source !== registryEntry.source) return false

    return normalized.name === skillName || toSkillSlug(normalized.name) === skillSlug
  })
}

export const toDeclaredSkillEntry = (
  registryEntry: ResolvedConfiguredSkillRegistryEntry,
  skillName: string
): ConfiguredSkillInstallConfig => ({
  name: skillName,
  source: registryEntry.source,
  ...(registryEntry.registry == null ? {} : { registry: registryEntry.registry })
})

export const toRegistrySummary = (
  registryEntry: ResolvedConfiguredSkillRegistryEntry
): SkillHubRegistrySummary => ({
  id: registryEntry.key,
  name: registryEntry.source,
  type: 'skills-cli',
  enabled: registryEntry.enabled !== false,
  searchable: registryEntry.enabled !== false,
  source: registryEntry.source,
  ...(registryEntry.registry == null ? {} : { registry: registryEntry.registry }),
  ...(registryEntry.title == null ? {} : { title: registryEntry.title }),
  ...(registryEntry.description == null ? {} : { description: registryEntry.description }),
  ...(registryEntry.builtIn === true ? { builtIn: true } : {}),
  configSource: registryEntry.configSource,
  configLabel: registryEntry.configLabel
})

export const buildInstalledSkillConfigValue = (params: {
  currentSkills: Parameters<typeof resolveConfiguredSkillInstalls>[0]
  declaredSkill: ConfiguredSkillInstallConfig
}) => {
  const configuredSkills = resolveConfiguredSkillInstalls(params.currentSkills)
  const normalized = normalizeProjectSkillInstall(params.declaredSkill)
  if (normalized == null) {
    throw new Error('Skill reference is required.')
  }

  const duplicate = configuredSkills.find(item => matchesDeclaredSkillSelector(normalized.targetName, item))
  if (duplicate != null && !isSameDeclaredSkill(duplicate, params.declaredSkill)) {
    return {
      alreadyConfigured: true,
      duplicate: normalized.targetName,
      value: undefined
    }
  }

  return {
    alreadyConfigured: duplicate != null,
    duplicate: undefined,
    value: buildSkillsConfigValue({
      items: duplicate == null ? [...configuredSkills, params.declaredSkill] : configuredSkills,
      current: params.currentSkills
    })
  }
}
