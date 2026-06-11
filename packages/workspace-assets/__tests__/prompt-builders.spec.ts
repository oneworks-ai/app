import { join } from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it } from 'vitest'

import {
  generateEntitiesRoutePrompt,
  generateRulesPrompt,
  generateSkillsPrompt,
  generateSkillsRoutePrompt,
  generateSpecRoutePrompt
} from '#~/prompt-builders.js'
import { generateWorkspaceRoutePrompt } from '#~/workspace-prompt.js'

const originalCliResumeCommandPrefix = process.env.__ONEWORKS_CLI_RESUME_COMMAND_PREFIX__

afterEach(() => {
  if (originalCliResumeCommandPrefix == null) {
    delete process.env.__ONEWORKS_CLI_RESUME_COMMAND_PREFIX__
  } else {
    process.env.__ONEWORKS_CLI_RESUME_COMMAND_PREFIX__ = originalCliResumeCommandPrefix
  }
})

describe('workspace asset prompt builders', () => {
  it('builds skill prompts with stable names, descriptions, and relative paths', () => {
    const cwd = '/tmp/project'

    const prompt = generateSkillsPrompt(cwd, [
      {
        path: join(cwd, '.oo/skills/research/SKILL.md'),
        body: '阅读 README.md\n',
        attributes: {
          description: '检索项目信息'
        }
      }
    ])

    expect(prompt).toContain('The following skill modules are loaded for the project')
    expect(prompt).toContain('# research')
    expect(prompt).toContain('> Skill description: 检索项目信息')
    expect(prompt).toContain('> Skill file path: .oo/skills/research/SKILL.md')
    expect(prompt).toContain('<skill-content>')
    expect(prompt).not.toContain('/tmp/project/.oo/skills/research/SKILL.md')
  })

  it('builds rules prompts with embedded always rules and summary-only optional rules', () => {
    const cwd = '/tmp/project'

    const prompt = generateRulesPrompt(cwd, [
      {
        path: join(cwd, '.oo/rules/base.md'),
        body: '始终检查公共边界。',
        attributes: {
          alwaysApply: true
        }
      },
      {
        path: join(cwd, '.oo/rules/optional.md'),
        body: '仅在需要时展开。',
        attributes: {
          description: '按需规则',
          alwaysApply: false
        }
      }
    ])

    expect(prompt).toContain('# base')
    expect(prompt).toContain('> 始终检查公共边界。')
    expect(prompt).toContain('> Use when: 按需规则')
    expect(prompt).toContain('> Rule file path: .oo/rules/optional.md')
    expect(prompt).not.toContain('> 仅在需要时展开。')
  })

  it('builds rule prompts with markdown headings and blockquotes', () => {
    const cwd = '/tmp/project'

    const prompt = generateRulesPrompt(cwd, [
      {
        path: join(cwd, '.oo/rules/required.md'),
        body: '# 标题\n\n正文',
        attributes: {
          alwaysApply: true
        }
      },
      {
        path: join(cwd, '.oo/rules/summary-only.md'),
        body: '不应该内联',
        attributes: {
          description: '只展示摘要',
          alwaysApply: false
        }
      }
    ])

    expect(prompt).toContain('# required')
    expect(prompt).toContain('> # 标题')
    expect(prompt).toContain('> 正文')
    expect(prompt).toContain('# summary-only')
    expect(prompt).toContain('> Use when: 只展示摘要')
    expect(prompt).toContain('> Rule file path: .oo/rules/summary-only.md')
    expect(prompt).not.toContain('> 不应该内联')
    expect(prompt).not.toContain('--------------------')
  })

  it('builds spec route prompts with logical identifiers and active identity guidance', () => {
    const cwd = '/tmp/project'

    const prompt = generateSpecRoutePrompt([
      {
        path: join(cwd, '.oo/specs/release/index.md'),
        body: '发布流程',
        attributes: {
          params: [
            {
              name: 'version',
              description: '版本号'
            }
          ]
        }
      }
    ], { active: true })

    expect(prompt).toContain('professional project execution manager')
    expect(prompt).toContain('Workflow name: release')
    expect(prompt).toContain('Identifier: release')
    expect(prompt).toContain('    - version: 版本号')
    expect(prompt).toContain('use the workflow identifier to locate and load the corresponding definition')
    expect(prompt).not.toContain('load-spec')
  })

  it('builds spec route prompts without exposing file paths', () => {
    const cwd = '/tmp/project'

    const prompt = generateSpecRoutePrompt([
      {
        path: join(cwd, '.oo/specs/release/index.md'),
        body: '发布流程\n执行发布任务',
        attributes: {
          params: [
            {
              name: 'version',
              description: '版本号'
            }
          ]
        }
      },
      {
        path: join(cwd, '.oo/specs/internal.md'),
        body: '内部流程',
        attributes: {
          always: false
        }
      }
    ])

    expect(prompt).toContain('Workflow name: release')
    expect(prompt).toContain('Description: 发布流程')
    expect(prompt).toContain('Identifier: release')
    expect(prompt).toContain('    - version: 版本号')
    expect(prompt).toContain('use the workflow identifier to locate and load the corresponding definition')
    expect(prompt).not.toContain('load-spec')
    expect(prompt).not.toContain('professional project execution manager')
    expect(prompt).not.toContain('.oo/specs/release/index.md')
    expect(prompt).not.toContain('internal')
  })

  it('builds entity routes from summaries instead of full bodies', () => {
    const cwd = '/tmp/project'

    const prompt = generateEntitiesRoutePrompt([
      {
        path: join(cwd, '.oo/entities/reviewer/README.md'),
        body: '负责代码审查\n需要关注变更风险',
        attributes: {}
      },
      {
        path: join(cwd, '.oo/entities/hidden.md'),
        body: '不应暴露',
        attributes: {
          name: 'hidden',
          always: false
        }
      }
    ])

    expect(prompt).toContain('reviewer: 负责代码审查')
    expect(prompt).toContain('Agent runtime guide:')
    expect(prompt).toContain('`oneworks --input-format stream-json --output-format stream-json`')
    expect(prompt).toContain("cat <<'JSONL' | oneworks --input-format stream-json --output-format stream-json")
    expect(prompt).toContain('"commandId":"start-planner"')
    expect(prompt).toContain('"type":"session.start"')
    expect(prompt).toContain('"payload":{"title":"Plan Agent Room UI fix"')
    expect(prompt).toContain('"entity":"dev-planner"')
    expect(prompt).toContain('"background":true')
    expect(prompt).toContain('write one `session.start` line per child task')
    expect(prompt).toContain('typed runtime protocol envelopes')
    expect(prompt).toContain('do not treat dedicated agent subcommands as the standard integration surface')
    expect(prompt).toContain('Read the returned `sessionId`')
    expect(prompt).toContain('Ordinary new sessions stay session-scoped')
    expect(prompt).toContain('Do not use MCP task tools, dedicated agent subcommands, legacy StartTasks')
    expect(prompt).toContain('hand-written DB edits')
    expect(prompt).toContain('ad-hoc TS scripts')
    expect(prompt).toContain('server-managed host session')
    expect(prompt).toContain('server projects runtime store metadata/events')
    expect(prompt).toContain('`session.status` protocol command')
    expect(prompt).toContain('`session.events` protocol command')
    expect(prompt).toContain('`session.message` protocol command')
    expect(prompt).toContain('[ROOM_TASK_MESSAGE]')
    expect(prompt).toContain('`mode: interaction`')
    expect(prompt).toContain('`waiting_input`')
    expect(prompt).toContain('`session.submit` protocol command')
    expect(prompt).toContain('Do not use it for ordinary follow-up instructions')
    expect(prompt).toContain('completed or failed sessions resume the same conversation')
    expect(prompt).toContain('`wait`')
    expect(prompt).not.toContain('OneWorks.StartTasks')
    expect(prompt).not.toContain('run-tasks')
    expect(prompt).not.toContain('需要关注变更风险')
    expect(prompt).not.toContain('hidden')
  })

  it('builds workspace routes with managed task guidance', () => {
    const cwd = '/tmp/project'

    const prompt = generateWorkspaceRoutePrompt(cwd, [
      {
        id: 'billing',
        cwd: join(cwd, 'packages/billing'),
        path: join(cwd, '.oo/workspaces/billing.md'),
        description: 'Billing workspace'
      }
    ])

    expect(prompt).toContain('The project includes the following registered workspaces')
    expect(prompt).toContain('Identifier: billing')
    expect(prompt).toContain('workspace identifier and path')
    expect(prompt).toContain('Agent runtime guide:')
    expect(prompt).toContain('`oneworks --input-format stream-json --output-format stream-json`')
    expect(prompt).toContain('"payload":{"title":"Plan Agent Room UI fix"')
    expect(prompt).toContain('"payload":{"title":"Review Agent Room UI fix"')
    expect(prompt).toContain('payload.background: true')
    expect(prompt).toContain('multiple subtasks')
    expect(prompt).toContain('`session.status` protocol command')
    expect(prompt).toContain('`session.events` protocol command')
    expect(prompt).toContain('`session.message` protocol command')
    expect(prompt).toContain('`session.submit`')
    expect(prompt).toContain('Do not directly edit files inside a registered workspace')
    expect(prompt).not.toContain('OneWorks.StartTasks')
  })

  it('uses forwarded cli names in managed task guidance', () => {
    process.env.__ONEWORKS_CLI_RESUME_COMMAND_PREFIX__ = 'dyai'

    const prompt = generateEntitiesRoutePrompt([
      {
        path: '/tmp/project/.oo/entities/reviewer/README.md',
        body: '负责代码审查',
        attributes: {}
      }
    ])

    expect(prompt).toContain('`dyai run --input-format stream-json --output-format stream-json`')
    expect(prompt).toContain("cat <<'JSONL' | dyai run --input-format stream-json --output-format stream-json")
    expect(prompt).not.toContain('`oneworks --input-format stream-json --output-format stream-json`')
  })

  it('builds skill route prompts without preloading content', () => {
    const cwd = '/tmp/project'

    const prompt = generateSkillsRoutePrompt(cwd, [
      {
        path: join(cwd, '.oo/skills/research/SKILL.md'),
        body: '阅读 README.md\n',
        attributes: {
          description: '检索项目信息'
        }
      }
    ])

    expect(prompt).toContain('# research')
    expect(prompt).toContain('> Skill description: 检索项目信息')
    expect(prompt).toContain('> Skill file path: .oo/skills/research/SKILL.md')
    expect(prompt).toContain(
      '> Do not preload the body by default; read the corresponding skill file only when the task clearly requires it.'
    )
    expect(prompt).not.toContain('<skill-content>')
    expect(prompt).not.toContain('阅读 README.md')
  })
})
