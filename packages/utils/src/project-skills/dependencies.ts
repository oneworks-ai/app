import { readFile } from 'node:fs/promises'

import type { ConfiguredSkillInstallConfig } from '@oneworks/types'
import { load } from 'js-yaml'

import { formatSkillsSpec, parseSkillsSpec } from '../skills-spec'
import { normalizeNonEmptyString } from './shared'

export interface NormalizedProjectSkillDependency {
  ref: string
  name: string
  registry?: string
  source?: string
  version?: string
}

const parseFrontmatterDependencies = (content: string) => {
  if (!content.startsWith('---')) return {}
  const endIndex = content.indexOf('\n---', 3)
  if (endIndex < 0) return []
  const metadata = load(content.slice(3, endIndex))
  return metadata != null && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>).dependencies
    : []
}

export const normalizeProjectSkillDependency = (
  value: string | ConfiguredSkillInstallConfig | unknown
): NormalizedProjectSkillDependency | undefined => {
  if (typeof value === 'string') {
    return parseSkillsSpec(value)
  }

  if (value == null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const name = normalizeNonEmptyString(record.name)
  if (name == null) return undefined
  const registry = normalizeNonEmptyString(record.registry)
  const source = normalizeNonEmptyString(record.source)
  const version = normalizeNonEmptyString(record.version)

  return {
    ref: formatSkillsSpec({
      name,
      registry,
      source,
      version
    }),
    name,
    ...(registry == null ? {} : { registry }),
    ...(source == null ? {} : { source }),
    ...(version == null ? {} : { version })
  }
}

export const readProjectSkillDependencies = async (skillPath: string) => {
  const content = await readFile(skillPath, 'utf8')
  const dependencies = parseFrontmatterDependencies(content)
  return Array.isArray(dependencies)
    ? dependencies
      .map(normalizeProjectSkillDependency)
      .filter((dependency): dependency is NormalizedProjectSkillDependency => dependency != null)
    : []
}
