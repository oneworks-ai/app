import { loadConfigState } from '#~/services/config/index.js'

import { BUILT_IN_SKILL_REGISTRIES } from './built-in-skill-registries'
import { resolveSkillHubRegistries, toRegistrySummary } from './skills-cli-shared'
import type { SkillHubRegistriesResult } from './types'

const BUILT_IN_SKILL_REGISTRIES_BY_SOURCE = new Map(
  BUILT_IN_SKILL_REGISTRIES.map(registry => [registry.source, registry])
)

export const listSkillHubRegistries = async (): Promise<SkillHubRegistriesResult> => {
  const state = await loadConfigState()
  const registries = resolveSkillHubRegistries({
    state,
    workspaceFolder: state.workspaceFolder
  })
  const registryBySource = new Map(registries.map(registry => [registry.source, registry]))
  const builtIns = BUILT_IN_SKILL_REGISTRIES.flatMap((builtIn) => {
    const registry = registryBySource.get(builtIn.source)
    if (registry == null) return []
    return [toRegistrySummary({ ...builtIn, ...registry, builtIn: true })]
  })
  const custom = registries
    .filter(registry => !BUILT_IN_SKILL_REGISTRIES_BY_SOURCE.has(registry.source))
    .map(toRegistrySummary)

  return { registries: [...builtIns, ...custom] }
}
