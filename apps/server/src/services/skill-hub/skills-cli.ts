import { resolveWritableConfigPath, updateConfigFile } from '@oneworks/config'
import { installProjectSkill, readProjectSkills, resolveConfiguredSkillInstalls } from '@oneworks/utils'
import { parseSkillsCliListOutput } from '@oneworks/utils/skills-cli'

import { loadConfigState } from '#~/services/config/index.js'
import { createWorkspaceRuntimeEnv } from '#~/services/runtime-store/workspace-env.js'

import { getResolvedSourceConfig, toConfigLabel } from './config-source'
import { mapWithConcurrency } from './map-with-concurrency'
import { resolveSkillInstallConfigUpdate, resolveSkillInstallConfigValue } from './skill-install-validation'
import { searchSkillsCliRegistry } from './skills-cli-registry-search'
import {
  ALL_REGISTRIES,
  normalizeNonEmptyString,
  normalizeSearchLimit,
  resolveSkillHubRegistries,
  toDeclaredSkillEntry,
  toRegistrySummary
} from './skills-cli-shared'
import type {
  SkillHubInstallResult,
  SkillHubInstallTarget,
  SkillHubItem,
  SkillHubRegistrySummary,
  SkillHubSearchResult
} from './types'

export { parseSkillsCliListOutput }

const SKILL_REGISTRY_SEARCH_CONCURRENCY = 3
const normalizeSearchOffset = (offset: number | undefined) => (
  offset == null || !Number.isFinite(offset) ? 0 : Math.max(Math.trunc(offset), 0)
)

export const searchSkillHub = async (params: {
  installFilter?: string
  includeBuiltIns?: boolean
  limit?: number
  offset?: number
  query?: string
  registry?: string
  sort?: string
  source?: string
} = {}): Promise<SkillHubSearchResult> => {
  const state = await loadConfigState()
  const registries = resolveSkillHubRegistries({
    includeBuiltIns: params.includeBuiltIns,
    state,
    workspaceFolder: state.workspaceFolder
  })
  const registryFilter = normalizeNonEmptyString(params.registry) ?? ALL_REGISTRIES
  const filteredRegistries = registryFilter === ALL_REGISTRIES
    ? registries
    : registries.filter(entry => entry.key === registryFilter)
  const targetRegistries = filteredRegistries.filter(entry => entry.enabled !== false)
  const limit = normalizeSearchLimit(params.limit)
  const offset = normalizeSearchOffset(params.offset)
  const query = params.query?.trim().toLowerCase() ?? ''
  const installedSkills = await readProjectSkills(state.workspaceFolder)
  const installedNames = new Set(
    installedSkills.flatMap(skill => [skill.dirName, skill.name]).filter(Boolean)
  )

  const summaries = new Map<string, SkillHubRegistrySummary>()
  for (const registryEntry of registries) {
    summaries.set(registryEntry.key, toRegistrySummary(registryEntry))
  }
  if (registryFilter !== ALL_REGISTRIES && !summaries.has(registryFilter)) {
    summaries.set(registryFilter, {
      id: registryFilter,
      name: registryFilter,
      type: 'skills-cli',
      enabled: false,
      searchable: false,
      source: '',
      configSource: 'project',
      configLabel: toConfigLabel(state.workspaceFolder, 'project'),
      error: 'Registry was not found.'
    })
  }

  const declaredSkillsBySource = new Map(
    (['global', 'project', 'user'] as const).map(configSource => [
      configSource,
      resolveConfiguredSkillInstalls(getResolvedSourceConfig(state, configSource)?.skills)
    ])
  )
  const searchResults = await mapWithConcurrency(
    targetRegistries,
    SKILL_REGISTRY_SEARCH_CONCURRENCY,
    async (registryEntry) => {
      return searchSkillsCliRegistry({ declaredSkillsBySource, installedNames, query, registryEntry })
    }
  )

  const items: SkillHubItem[] = []
  for (const result of searchResults) {
    summaries.set(result.registry.id, result.registry)
    items.push(...result.items)
  }

  const sources = Array.from(new Set(items.map(item => item.source))).sort((left, right) => left.localeCompare(right))
  const sourceFilter = normalizeNonEmptyString(params.source) ?? ALL_REGISTRIES
  const filteredItems = items.filter((item) => {
    if (sourceFilter !== ALL_REGISTRIES && item.source !== sourceFilter) return false
    if (params.installFilter === 'installed' && !item.installed) return false
    if (params.installFilter === 'notInstalled' && item.installed) return false
    return true
  })
  const sortedItems = filteredItems.sort((left, right) => {
    if (params.sort === 'nameAsc') return left.name.localeCompare(right.name)
    if (params.sort === 'nameDesc') return right.name.localeCompare(left.name)
    return left.registryName.localeCompare(right.registryName) || left.name.localeCompare(right.name)
  })
  const total = sortedItems.length

  return {
    ...(offset + limit < total ? { hasMore: true } : {}),
    registries: Array.from(summaries.values()),
    items: sortedItems.slice(offset, offset + limit),
    sources,
    total
  }
}

export const installSkillHubItem = async (params: {
  force?: boolean
  registry: string
  skill: string
  target?: SkillHubInstallTarget
  workspaceFolder?: string
}): Promise<SkillHubInstallResult> => {
  const state = await loadConfigState(params.workspaceFolder)
  const registries = resolveSkillHubRegistries({
    state,
    workspaceFolder: state.workspaceFolder
  })
  const registryEntry = registries.find(entry => entry.key === params.registry && entry.enabled !== false)

  if (registryEntry == null) {
    throw new Error(`Skill registry "${params.registry}" was not found.`)
  }

  const target = params.target ?? registryEntry.configSource
  const declaredSkill = toDeclaredSkillEntry(registryEntry, params.skill)
  const configUpdate = resolveSkillInstallConfigUpdate({
    declaredSkill,
    force: params.force,
    state,
    target,
    workspaceFolder: state.workspaceFolder
  })

  let configPath = resolveWritableConfigPath(state.workspaceFolder, target)
  const installResult = await installProjectSkill({
    ...(configUpdate.alreadyConfigured
      ? {}
      : {
        commit: async () => {
          configPath = (await updateConfigFile({
            workspaceFolder: state.workspaceFolder,
            source: target,
            section: 'general',
            resolveValue: currentConfig => ({
              skills: resolveSkillInstallConfigValue({
                currentSkills: currentConfig.skills,
                declaredSkill,
                target,
                workspaceFolder: state.workspaceFolder
              })
            })
          })).configPath
        }
      }),
    env: createWorkspaceRuntimeEnv(state.workspaceFolder),
    force: params.force === true,
    registry: registryEntry.effectiveRegistry,
    skill: declaredSkill,
    workspaceFolder: state.workspaceFolder
  })

  return {
    registry: registryEntry.key,
    registryName: registryEntry.title ?? registryEntry.source,
    configSource: target,
    configLabel: toConfigLabel(state.workspaceFolder, target),
    configPath,
    source: registryEntry.source,
    skill: params.skill,
    name: installResult.name,
    installedAt: new Date().toISOString(),
    installDir: installResult.installDir
  }
}
