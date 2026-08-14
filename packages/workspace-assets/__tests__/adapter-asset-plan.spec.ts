/* eslint-disable import/first, max-lines -- adapter asset plan scenarios share setup helpers and assertions */
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

const skillsCliMocks = vi.hoisted(() => ({
  findSkillsCli: vi.fn(),
  installSkillsCliRefToTemp: vi.fn(),
  installSkillsCliSkillToTemp: vi.fn()
}))

vi.mock('@oneworks/utils/skills-cli', async () => {
  const actual = await vi.importActual<typeof import('@oneworks/utils/skills-cli')>('@oneworks/utils/skills-cli')
  return {
    ...actual,
    findSkillsCli: skillsCliMocks.findSkillsCli,
    installSkillsCliRefToTemp: skillsCliMocks.installSkillsCliRefToTemp,
    installSkillsCliSkillToTemp: skillsCliMocks.installSkillsCliSkillToTemp
  }
})

import { buildAdapterAssetPlan, resolvePromptAssetSelection, resolveWorkspaceAssetBundle } from '#~/index.js'

import { createWorkspace, installPluginPackage, writeDocument } from './test-helpers'

describe('buildAdapterAssetPlan', () => {
  it('stages Cline skills while explicitly skipping unverified MCP and hooks', async () => {
    const workspace = await createWorkspace()
    await installPluginPackage(workspace, '@oneworks/plugin-logger', {
      'package.json': JSON.stringify({ name: '@oneworks/plugin-logger', version: '1.0.0' }),
      'hooks.js': 'module.exports = {}\n'
    })
    await writeDocument(
      join(workspace, '.oo/skills/research/SKILL.md'),
      '---\ndescription: Research\n---\nRead the docs.'
    )
    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        mcpServers: { docs: { command: 'npx', args: ['docs-server'] } },
        plugins: [{ id: 'logger' }]
      }, undefined],
      useDefaultOneworksMcpServer: false
    })
    const plan = await buildAdapterAssetPlan({
      adapter: 'cline',
      bundle,
      options: {
        mcpServers: { include: ['docs'] },
        skills: { include: ['research'] }
      }
    })

    expect(plan.mcpServers).toEqual({})
    expect(plan.overlays).toEqual([
      expect.objectContaining({ kind: 'skill', targetPath: 'skills/research' })
    ])
    expect(plan.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ adapter: 'cline', status: 'native', reason: expect.stringContaining('Cline') }),
      expect.objectContaining({ adapter: 'cline', status: 'skipped', reason: expect.stringContaining('MCP') }),
      expect.objectContaining({ adapter: 'cline', status: 'translated', reason: expect.stringContaining('hooks-dir') })
    ]))
  })

  it('builds Kiro skill, MCP, hook, and unsupported-overlay diagnostics', async () => {
    const workspace = await createWorkspace()
    await installPluginPackage(workspace, '@oneworks/plugin-logger', {
      'package.json': JSON.stringify({ name: '@oneworks/plugin-logger', version: '1.0.0' }),
      'hooks.js': 'module.exports = {}\n'
    })
    await installPluginPackage(workspace, '@oneworks/plugin-demo', {
      'package.json': JSON.stringify({ name: '@oneworks/plugin-demo', version: '1.0.0' }),
      'opencode/commands/review.md': '# review\n'
    })
    await writeDocument(
      join(workspace, '.oo/skills/research/SKILL.md'),
      '---\ndescription: Research\n---\nRead the docs.'
    )
    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        plugins: [{ id: 'logger' }, { id: 'demo' }],
        mcpServers: {
          docs: { command: 'node', args: ['docs.mjs'] },
          events: { type: 'sse', url: 'https://example.test/events', headers: {} },
          remoteDocs: { type: 'http', url: 'https://example.test/mcp' }
        }
      }, undefined],
      useDefaultOneworksMcpServer: false
    })
    const plan = await buildAdapterAssetPlan({
      adapter: 'kiro',
      bundle,
      options: { skills: { include: ['research'] } }
    })
    const hookId = bundle.hookPlugins.find(asset => asset.packageId === '@oneworks/plugin-logger')?.id
    const skillId = bundle.skills.find(asset => asset.name === 'research')?.id

    expect(plan.mcpServers).toHaveProperty('docs')
    expect(plan.mcpServers).not.toHaveProperty('events')
    expect(plan.mcpServers).not.toHaveProperty('remoteDocs')
    expect(plan.overlays).toEqual([
      expect.objectContaining({ kind: 'skill', targetPath: 'skills/research' })
    ])
    expect(plan.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        adapter: 'kiro',
        assetId: bundle.mcpServers.docs.id,
        status: 'translated',
        reason: expect.stringContaining('stdio')
      }),
      expect.objectContaining({
        adapter: 'kiro',
        assetId: bundle.mcpServers.remoteDocs.id,
        status: 'skipped',
        reason: expect.stringMatching(/verified CLI contract.*HTTP transport was skipped/u)
      }),
      expect.objectContaining({
        adapter: 'kiro',
        assetId: bundle.mcpServers.events.id,
        status: 'skipped',
        reason: expect.stringMatching(/verified CLI contract.*SSE transport was skipped/u)
      }),
      expect.objectContaining({ adapter: 'kiro', assetId: hookId, status: 'native' }),
      expect.objectContaining({ adapter: 'kiro', assetId: skillId, status: 'native' }),
      expect.objectContaining({ adapter: 'kiro', status: 'skipped' })
    ]))
    expect(plan.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: bundle.mcpServers.remoteDocs.id, status: 'translated' }),
      expect.objectContaining({ assetId: bundle.mcpServers.events.id, status: 'translated' })
    ]))
  })

  it('keeps remote MCP planning unchanged for adapters that support translation', async () => {
    const workspace = await createWorkspace()
    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        mcpServers: {
          events: { type: 'sse', url: 'https://example.test/events', headers: {} },
          remoteDocs: { type: 'http', url: 'https://example.test/mcp' }
        }
      }, undefined],
      useDefaultOneworksMcpServer: false
    })
    const plan = await buildAdapterAssetPlan({ adapter: 'codex', bundle, options: {} })

    expect(plan.mcpServers).toEqual({
      events: expect.objectContaining({ type: 'sse' }),
      remoteDocs: expect.objectContaining({ type: 'http' })
    })
    expect(plan.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: bundle.mcpServers.events.id, status: 'translated' }),
      expect.objectContaining({ assetId: bundle.mcpServers.remoteDocs.id, status: 'translated' })
    ]))
  })

  it('stages Junie skills and agents while skipping unverified OpenCode commands', async () => {
    const workspace = await createWorkspace()
    await installPluginPackage(workspace, '@oneworks/plugin-demo', {
      'package.json': JSON.stringify({ name: '@oneworks/plugin-demo', version: '1.0.0' }),
      'opencode/agents/reviewer.md': '# reviewer\n',
      'opencode/commands/review.md': '# review\n'
    })
    await writeDocument(
      join(workspace, '.oo/skills/research/SKILL.md'),
      '---\ndescription: Research\n---\nRead the docs.'
    )
    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{ plugins: [{ id: 'demo' }] }, undefined],
      useDefaultOneworksMcpServer: false
    })
    const plan = await buildAdapterAssetPlan({
      adapter: 'junie',
      bundle,
      options: { skills: { include: ['research'] } }
    })

    expect(plan.overlays).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'skill', targetPath: 'skills/research' }),
      expect.objectContaining({ kind: 'agent', targetPath: 'agents/reviewer.md' })
    ]))
    expect(plan.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ adapter: 'junie', status: 'native' }),
      expect.objectContaining({ adapter: 'junie', status: 'skipped' })
    ]))
  })

  it.each(['grok', 'qwen-code'] as const)('stages %s skills and skips OpenCode-only overlays', async (adapter) => {
    const workspace = await createWorkspace()
    await installPluginPackage(workspace, '@oneworks/plugin-demo', {
      'package.json': JSON.stringify({ name: '@oneworks/plugin-demo', version: '1.0.0' }),
      'opencode/commands/review.md': '# review\n'
    })
    await writeDocument(
      join(workspace, '.oo/skills/research/SKILL.md'),
      '---\ndescription: Research\n---\nRead the docs.'
    )
    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{ plugins: [{ id: 'demo' }] }, undefined],
      useDefaultOneworksMcpServer: false
    })
    const plan = await buildAdapterAssetPlan({
      adapter,
      bundle,
      options: { skills: { include: ['research'] } }
    })

    expect(plan.overlays).toEqual([
      expect.objectContaining({ kind: 'skill', targetPath: 'skills/research' })
    ])
    expect(plan.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ adapter, status: 'native' }),
      expect.objectContaining({ adapter, status: 'skipped' })
    ]))
  })

  it('keeps Goose skills and MCP native to its ACP boundary while leaving hooks in One Works', async () => {
    const workspace = await createWorkspace()
    await installPluginPackage(workspace, '@oneworks/plugin-logger', {
      'package.json': JSON.stringify({ name: '@oneworks/plugin-logger', version: '1.0.0' }),
      'hooks.js': 'module.exports = {}\n'
    })
    await installPluginPackage(workspace, '@oneworks/plugin-demo', {
      'package.json': JSON.stringify({ name: '@oneworks/plugin-demo', version: '1.0.0' }),
      'opencode/commands/review.md': '# review\n'
    })
    await writeDocument(
      join(workspace, '.oo/skills/research/SKILL.md'),
      '---\ndescription: Research\n---\nRead the docs.'
    )
    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        plugins: [{ id: 'logger' }, { id: 'demo' }],
        mcpServers: {
          docs: { command: 'node', args: ['docs-server.js'] },
          remote: { type: 'http', url: 'https://example.test/mcp' },
          events: { type: 'sse', url: 'https://example.test/events', headers: {} }
        }
      }, undefined],
      useDefaultOneworksMcpServer: false
    })
    const plan = await buildAdapterAssetPlan({
      adapter: 'goose',
      bundle,
      options: {
        mcpServers: { include: ['docs', 'remote', 'events'] },
        skills: { include: ['research'] }
      }
    })

    expect(plan.mcpServers).toHaveProperty('docs')
    expect(plan.mcpServers).toHaveProperty('remote')
    expect(plan.mcpServers).not.toHaveProperty('events')
    expect(plan.overlays).toEqual([
      expect.objectContaining({ kind: 'skill', targetPath: 'skills/research' })
    ])
    expect(plan.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ adapter: 'goose', status: 'native', reason: expect.stringContaining('Goose') }),
      expect.objectContaining({ adapter: 'goose', status: 'translated', reason: expect.stringContaining('MCP') }),
      expect.objectContaining({
        adapter: 'goose',
        status: 'skipped',
        reason: expect.stringContaining('SSE')
      }),
      expect.objectContaining({
        adapter: 'goose',
        status: 'translated',
        reason: expect.stringContaining('not injected')
      }),
      expect.objectContaining({
        adapter: 'goose',
        status: 'skipped',
        reason: expect.stringContaining('recipes and extensions')
      })
    ]))
  })

  it('builds codex diagnostics for native skills, mcp, hook plugins, and unsupported opencode assets', async () => {
    const workspace = await createWorkspace()

    await installPluginPackage(workspace, '@oneworks/plugin-logger', {
      'package.json': JSON.stringify(
        {
          name: '@oneworks/plugin-logger',
          version: '1.0.0'
        },
        null,
        2
      ),
      'hooks.js': 'module.exports = {}\n'
    })
    await installPluginPackage(workspace, '@oneworks/plugin-demo', {
      'package.json': JSON.stringify(
        {
          name: '@oneworks/plugin-demo',
          version: '1.0.0'
        },
        null,
        2
      ),
      'opencode/commands/review.md': '# review\n'
    })
    await writeDocument(
      join(workspace, '.oo/skills/research/SKILL.md'),
      '---\ndescription: 检索资料\n---\n阅读 README.md'
    )
    await writeDocument(
      join(workspace, '.oo/skills/review/SKILL.md'),
      '---\ndescription: 代码评审\n---\n检查风险'
    )

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        plugins: [
          { id: 'logger' },
          { id: 'demo', scope: 'demo' }
        ],
        mcpServers: {
          docs: {
            command: 'npx',
            args: ['docs-server']
          }
        }
      }, undefined],
      useDefaultOneworksMcpServer: false
    })
    const researchSkillId = bundle.skills.find(asset => asset.name === 'research')?.id
    const reviewSkillId = bundle.skills.find(asset => asset.name === 'review')?.id
    const loggerHookPluginId = bundle.hookPlugins.find(asset => asset.packageId === '@oneworks/plugin-logger')?.id
    const demoCommandId = bundle.opencodeOverlayAssets.find(asset => asset.kind === 'command')?.id
    const docsMcpId = bundle.mcpServers.docs?.id
    expect(researchSkillId).toBeDefined()
    expect(reviewSkillId).toBeDefined()
    expect(loggerHookPluginId).toBeDefined()
    expect(demoCommandId).toBeDefined()
    expect(docsMcpId).toBeDefined()

    const [, resolvedOptions] = await resolvePromptAssetSelection({
      bundle,
      type: undefined,
      name: undefined,
      adapter: 'codex',
      input: {
        skills: {
          include: ['research']
        }
      }
    })
    const plan = await buildAdapterAssetPlan({
      adapter: 'codex',
      bundle,
      options: {
        promptAssetIds: resolvedOptions.promptAssetIds,
        mcpServers: resolvedOptions.mcpServers,
        skills: {
          include: ['research']
        }
      }
    })

    expect(plan.mcpServers).toHaveProperty('docs')
    expect(plan.overlays).toEqual([
      expect.objectContaining({
        assetId: researchSkillId,
        kind: 'skill',
        targetPath: 'skills/research'
      })
    ])
    expect(plan.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        assetId: researchSkillId,
        adapter: 'codex',
        status: 'native'
      }),
      expect.objectContaining({
        adapter: 'codex',
        status: 'native',
        assetId: loggerHookPluginId
      }),
      expect.objectContaining({
        adapter: 'codex',
        status: 'translated',
        assetId: docsMcpId
      }),
      expect.objectContaining({
        adapter: 'codex',
        status: 'skipped',
        assetId: demoCommandId
      })
    ]))
    expect(plan.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        assetId: reviewSkillId,
        adapter: 'codex',
        status: 'native'
      })
    ]))
  })

  it('builds opencode overlays for skills and native commands', async () => {
    const workspace = await createWorkspace()

    await installPluginPackage(workspace, '@oneworks/plugin-demo', {
      'package.json': JSON.stringify(
        {
          name: '@oneworks/plugin-demo',
          version: '1.0.0'
        },
        null,
        2
      ),
      'opencode/commands/review.md': '# review\n'
    })
    await writeDocument(
      join(workspace, '.oo/skills/research/SKILL.md'),
      '---\ndescription: 检索资料\n---\n阅读 README.md'
    )

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        plugins: [
          { id: 'demo', scope: 'demo' }
        ]
      }, undefined],
      useDefaultOneworksMcpServer: false
    })
    const plan = await buildAdapterAssetPlan({
      adapter: 'opencode',
      bundle,
      options: {
        skills: {
          include: ['research']
        }
      }
    })
    const commandAsset = bundle.opencodeOverlayAssets.find(asset => asset.kind === 'command')

    expect(plan.overlays).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'skill',
        targetPath: 'skills/research'
      }),
      expect.objectContaining({
        kind: 'command',
        targetPath: 'commands/review.md'
      })
    ]))
    expect(plan.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        assetId: commandAsset?.id,
        adapter: 'opencode',
        status: 'native'
      })
    ]))
  })

  it('labels home-bridged skill diagnostics with source=home', async () => {
    const workspace = await createWorkspace()
    const realHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__

    await writeDocument(
      join(realHome!, '.agents/skills/research/SKILL.md'),
      '---\ndescription: 检索资料\n---\n阅读 README.md'
    )

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [undefined, undefined],
      useDefaultOneworksMcpServer: false
    })
    const researchSkillId = bundle.skills.find(asset => asset.name === 'research')?.id

    const plan = await buildAdapterAssetPlan({
      adapter: 'opencode',
      bundle,
      options: {
        skills: {
          include: ['research']
        }
      }
    })

    expect(plan.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        assetId: researchSkillId,
        adapter: 'opencode',
        status: 'native',
        source: 'home'
      })
    ]))
  })

  it('includes transitive skill dependencies in selected native overlays', async () => {
    const workspace = await createWorkspace()

    await writeDocument(
      join(workspace, '.oo/skills/app-builder/SKILL.md'),
      [
        '---',
        'name: app-builder',
        'description: Build apps',
        'dependencies:',
        '  - frontend-design',
        '---',
        'Build the app.'
      ].join('\n')
    )
    await writeDocument(
      join(workspace, '.oo/skills/frontend-design/SKILL.md'),
      '---\nname: frontend-design\ndescription: UI design guidance\n---\nDesign the UI.'
    )

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [undefined, undefined],
      useDefaultOneworksMcpServer: false
    })
    const plan = await buildAdapterAssetPlan({
      adapter: 'opencode',
      bundle,
      options: {
        skills: {
          include: ['app-builder']
        }
      }
    })

    expect(plan.overlays).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'skill',
        targetPath: 'skills/app-builder'
      }),
      expect.objectContaining({
        kind: 'skill',
        targetPath: 'skills/frontend-design'
      })
    ]))
  })

  it('prunes excluded skill dependency subtrees from selected native overlays', async () => {
    const workspace = await createWorkspace()

    await writeDocument(
      join(workspace, '.oo/skills/app-builder/SKILL.md'),
      [
        '---',
        'name: app-builder',
        'description: Build apps',
        'dependencies:',
        '  - frontend-design',
        '---',
        'Build the app.'
      ].join('\n')
    )
    await writeDocument(
      join(workspace, '.oo/skills/frontend-design/SKILL.md'),
      [
        '---',
        'name: frontend-design',
        'description: UI design guidance',
        'dependencies:',
        '  - color-system',
        '---',
        'Design the UI.'
      ].join('\n')
    )
    await writeDocument(
      join(workspace, '.oo/skills/color-system/SKILL.md'),
      '---\nname: color-system\ndescription: Color guidance\n---\nPick accessible colors.'
    )

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [undefined, undefined],
      useDefaultOneworksMcpServer: false
    })
    const plan = await buildAdapterAssetPlan({
      adapter: 'opencode',
      bundle,
      options: {
        skills: {
          include: ['app-builder'],
          exclude: ['frontend-design']
        }
      }
    })

    expect(plan.overlays).toEqual([
      expect.objectContaining({
        kind: 'skill',
        targetPath: 'skills/app-builder'
      })
    ])
  })

  it('builds copilot native skill overlays and native hook diagnostics', async () => {
    const workspace = await createWorkspace()

    await installPluginPackage(workspace, '@oneworks/plugin-logger', {
      'package.json': JSON.stringify(
        {
          name: '@oneworks/plugin-logger',
          version: '1.0.0'
        },
        null,
        2
      ),
      'hooks.js': 'module.exports = {}\n'
    })
    await installPluginPackage(workspace, '@oneworks/plugin-demo', {
      'package.json': JSON.stringify(
        {
          name: '@oneworks/plugin-demo',
          version: '1.0.0'
        },
        null,
        2
      ),
      'opencode/commands/review.md': '# review\n'
    })
    await writeDocument(
      join(workspace, '.oo/skills/research/SKILL.md'),
      '---\ndescription: 检索资料\n---\n阅读 README.md'
    )

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        plugins: [
          { id: 'logger' },
          { id: 'demo', scope: 'demo' }
        ],
        mcpServers: {
          docs: {
            command: 'npx',
            args: ['docs-server']
          }
        }
      }, undefined],
      useDefaultOneworksMcpServer: false
    })
    const researchSkillId = bundle.skills.find(asset => asset.name === 'research')?.id
    const loggerHookPluginId = bundle.hookPlugins.find(asset => asset.packageId === '@oneworks/plugin-logger')?.id
    const demoCommandId = bundle.opencodeOverlayAssets.find(asset => asset.kind === 'command')?.id
    const docsMcpId = bundle.mcpServers.docs?.id
    expect(researchSkillId).toBeDefined()
    expect(loggerHookPluginId).toBeDefined()
    expect(demoCommandId).toBeDefined()
    expect(docsMcpId).toBeDefined()

    const [, resolvedOptions] = await resolvePromptAssetSelection({
      bundle,
      type: undefined,
      name: undefined,
      adapter: 'copilot',
      input: {
        skills: {
          include: ['research']
        }
      }
    })
    const plan = await buildAdapterAssetPlan({
      adapter: 'copilot',
      bundle,
      options: {
        promptAssetIds: resolvedOptions.promptAssetIds,
        mcpServers: resolvedOptions.mcpServers,
        skills: {
          include: ['research']
        }
      }
    })

    expect(plan.mcpServers).toHaveProperty('docs')
    expect(plan.overlays).toEqual([
      expect.objectContaining({
        assetId: researchSkillId,
        kind: 'skill',
        targetPath: 'skills/research'
      })
    ])
    expect(plan.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        assetId: researchSkillId,
        adapter: 'copilot',
        status: 'native'
      }),
      expect.objectContaining({
        assetId: loggerHookPluginId,
        adapter: 'copilot',
        status: 'native'
      }),
      expect.objectContaining({
        assetId: docsMcpId,
        adapter: 'copilot',
        status: 'translated'
      }),
      expect.objectContaining({
        assetId: demoCommandId,
        adapter: 'copilot',
        status: 'skipped'
      })
    ]))
    expect(plan.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        assetId: researchSkillId,
        adapter: 'copilot',
        status: 'prompt'
      })
    ]))
  })

  it('builds Droid native skills/hooks while explicitly skipping native plugins', async () => {
    const workspace = await createWorkspace()

    await installPluginPackage(workspace, '@oneworks/plugin-logger', {
      'package.json': JSON.stringify(
        {
          name: '@oneworks/plugin-logger',
          version: '1.0.0'
        },
        null,
        2
      ),
      'hooks.js': 'module.exports = {}\n'
    })
    await installPluginPackage(workspace, '@oneworks/plugin-demo', {
      'package.json': JSON.stringify(
        {
          name: '@oneworks/plugin-demo',
          version: '1.0.0'
        },
        null,
        2
      ),
      'opencode/commands/review.md': '# review\n'
    })
    await writeDocument(
      join(workspace, '.oo/skills/research/SKILL.md'),
      '---\ndescription: Research evidence\n---\nRead primary sources.'
    )

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        plugins: [
          { id: 'logger' },
          { id: 'demo', scope: 'demo' }
        ],
        mcpServers: {
          docs: { command: 'npx', args: ['docs-server'] }
        }
      }, undefined],
      useDefaultOneworksMcpServer: false
    })
    const skillId = bundle.skills.find(asset => asset.name === 'research')?.id
    const hookId = bundle.hookPlugins.find(asset => asset.packageId === '@oneworks/plugin-logger')?.id
    const pluginId = bundle.opencodeOverlayAssets.find(asset => asset.kind === 'command')?.id
    const mcpId = bundle.mcpServers.docs?.id

    const plan = await buildAdapterAssetPlan({
      adapter: 'droid',
      bundle,
      options: { skills: { include: ['research'] } }
    })

    expect(plan.mcpServers).toHaveProperty('docs')
    expect(plan.overlays).toEqual([expect.objectContaining({
      assetId: skillId,
      kind: 'skill',
      targetPath: 'skills/research'
    })])
    expect(plan.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ adapter: 'droid', assetId: skillId, status: 'native' }),
      expect.objectContaining({ adapter: 'droid', assetId: hookId, status: 'native' }),
      expect.objectContaining({ adapter: 'droid', assetId: mcpId, status: 'translated' }),
      expect.objectContaining({
        adapter: 'droid',
        assetId: pluginId,
        reason: expect.stringContaining('no session-scoped plugin injection'),
        status: 'skipped'
      })
    ]))
  })

  it('builds kimi overlays for native skills and native hooks', async () => {
    const workspace = await createWorkspace()

    await installPluginPackage(workspace, '@oneworks/plugin-logger', {
      'package.json': JSON.stringify(
        {
          name: '@oneworks/plugin-logger',
          version: '1.0.0'
        },
        null,
        2
      ),
      'hooks.js': 'module.exports = {}\n'
    })
    await installPluginPackage(workspace, '@oneworks/plugin-demo', {
      'package.json': JSON.stringify(
        {
          name: '@oneworks/plugin-demo',
          version: '1.0.0'
        },
        null,
        2
      ),
      'opencode/commands/review.md': '# review\n'
    })
    await writeDocument(
      join(workspace, '.oo/skills/research/SKILL.md'),
      '---\ndescription: 检索资料\n---\n阅读 README.md'
    )

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        plugins: [
          { id: 'logger' },
          { id: 'demo', scope: 'demo' }
        ],
        mcpServers: {
          docs: {
            command: 'npx',
            args: ['docs-server']
          }
        }
      }, undefined],
      useDefaultOneworksMcpServer: false
    })
    const loggerHookPluginId = bundle.hookPlugins.find(asset => asset.packageId === '@oneworks/plugin-logger')?.id
    const demoCommandId = bundle.opencodeOverlayAssets.find(asset => asset.kind === 'command')?.id

    const plan = await buildAdapterAssetPlan({
      adapter: 'kimi',
      bundle,
      options: {
        skills: {
          include: ['research']
        }
      }
    })

    expect(plan.overlays).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'skill',
        targetPath: 'research'
      })
    ]))
    expect(plan.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        adapter: 'kimi',
        assetId: loggerHookPluginId,
        status: 'native'
      }),
      expect.objectContaining({
        adapter: 'kimi',
        assetId: demoCommandId,
        status: 'skipped'
      })
    ]))
  })

  it('marks Gemini hook plugins as native bridge assets', async () => {
    const workspace = await createWorkspace()

    await installPluginPackage(workspace, '@oneworks/plugin-logger', {
      'package.json': JSON.stringify(
        {
          name: '@oneworks/plugin-logger',
          version: '1.0.0'
        },
        null,
        2
      ),
      'hooks.js': 'module.exports = {}\n'
    })

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        plugins: [{ id: 'logger' }]
      }, undefined],
      useDefaultOneworksMcpServer: false
    })
    const loggerHookPluginId = bundle.hookPlugins.find(asset => asset.packageId === '@oneworks/plugin-logger')?.id

    const plan = await buildAdapterAssetPlan({
      adapter: 'gemini',
      bundle,
      options: {}
    })

    expect(plan.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        adapter: 'gemini',
        assetId: loggerHookPluginId,
        status: 'native',
        reason: 'Mapped into the Gemini native hooks bridge.'
      })
    ]))
  })

  it('projects selected skills into Pi while explicitly skipping MCP and OpenCode assets', async () => {
    const workspace = await createWorkspace()

    await installPluginPackage(workspace, '@oneworks/plugin-demo', {
      'package.json': JSON.stringify({ name: '@oneworks/plugin-demo', version: '1.0.0' }, null, 2),
      'opencode/commands/review.md': '# review\n'
    })
    await writeDocument(
      join(workspace, '.oo/skills/research/SKILL.md'),
      '---\ndescription: Research evidence\n---\nRead primary sources.'
    )

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        plugins: [{ id: 'demo', scope: 'demo' }],
        mcpServers: { docs: { command: 'npx', args: ['docs-server'] } }
      }, undefined],
      useDefaultOneworksMcpServer: false
    })
    const researchSkillId = bundle.skills.find(asset => asset.name === 'research')?.id
    const docsMcpId = bundle.mcpServers.docs?.id
    const commandId = bundle.opencodeOverlayAssets.find(asset => asset.kind === 'command')?.id

    const plan = await buildAdapterAssetPlan({
      adapter: 'pi',
      bundle,
      options: { skills: { include: ['research'] } }
    })

    expect(plan.mcpServers).toEqual({})
    expect(plan.overlays).toEqual([
      expect.objectContaining({
        assetId: researchSkillId,
        kind: 'skill',
        targetPath: 'skills/research'
      })
    ])
    expect(plan.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ adapter: 'pi', assetId: researchSkillId, status: 'native' }),
      expect.objectContaining({ adapter: 'pi', assetId: docsMcpId, status: 'skipped' }),
      expect.objectContaining({ adapter: 'pi', assetId: commandId, status: 'skipped' })
    ]))
  })

  it('keeps DSH skills in the prompt and explicitly skips MCP and OpenCode assets', async () => {
    const workspace = await createWorkspace()

    await installPluginPackage(workspace, '@oneworks/plugin-demo', {
      'package.json': JSON.stringify({ name: '@oneworks/plugin-demo', version: '1.0.0' }, null, 2),
      'opencode/commands/review.md': '# review\n'
    })
    await writeDocument(
      join(workspace, '.oo/skills/research/SKILL.md'),
      '---\ndescription: Research evidence\n---\nRead primary sources.'
    )

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        plugins: [{ id: 'demo', scope: 'demo' }],
        mcpServers: { docs: { command: 'npx', args: ['docs-server'] } }
      }, undefined],
      useDefaultOneworksMcpServer: false
    })
    const [, resolvedOptions] = await resolvePromptAssetSelection({
      adapter: 'dsh',
      bundle,
      input: { skills: { include: ['research'] } },
      type: undefined
    })
    const researchSkillId = bundle.skills.find(asset => asset.name === 'research')?.id
    const docsMcpId = bundle.mcpServers.docs?.id
    const commandId = bundle.opencodeOverlayAssets.find(asset => asset.kind === 'command')?.id
    const plan = await buildAdapterAssetPlan({
      adapter: 'dsh',
      bundle,
      options: {
        mcpServers: resolvedOptions.mcpServers,
        promptAssetIds: resolvedOptions.promptAssetIds,
        skills: { include: ['research'] }
      }
    })

    expect(resolvedOptions.systemPrompt).toContain('research')
    expect(plan.mcpServers).toEqual({})
    expect(plan.overlays).toEqual([])
    expect(plan.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ adapter: 'dsh', assetId: researchSkillId, status: 'prompt' }),
      expect.objectContaining({ adapter: 'dsh', assetId: docsMcpId, status: 'skipped' }),
      expect.objectContaining({ adapter: 'dsh', assetId: commandId, status: 'skipped' })
    ]))
  })
})
