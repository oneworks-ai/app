import { relative } from 'node:path'

import { resolveDefinitionName, resolveDocumentDescription } from '@oneworks/definition-core'
import type { ConfigSource, Definition, DefinitionSource, Skill } from '@oneworks/types'

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
