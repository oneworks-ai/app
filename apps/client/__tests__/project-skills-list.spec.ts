import { describe, expect, it } from 'vitest'

import type { SkillSummary } from '#~/api.js'
import {
  PROJECT_SKILLS_PAGE_SIZE,
  filterProjectSkills,
  filterProjectSkillsByScope,
  paginateProjectSkills
} from '#~/components/knowledge-base/components/skill-hub-utils'

const createSkill = (
  name: string,
  kind: SkillSummary['sourceDetail']['kind']
): SkillSummary => ({
  always: false,
  description: `${name} description`,
  id: `/skills/${name}/SKILL.md`,
  name,
  source: kind === 'home' ? 'home' : kind === 'plugin' ? 'plugin' : 'project',
  sourceDetail: { kind }
})

describe('project skills list helpers', () => {
  const skills = [
    createSkill('project-default', 'projectDefault'),
    createSkill('project-config', 'projectConfig'),
    createSkill('user-config', 'userConfig'),
    createSkill('plugin-skill', 'plugin'),
    createSkill('global-config', 'globalConfig'),
    createSkill('home-skill', 'home')
  ]

  it('separates project-scoped and global-scoped skills', () => {
    expect(filterProjectSkillsByScope(skills, 'all').map(skill => skill.name)).toEqual(
      skills.map(skill => skill.name)
    )
    expect(filterProjectSkillsByScope(skills, 'project').map(skill => skill.name)).toEqual([
      'project-default',
      'project-config',
      'user-config',
      'plugin-skill'
    ])
    expect(filterProjectSkillsByScope(skills, 'global').map(skill => skill.name)).toEqual([
      'global-config',
      'home-skill'
    ])
  })

  it('searches the selected scope by skill metadata', () => {
    const globalSkills = filterProjectSkillsByScope(skills, 'global')
    expect(filterProjectSkills(globalSkills, 'HOME-SKILL')).toHaveLength(1)
    expect(filterProjectSkills(globalSkills, 'plugin')).toHaveLength(0)
  })

  it('uses fixed twenty-item pages', () => {
    const manySkills = Array.from({ length: 42 }, (_, index) => createSkill(`skill-${index}`, 'projectDefault'))
    expect(PROJECT_SKILLS_PAGE_SIZE).toBe(20)
    expect(paginateProjectSkills(manySkills, 1)).toHaveLength(20)
    expect(paginateProjectSkills(manySkills, 3)).toHaveLength(2)
  })
})
