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
  it('builds codex diagnostics for prompt, mcp, hook plugins, and unsupported opencode assets', async () => {
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
    expect(plan.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        assetId: researchSkillId,
        adapter: 'codex',
        status: 'prompt'
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
        status: 'prompt'
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
})
