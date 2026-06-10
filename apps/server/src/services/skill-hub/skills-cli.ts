import { updateConfigFile } from '@oneworks/config'
import { installProjectSkill, readProjectSkills, resolveConfiguredSkillInstalls } from '@oneworks/utils'
import { listSkillsCliSource, parseSkillsCliListOutput, toSkillSlug } from '@oneworks/utils/skills-cli'

import { loadConfigState } from '#~/services/config/index.js'
import { createWorkspaceRuntimeEnv } from '#~/services/runtime-store/workspace-env.js'

import {
  ALL_REGISTRIES,
  buildInstalledSkillConfigValue,
  findDeclaredRegistrySkill,
  getRawSourceConfig,
  getSourceConfig,
  normalizeNonEmptyString,
  normalizeSearchLimit,
  resolveSkillHubRegistries,
  toConfigLabel,
  toDeclaredSkillEntry,
  toRegistrySummary
} from './skills-cli-shared'
import type { SkillHubInstallResult, SkillHubItem, SkillHubRegistrySummary, SkillHubSearchResult } from './types'

export { parseSkillsCliListOutput }

export const searchSkillHub = async (params: {
  limit?: number
  query?: string
  registry?: string
} = {}): Promise<SkillHubSearchResult> => {
  const state = await loadConfigState()
  const registries = resolveSkillHubRegistries({
    state,
    workspaceFolder: state.workspaceFolder
  })
  const registryFilter = normalizeNonEmptyString(params.registry) ?? ALL_REGISTRIES
  const targetRegistries = registryFilter === ALL_REGISTRIES
    ? registries
    : registries.filter(entry => entry.key === registryFilter)
  const limit = normalizeSearchLimit(params.limit)
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

  const items: SkillHubItem[] = []
  for (const registryEntry of targetRegistries) {
    const declaredSkills = resolveConfiguredSkillInstalls(
      getSourceConfig(state, registryEntry.configSource)?.skills
    )

    try {
      const listedSkills = await listSkillsCliSource({
        registry: registryEntry.effectiveRegistry,
        source: registryEntry.source
      })
      const filteredSkills = listedSkills.filter((skill) => {
        if (query === '') return true
        const haystack = `${skill.name} ${skill.description ?? ''}`.toLowerCase()
        return haystack.includes(query)
      })

      summaries.set(registryEntry.key, toRegistrySummary(registryEntry))
      items.push(
        ...filteredSkills.map((skill) => {
          const declared = findDeclaredRegistrySkill(declaredSkills, registryEntry, skill.name)
          const installed = declared != null ||
            installedNames.has(skill.name) ||
            installedNames.has(toSkillSlug(skill.name))

          return {
            id: `${registryEntry.key}:${skill.name}`,
            registry: registryEntry.key,
            registryName: registryEntry.title ?? registryEntry.source,
            configSource: registryEntry.configSource,
            configLabel: registryEntry.configLabel,
            name: skill.name,
            ...(skill.description == null ? {} : { description: skill.description }),
            skills: [],
            commands: [],
            agents: [],
            mcpServers: [],
            hasHooks: false,
            installed,
            declared: declared != null,
            installRef: skill.name,
            source: registryEntry.source
          } satisfies SkillHubItem
        })
      )
    } catch (error) {
      summaries.set(registryEntry.key, {
        ...toRegistrySummary(registryEntry),
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const sortedItems = items
    .sort((left, right) => (
      left.registryName.localeCompare(right.registryName) || left.name.localeCompare(right.name)
    ))

  return {
    ...(sortedItems.length > limit ? { hasMore: true } : {}),
    registries: Array.from(summaries.values()),
    items: sortedItems.slice(0, limit)
  }
}

export const installSkillHubItem = async (params: {
  force?: boolean
  registry: string
  skill: string
  workspaceFolder?: string
}): Promise<SkillHubInstallResult> => {
  const state = await loadConfigState(params.workspaceFolder)
  const registries = resolveSkillHubRegistries({
    state,
    workspaceFolder: state.workspaceFolder
  })
  const registryEntry = registries.find(entry => entry.key === params.registry)

  if (registryEntry == null) {
    throw new Error(`Skill registry "${params.registry}" was not found.`)
  }

  const sourceConfig = getSourceConfig(state, registryEntry.configSource)
  const rawSourceConfig = getRawSourceConfig(state, registryEntry.configSource)
  const declaredSkill = toDeclaredSkillEntry(registryEntry, params.skill)
  const duplicateCheck = buildInstalledSkillConfigValue({
    currentSkills: sourceConfig?.skills,
    declaredSkill
  })

  if (duplicateCheck.alreadyConfigured) {
    throw new Error(
      `Configured skill target "${
        duplicateCheck.duplicate ?? params.skill
      }" already exists in ${registryEntry.configLabel}.`
    )
  }
  const nextSkills = buildInstalledSkillConfigValue({
    currentSkills: rawSourceConfig?.skills,
    declaredSkill
  })

  const updateResult = await updateConfigFile({
    workspaceFolder: state.workspaceFolder,
    source: registryEntry.configSource,
    section: 'general',
    value: {
      skills: nextSkills.value
    }
  })
  const installResult = await installProjectSkill({
    env: createWorkspaceRuntimeEnv(state.workspaceFolder),
    force: params.force === true,
    registry: registryEntry.effectiveRegistry,
    skill: declaredSkill,
    workspaceFolder: state.workspaceFolder
  })

  return {
    registry: registryEntry.key,
    registryName: registryEntry.title ?? registryEntry.source,
    configSource: registryEntry.configSource,
    configLabel: registryEntry.configLabel,
    configPath: updateResult.configPath,
    source: registryEntry.source,
    skill: params.skill,
    name: installResult.name,
    installedAt: new Date().toISOString(),
    installDir: installResult.installDir
  }
}
