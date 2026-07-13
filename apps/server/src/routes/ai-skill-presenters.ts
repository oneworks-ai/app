import { relative } from 'node:path'

import { resolveDefinitionName, resolveDocumentDescription } from '@oneworks/definition-core'
import type { ConfigSource, Definition, DefinitionSource, NativeHostSkill, Skill } from '@oneworks/types'

const toRelativePath = (absolutePath: string, cwd: string) => {
  const rel = relative(cwd, absolutePath)
  return rel.startsWith('..') ? absolutePath : rel
}

const resolveSkillSummary = (skill: Definition<Skill>) => {
  const name = resolveDefinitionName(skill, ['skill.md'])
  return {
    name,
    description: resolveDocumentDescription(skill.body, skill.attributes.description, name)
  }
}

const resolveSkillSource = (skill: Definition<Skill>): DefinitionSource => skill.resolvedSource ?? 'project'

export type PresentedSkillSourceKind =
  | 'globalConfig'
  | 'projectConfig'
  | 'userConfig'
  | 'projectDefault'
  | 'plugin'
  | 'home'

export interface PresentedSkillSourceDetail {
  configLabel?: string
  configSource?: ConfigSource
  kind: PresentedSkillSourceKind
}

export const presentSkill = (
  skill: Definition<Skill>,
  cwd: string,
  sourceDetail?: PresentedSkillSourceDetail
) => {
  const { name, description } = resolveSkillSummary(skill)
  return {
    id: toRelativePath(skill.path, cwd),
    name,
    description,
    always: skill.attributes.always ?? false,
    instancePath: skill.resolvedInstancePath,
    source: resolveSkillSource(skill),
    sourceDetail: sourceDetail ?? {
      kind: resolveSkillSource(skill) === 'plugin'
        ? 'plugin'
        : resolveSkillSource(skill) === 'home'
        ? 'home'
        : 'projectDefault'
    }
  }
}

export const presentSkillDetail = (
  skill: Definition<Skill>,
  cwd: string,
  sourceDetail?: PresentedSkillSourceDetail
) => ({
  ...presentSkill(skill, cwd, sourceDetail),
  body: skill.body ?? ''
})

export const presentNativeHostSkill = (skill: NativeHostSkill) => ({
  id: `native:${skill.id}`,
  name: skill.name,
  description: skill.description ?? '',
  always: false,
  source: skill.scope === 'global' ? 'home' as const : 'project' as const,
  sourceDetail: {
    kind: skill.scope === 'global' ? 'home' as const : 'projectDefault' as const,
    configLabel: `${skill.adapter} · ${skill.source.displayPath ?? skill.source.id}`
  }
})

export const presentNativeHostSkillDetail = (skill: NativeHostSkill) => ({
  ...presentNativeHostSkill(skill),
  body: skill.body
})
