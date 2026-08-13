import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { generateRulesPrompt, generateSkillsPrompt } from '#~/prompt-builders.js'
import { resolveEntityInheritance, resolveRuleSelection } from '#~/selection-internal.js'
import { generateWorkspaceRoutePrompt } from '#~/workspace-prompt.js'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

describe('workspace asset prompt path identity', () => {
  it('keeps POSIX literal-backslash workspace, rule, and skill paths distinct in final prompts', () => {
    const cwd = '/workspace'
    const workspacePath = '/workspace/team\\secret'
    const rulePath = '/workspace/.oo/rules/rule\\file.md'
    const skillPath = '/workspace/.oo/skills/skill\\module/SKILL.md'
    const workspacePrompt = generateWorkspaceRoutePrompt(cwd, [{
      cwd: workspacePath,
      id: 'literal-backslash',
      path: '/workspace/.oo/workspaces/literal.md'
    }])
    const rulesPrompt = generateRulesPrompt(cwd, [{
      attributes: { description: 'Exact path' },
      body: 'Read it.',
      path: rulePath
    }])
    const skillsPrompt = generateSkillsPrompt(cwd, [{
      attributes: { description: 'Exact path' },
      body: 'Read it.',
      path: skillPath
    }])

    expect(workspacePrompt).toContain('team\\secret')
    expect(workspacePrompt).not.toContain('team/secret')
    expect(rulesPrompt).toContain('rule\\file.md')
    expect(rulesPrompt).not.toContain('rule/file.md')
    expect(skillsPrompt).toContain('skill\\module/SKILL.md')
    expect(skillsPrompt).not.toContain('skill/module/SKILL.md')
  })

  it('keeps contained dot-dot-prefixed rule and skill paths private in final prompts', () => {
    const cwd = '/workspace'
    const rulesPrompt = generateRulesPrompt(cwd, [{
      attributes: { description: 'Contained rule' },
      body: 'Read it.',
      path: '/workspace/..notes/rule.md'
    }])
    const skillsPrompt = generateSkillsPrompt(cwd, [{
      attributes: { description: 'Contained skill' },
      body: 'Read it.',
      path: '/workspace/..skills/review/SKILL.md'
    }])
    const outsideRulesPrompt = generateRulesPrompt(cwd, [{
      attributes: { description: 'Outside rule' },
      body: 'Read it.',
      path: '/outside/..notes/rule.md'
    }])
    const outsideSkillsPrompt = generateSkillsPrompt(cwd, [{
      attributes: { description: 'Outside skill' },
      body: 'Read it.',
      path: '/outside/..skills/review/SKILL.md'
    }])

    expect(rulesPrompt).toContain('..notes/rule.md')
    expect(rulesPrompt).not.toContain('/workspace/..notes')
    expect(skillsPrompt).toContain('..skills/review/SKILL.md')
    expect(skillsPrompt).not.toContain('/workspace/..skills')
    expect(outsideRulesPrompt).toContain('/outside/..notes/rule.md')
    expect(outsideSkillsPrompt).toContain('/outside/..skills/review/SKILL.md')
  })

  it('selects an entity filesystem rule reference with its exact whitespace-bearing bytes', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'ow-prompt-path-'))
    directories.push(cwd)
    const exactRule = {
      displayName: 'Exact rule',
      id: 'rule:exact',
      kind: 'rule',
      sourcePath: path.join(cwd, '.oo/rules/report.md ')
    }
    const entity = {
      displayName: 'Reviewer',
      id: 'entity:reviewer',
      kind: 'entity',
      payload: {
        definition: {
          attributes: { name: 'reviewer', rules: ['./.oo/rules/report.md '] },
          body: ''
        }
      },
      scope: 'entities/reviewer'
    }
    await mkdir(path.dirname(exactRule.sourcePath), { recursive: true })
    await writeFile(exactRule.sourcePath, 'exact rule')
    const bundle = { cwd, entities: [entity], rules: [exactRule] } as any
    const inherited = resolveEntityInheritance(bundle, entity as any)
    const selection = await resolveRuleSelection(bundle, inherited.definition.attributes.rules)

    expect(inherited.definition.attributes.rules).toEqual(['./.oo/rules/report.md '])
    expect(selection.assets).toEqual([exactRule])
  })
})
