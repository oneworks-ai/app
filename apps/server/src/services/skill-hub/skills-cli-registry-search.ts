import type { ConfigSource, ConfiguredSkillInstallConfig } from '@oneworks/types'
import { listSkillsCliSource, toSkillSlug } from '@oneworks/utils/skills-cli'

import { findDeclaredRegistrySkill, toRegistrySummary } from './skills-cli-shared'
import type { ResolvedConfiguredSkillRegistryEntry } from './skills-cli-shared'
import type { SkillHubItem } from './types'

export const SKILL_REGISTRY_SEARCH_TIMEOUT_MS = 30_000

export const searchSkillsCliRegistry = async (params: {
  declaredSkillsBySource: Map<ConfigSource, Array<string | ConfiguredSkillInstallConfig>>
  installedNames: ReadonlySet<string>
  query: string
  registryEntry: ResolvedConfiguredSkillRegistryEntry
}) => {
  const { declaredSkillsBySource, installedNames, query, registryEntry } = params
  try {
    const listedSkills = await listSkillsCliSource({
      registry: registryEntry.effectiveRegistry,
      source: registryEntry.source,
      timeoutMs: SKILL_REGISTRY_SEARCH_TIMEOUT_MS
    })
    const filteredSkills = listedSkills.filter((skill) => {
      if (query === '') return true
      const haystack = `${skill.name} ${skill.description ?? ''}`.toLowerCase()
      return haystack.includes(query)
    })

    return {
      items: filteredSkills.map((skill) => {
        const declaredSources = (['global', 'project', 'user'] as const).filter(configSource => (
          findDeclaredRegistrySkill(
            declaredSkillsBySource.get(configSource) ?? [],
            registryEntry,
            skill.name
          ) != null
        ))
        const installed = declaredSources.length > 0 ||
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
          declared: declaredSources.length > 0,
          declaredSources,
          ...(registryEntry.builtIn === true ? { builtIn: true } : {}),
          installRef: skill.name,
          source: registryEntry.source
        } satisfies SkillHubItem
      }),
      registry: toRegistrySummary(registryEntry)
    }
  } catch (error) {
    return {
      items: [] as SkillHubItem[],
      registry: {
        ...toRegistrySummary(registryEntry),
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }
}
