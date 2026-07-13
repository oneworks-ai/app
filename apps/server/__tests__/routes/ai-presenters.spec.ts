import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { Definition, Entity, Rule, Skill, Spec } from '@oneworks/types'

import {
  matchesDefinitionPath,
  presentEntity,
  presentRule,
  presentSpec,
  presentSpecDetail
} from '#~/routes/ai-presenters.js'
import { presentSkill, presentSkillDetail } from '#~/routes/ai-skill-presenters.js'

describe('ai presenters', () => {
  const cwd = '/workspace/project'

  it('presents specs with shared naming and description rules', () => {
    const spec: Definition<Spec> = {
      path: join(cwd, '.oo/specs/release/index.md'),
      body: '发布流程\n执行发布',
      attributes: {
        skills: ['research'],
        rules: ['.oo/rules/release.md']
      }
    }

    expect(presentSpec(spec, cwd)).toEqual({
      id: '.oo/specs/release/index.md',
      name: 'release',
      description: '发布流程',
      params: [],
      always: true,
      tags: [],
      skills: ['research'],
      rules: ['.oo/rules/release.md'],
      source: 'project'
    })
    expect(presentSpecDetail(spec, cwd).body).toBe('发布流程\n执行发布')
  })

  it('presents entities with mixed skill and rule reference forms', () => {
    const entity: Definition<Entity> = {
      path: join(cwd, '.oo/entities/reviewer/README.md'),
      body: '负责代码评审',
      attributes: {
        skills: {
          type: 'include',
          list: ['review']
        },
        rules: [
          {
            path: './rules/checklist.md',
            desc: '评审检查清单'
          },
          {
            type: 'remote',
            tags: ['security']
          }
        ]
      }
    }

    expect(presentEntity(entity, cwd)).toEqual({
      id: '.oo/entities/reviewer/README.md',
      name: 'reviewer',
      description: '负责代码评审',
      always: true,
      tags: [],
      skills: ['review'],
      rules: ['评审检查清单', 'remote:security'],
      source: 'project'
    })
  })

  it('presents rules with alwaysApply compatibility and path matching', () => {
    const rule: Definition<Rule> = {
      path: join(cwd, '.oo/rules/base.md'),
      body: '始终检查边界',
      attributes: {
        alwaysApply: true,
        globs: 'src/**/*.ts'
      }
    }

    expect(presentRule(rule, cwd)).toEqual({
      id: '.oo/rules/base.md',
      name: 'base',
      description: '始终检查边界',
      always: true,
      globs: ['src/**/*.ts'],
      source: 'project'
    })
    expect(matchesDefinitionPath(rule, '.oo/rules/base.md', cwd)).toBe(true)
    expect(matchesDefinitionPath(rule, rule.path, cwd)).toBe(true)
    expect(matchesDefinitionPath(rule, '.oo/rules/missing.md', cwd)).toBe(false)
  })

  it('marks plugin-provided assets as plugin scoped', () => {
    const spec: Definition<Spec> = {
      path: join(cwd, 'node_modules/plugin/specs/release/index.md'),
      body: '插件流程',
      attributes: {},
      resolvedSource: 'plugin'
    }
    const entity: Definition<Entity> = {
      path: join(cwd, 'node_modules/plugin/entities/reviewer/README.md'),
      body: '插件实体',
      attributes: {},
      resolvedSource: 'plugin'
    }
    const rule: Definition<Rule> = {
      path: join(cwd, 'node_modules/plugin/rules/base.md'),
      body: '插件规则',
      attributes: {},
      resolvedSource: 'plugin'
    }

    expect(presentSpec(spec, cwd).source).toBe('plugin')
    expect(presentEntity(entity, cwd).source).toBe('plugin')
    expect(presentRule(rule, cwd).source).toBe('plugin')
  })

  it('presents skill sources for project, plugin, and home entries', () => {
    const projectSkill: Definition<Skill> = {
      path: join(cwd, '.oo/skills/research/SKILL.md'),
      body: '阅读 README.md',
      attributes: {}
    }
    const pluginSkill: Definition<Skill> = {
      path: join(cwd, 'node_modules/@oneworks/plugin-demo/skills/review/SKILL.md'),
      body: '检查风险',
      attributes: {},
      resolvedInstancePath: 'plugins.demo',
      resolvedSource: 'plugin'
    }
    const homeSkill: Definition<Skill> = {
      path: '/Users/demo/.agents/skills/home-bridge/SKILL.md',
      body: '整理本地偏好',
      attributes: {},
      resolvedSource: 'home'
    }

    expect(presentSkill(projectSkill, cwd)).toEqual({
      id: '.oo/skills/research/SKILL.md',
      name: 'research',
      description: '阅读 README.md',
      always: false,
      instancePath: undefined,
      source: 'project',
      sourceDetail: {
        kind: 'projectDefault'
      }
    })
    expect(presentSkill(pluginSkill, cwd)).toEqual({
      id: 'node_modules/@oneworks/plugin-demo/skills/review/SKILL.md',
      name: 'review',
      description: '检查风险',
      always: false,
      instancePath: 'plugins.demo',
      source: 'plugin',
      sourceDetail: {
        kind: 'plugin'
      }
    })
    expect(presentSkillDetail(homeSkill, cwd)).toEqual({
      id: '/Users/demo/.agents/skills/home-bridge/SKILL.md',
      name: 'home-bridge',
      description: '整理本地偏好',
      always: false,
      instancePath: undefined,
      source: 'home',
      sourceDetail: {
        kind: 'home'
      },
      body: '整理本地偏好'
    })
  })
})
