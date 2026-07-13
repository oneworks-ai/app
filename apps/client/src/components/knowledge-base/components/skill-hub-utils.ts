import type { SkillHubConfigSource, SkillSummary } from '#~/api.js'

export interface RegistryFormValues {
  configSource: SkillHubConfigSource
  source: string
  registry?: string
  title?: string
}

interface SkillRegistriesConfigEntry {
  title?: string
  source?: string
  registry?: string
}

interface SkillsMetaConfigValue {
  registries?: unknown
  sources?: unknown
}

export const ALL_REGISTRIES = 'all'
export const ALL_SKILL_SOURCES = 'all'

export type SkillHubInstallFilter = 'all' | 'installed' | 'notInstalled'
export type SkillHubSortKey = 'default' | 'nameAsc' | 'nameDesc'
export type ProjectSkillScope = 'all' | 'project' | 'global'

export const PROJECT_SKILLS_PAGE_SIZE = 20

export const isSkillHubInstallFilter = (value: string): value is SkillHubInstallFilter => (
  value === 'all' || value === 'installed' || value === 'notInstalled'
)

export const isSkillHubSortKey = (value: string): value is SkillHubSortKey => (
  value === 'default' || value === 'nameAsc' || value === 'nameDesc'
)

const normalizeNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const isSkillRegistriesConfigEntry = (
  value: unknown
): value is SkillRegistriesConfigEntry => (
  value != null &&
  !Array.isArray(value) &&
  typeof value === 'object'
)

export const buildSkillRegistriesValue = (
  currentSkillRegistries: unknown,
  values: RegistryFormValues
) => {
  const currentRegistries = Array.isArray(currentSkillRegistries)
    ? currentSkillRegistries.filter(isSkillRegistriesConfigEntry)
    : []

  return [
    ...currentRegistries,
    {
      source: values.source.trim(),
      ...(normalizeNonEmptyString(values.registry) == null
        ? {}
        : { registry: normalizeNonEmptyString(values.registry) }),
      ...(normalizeNonEmptyString(values.title) == null ? {} : { title: normalizeNonEmptyString(values.title) })
    }
  ]
}

const toStringList = (value: unknown) => (
  Array.isArray(value)
    ? value
      .map(normalizeNonEmptyString)
      .filter((item): item is string => item != null)
    : []
)

export const buildSkillsMetaValue = (
  currentSkillsMeta: unknown,
  values: RegistryFormValues
) => {
  const current = isSkillRegistriesConfigEntry(currentSkillsMeta)
    ? currentSkillsMeta as SkillsMetaConfigValue
    : {}
  const sources = Array.from(new Set([...toStringList(current.sources), values.source.trim()]))
  const registry = normalizeNonEmptyString(values.registry)
  const registries = registry == null
    ? toStringList(current.registries)
    : Array.from(new Set([...toStringList(current.registries), registry]))

  return {
    ...current,
    sources,
    ...(registries.length === 0 ? {} : { registries })
  }
}

export const joinValues = (values: string[]) => values.filter(Boolean).join(' · ')

export const filterProjectSkills = (skills: SkillSummary[], query: string) => {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery === '') return skills

  return skills.filter((skill) => {
    const haystack = `${skill.name} ${skill.description} ${skill.id} ${skill.sourceDetail.configLabel ?? ''}`
      .toLowerCase()
    return haystack.includes(normalizedQuery)
  })
}

export const filterProjectSkillsByScope = (
  skills: SkillSummary[],
  scope: ProjectSkillScope
) =>
  skills.filter((skill) => {
    if (scope === 'all') return true
    const isGlobal = skill.sourceDetail.kind === 'globalConfig' || skill.sourceDetail.kind === 'home'
    return scope === 'global' ? isGlobal : !isGlobal
  })

export const paginateProjectSkills = (
  skills: SkillSummary[],
  page: number,
  pageSize = PROJECT_SKILLS_PAGE_SIZE
) => {
  const normalizedPage = Math.max(1, page)
  const offset = (normalizedPage - 1) * pageSize
  return skills.slice(offset, offset + pageSize)
}
