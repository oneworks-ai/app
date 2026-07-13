/* eslint-disable import/first, max-lines -- bundle coverage keeps related fixture scenarios in one file */
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

const skillsCliMocks = vi.hoisted(() => ({
  findSkillsCli: vi.fn(),
  installSkillsCliRefToTemp: vi.fn(),
  installSkillsCliSkillToTemp: vi.fn(),
  installSkillsCliSourceToTemp: vi.fn()
}))

vi.mock('@oneworks/utils/skills-cli', async () => {
  const actual = await vi.importActual<typeof import('@oneworks/utils/skills-cli')>('@oneworks/utils/skills-cli')
  return {
    ...actual,
    findSkillsCli: skillsCliMocks.findSkillsCli,
    installSkillsCliRefToTemp: skillsCliMocks.installSkillsCliRefToTemp,
    installSkillsCliSkillToTemp: skillsCliMocks.installSkillsCliSkillToTemp,
    installSkillsCliSourceToTemp: skillsCliMocks.installSkillsCliSourceToTemp
  }
})

import { resolveWorkspaceAssetBundle } from '#~/index.js'

import { resolveProjectHomePath } from '@oneworks/utils/ai-path'
import { getManagedPluginInstallDir } from '@oneworks/utils/managed-plugin'
import { createWorkspace, installPluginPackage, writeDocument } from './test-helpers'

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('resolveWorkspaceAssetBundle', () => {
  it('loads npm plugin assets via the package-id fallback and exposes OpenCode overlays', async () => {
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
      'skills/research/SKILL.md': '---\ndescription: 检索资料\n---\n阅读 README.md',
      'rules/review.md': '---\ndescription: 评审规则\n---\n必须检查风险',
      'mcp/browser.json': JSON.stringify(
        {
          command: '${' + 'ONEWORKS_NODE_EXECUTABLE}',
          args: ['${' + 'ONEWORKS_PLUGIN_ROOT}/server.js'],
          env: {
            HOME: '${' + 'ONEWORKS_REAL_HOME}',
            USERPROFILE: '${' + 'ONEWORKS_REAL_HOME}',
            CURSOR_COLOR: '${' + 'ONEWORKS_PLUGIN_OPTION:cursor.color}',
            CURSOR_AUTOMATIC: '${' + 'ONEWORKS_PLUGIN_OPTION:cursor.automatic}'
          }
        },
        null,
        2
      ),
      'server.js': 'process.stdout.write("ready")\n',
      'opencode/commands/review.md': '# review\n'
    })
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
        plugins: [
          {
            id: 'demo',
            scope: 'demo',
            options: {
              cursor: { automatic: true, color: '#625BF6' }
            }
          },
          { id: 'logger' }
        ]
      }, undefined],
      useDefaultOneworksMcpServer: false
    })

    expect(bundle.skills.map(asset => asset.displayName)).toEqual(['demo/research'])
    expect(bundle.rules.map(asset => asset.displayName)).toEqual(['demo/review'])
    expect(Object.keys(bundle.mcpServers)).toEqual(['demo/browser'])
    expect(bundle.mcpServers['demo/browser']?.payload.config).toEqual({
      command: process.execPath,
      args: [join(workspace, 'node_modules/@oneworks/plugin-demo/server.js')],
      env: {
        HOME: process.env.__ONEWORKS_PROJECT_REAL_HOME__,
        USERPROFILE: process.env.__ONEWORKS_PROJECT_REAL_HOME__,
        CURSOR_COLOR: '#625BF6',
        CURSOR_AUTOMATIC: 'true'
      }
    })
    expect(bundle.hookPlugins).toEqual(expect.arrayContaining([
      expect.objectContaining({
        packageId: '@oneworks/plugin-logger'
      })
    ]))
    expect(bundle.hookPlugins).toHaveLength(1)
    expect(bundle.opencodeOverlayAssets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'command',
        sourcePath: expect.stringContaining('/node_modules/@oneworks/plugin-demo/opencode/commands/review.md'),
        payload: expect.objectContaining({
          targetSubpath: 'commands/review.md'
        })
      })
    ]))
  })

  it('skips invalid plugin MCP files and keeps resolving other plugin assets', async () => {
    const workspace = await createWorkspace()
    const invalidMcpPath = join(
      workspace,
      'node_modules/@oneworks/plugin-demo/mcp/broken.yaml'
    )
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      await installPluginPackage(workspace, '@oneworks/plugin-demo', {
        'package.json': JSON.stringify(
          {
            name: '@oneworks/plugin-demo',
            version: '1.0.0'
          },
          null,
          2
        ),
        'mcp/browser.json': JSON.stringify({ command: 'npx', args: ['browser-server'] }, null, 2),
        'mcp/broken.yaml': 'command: npx\nargs: [broken\n'
      })

      const bundle = await resolveWorkspaceAssetBundle({
        cwd: workspace,
        configs: [{
          plugins: [
            { id: 'demo', scope: 'demo' }
          ]
        }, undefined],
        useDefaultOneworksMcpServer: false
      })

      expect(Object.keys(bundle.mcpServers)).toEqual(['demo/browser'])
      expect(warnSpy.mock.calls.map(([message]) => String(message))).toEqual(expect.arrayContaining([
        expect.stringContaining(`Ignoring invalid mcpServer asset "${invalidMcpPath}"`)
      ]))
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('loads workspace assets from the env-configured ai base dir', async () => {
    const workspace = await createWorkspace()
    const previousBaseDir = process.env.__ONEWORKS_PROJECT_BASE_DIR__

    try {
      process.env.__ONEWORKS_PROJECT_BASE_DIR__ = '.oneworks'
      await writeDocument(join(workspace, '.oneworks/rules/review.md'), '---\ndescription: 评审规则\n---\n必须检查风险')
      await writeDocument(
        join(workspace, '.oneworks/skills/research/SKILL.md'),
        '---\ndescription: 检索资料\n---\n阅读 README.md'
      )

      const bundle = await resolveWorkspaceAssetBundle({
        cwd: workspace,
        configs: [undefined, undefined],
        useDefaultOneworksMcpServer: false
      })

      expect(bundle.rules.map(asset => asset.displayName)).toEqual(['review'])
      expect(bundle.skills.map(asset => asset.displayName)).toEqual(['research'])
    } finally {
      if (previousBaseDir == null) {
        delete process.env.__ONEWORKS_PROJECT_BASE_DIR__
      } else {
        process.env.__ONEWORKS_PROJECT_BASE_DIR__ = previousBaseDir
      }
    }
  })

  it('loads local and dev rule files as workspace rules', async () => {
    const workspace = await createWorkspace()

    await writeDocument(
      join(workspace, '.oo/rules/team.md'),
      '---\ndescription: 团队规则\n---\n团队共享约束'
    )
    await writeDocument(
      join(workspace, '.oo/rules/preference.local.md'),
      '---\ndescription: 本地偏好\nalwaysApply: true\n---\n使用当前用户偏好的输出风格'
    )
    await writeDocument(
      join(workspace, '.oo/rules/debug.dev.md'),
      '---\ndescription: 本地调试\nalwaysApply: true\n---\n优先保留调试证据'
    )

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [undefined, undefined],
      useDefaultOneworksMcpServer: false
    })

    expect(bundle.rules.map(asset => asset.displayName).sort()).toEqual(['debug.dev', 'preference.local', 'team'])
    expect(bundle.rules.find(asset => asset.displayName === 'preference.local')?.payload.definition.body)
      .toContain('当前用户偏好')
    expect(bundle.rules.find(asset => asset.displayName === 'debug.dev')?.payload.definition.attributes.alwaysApply)
      .toBe(true)
  })

  it('bridges supported home skill roots by default and keeps the first duplicate root', async () => {
    const workspace = await createWorkspace()
    const realHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__

    await writeDocument(
      join(realHome!, '.agents/skills/research/SKILL.md'),
      '---\ndescription: 来自 agents root\n---\n阅读 README.md'
    )
    await writeDocument(
      join(realHome!, '.claude/skills/research/SKILL.md'),
      '---\ndescription: 来自 claude root\n---\n这份定义应被后面的 root 覆盖掉'
    )
    await writeDocument(
      join(realHome!, '.config/opencode/skills/release/SKILL.md'),
      '---\ndescription: 来自 opencode root\n---\n整理发布材料'
    )

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [undefined, undefined],
      useDefaultOneworksMcpServer: false
    })

    expect(bundle.skills.map(asset => asset.displayName)).toEqual(['research', 'release'])
    expect(bundle.skills.find(asset => asset.name === 'research')).toEqual(expect.objectContaining({
      origin: 'workspace',
      resolvedBy: 'home-bridge',
      sourcePath: join(realHome!, '.agents/skills/research/SKILL.md')
    }))
    expect(bundle.skills.find(asset => asset.name === 'release')).toEqual(expect.objectContaining({
      origin: 'workspace',
      resolvedBy: 'home-bridge',
      sourcePath: join(realHome!, '.config/opencode/skills/release/SKILL.md')
    }))
  })

  it('injects an isolated mock home into the default OneWorks MCP server', async () => {
    const workspace = await createWorkspace()
    const realHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [undefined, undefined]
    })

    expect(bundle.mcpServers.OneWorks.payload.config).toMatchObject({
      env: {
        HOME: resolveProjectHomePath(workspace, { HOME: realHome, __ONEWORKS_PROJECT_REAL_HOME__: realHome }, '.mock'),
        USERPROFILE: resolveProjectHomePath(
          workspace,
          { HOME: realHome, __ONEWORKS_PROJECT_REAL_HOME__: realHome },
          '.mock'
        ),
        __ONEWORKS_DISABLE_MOCK_HOME_BRIDGE: '1'
      }
    })
  })

  it('skips invalid home-bridged skill frontmatter and keeps resolving other skills', async () => {
    const workspace = await createWorkspace()
    const realHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__
    const invalidSkillPath = join(realHome!, '.agents/skills/broken/SKILL.md')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      await writeDocument(
        invalidSkillPath,
        '---\ndescription: Use minimal writing principles: understand the reader\n---\nBroken skill body'
      )
      await writeDocument(
        join(realHome!, '.agents/skills/research/SKILL.md'),
        '---\ndescription: Valid skill\n---\nValid skill body'
      )

      const bundle = await resolveWorkspaceAssetBundle({
        cwd: workspace,
        configs: [undefined, undefined],
        useDefaultOneworksMcpServer: false
      })

      expect(bundle.skills.map(asset => asset.displayName)).toEqual(['research'])
      expect(warnSpy.mock.calls.map(([message]) => String(message))).toEqual(expect.arrayContaining([
        expect.stringContaining(`Ignoring invalid skill asset "${invalidSkillPath}"`)
      ]))
      expect(warnSpy.mock.calls.map(([message]) => String(message))).toEqual(expect.arrayContaining([
        expect.stringContaining('quote plain strings containing ": "')
      ]))
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('can disable the home skill bridge entirely', async () => {
    const workspace = await createWorkspace()
    const realHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__

    await writeDocument(
      join(realHome!, '.agents/skills/research/SKILL.md'),
      '---\ndescription: 检索资料\n---\n阅读 README.md'
    )

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        skills: {
          homeBridge: {
            enabled: false
          }
        }
      }, undefined],
      useDefaultOneworksMcpServer: false
    })

    expect(bundle.skills).toEqual([])
  })

  it('supports custom home skill roots with tilde expansion', async () => {
    const workspace = await createWorkspace()
    const realHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__

    await writeDocument(
      join(realHome!, '.agents/skills/ignored/SKILL.md'),
      '---\ndescription: 默认目录\n---\n这份定义不应被加载'
    )
    await writeDocument(
      join(realHome!, 'custom-skills/writer/SKILL.md'),
      '---\ndescription: 自定义目录\n---\n产出说明文档'
    )

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        skills: {
          homeBridge: {
            roots: '~/custom-skills'
          }
        }
      }, undefined],
      useDefaultOneworksMcpServer: false
    })

    expect(bundle.skills.map(asset => asset.displayName)).toEqual(['writer'])
    expect(bundle.skills[0]?.sourcePath).toBe(join(realHome!, 'custom-skills/writer/SKILL.md'))
    expect(bundle.skills[0]?.resolvedBy).toBe('home-bridge')
  })

  it('keeps the first matching skill when multiple homeBridge roots contain the same name', async () => {
    const workspace = await createWorkspace()
    const realHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__

    await writeDocument(
      join(realHome!, '.claude/skills/research/SKILL.md'),
      '---\ndescription: 来自 claude root\n---\n优先保留这份定义'
    )
    await writeDocument(
      join(realHome!, '.agents/skills/research/SKILL.md'),
      '---\ndescription: 来自 agents root\n---\n这份定义应被后面的 root 跳过'
    )

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        skills: {
          homeBridge: {
            roots: ['~/.claude/skills', '~/.agents/skills']
          }
        }
      }, undefined],
      useDefaultOneworksMcpServer: false
    })

    expect(bundle.skills.map(asset => asset.displayName)).toEqual(['research'])
    expect(bundle.skills[0]).toEqual(expect.objectContaining({
      origin: 'workspace',
      resolvedBy: 'home-bridge',
      sourcePath: join(realHome!, '.claude/skills/research/SKILL.md')
    }))
  })

  it('warns once when a custom homeBridge root uses an unsupported relative path', async () => {
    const workspace = await createWorkspace()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      const bundle = await resolveWorkspaceAssetBundle({
        cwd: workspace,
        configs: [{
          skills: {
            homeBridge: {
              roots: ['./team-skills']
            }
          }
        }, undefined],
        useDefaultOneworksMcpServer: false
      })

      expect(bundle.skills).toEqual([])
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Ignoring invalid skillsMeta.homeBridge root "./team-skills"')
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('lets project and plugin skills override matching home-bridged skills', async () => {
    const workspace = await createWorkspace()
    const realHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__

    await writeDocument(
      join(realHome!, '.agents/skills/research/SKILL.md'),
      '---\ndescription: home research\n---\nhome research body'
    )
    await writeDocument(
      join(realHome!, '.agents/skills/review/SKILL.md'),
      '---\ndescription: home review\n---\nhome review body'
    )
    await writeDocument(
      join(workspace, '.oo/skills/research/SKILL.md'),
      '---\ndescription: project research\n---\nproject research body'
    )
    await installPluginPackage(workspace, '@oneworks/plugin-review', {
      'package.json': JSON.stringify(
        {
          name: '@oneworks/plugin-review',
          version: '1.0.0'
        },
        null,
        2
      ),
      'skills/review/SKILL.md': '---\ndescription: plugin review\n---\nplugin review body'
    })

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        plugins: [
          { id: 'review' }
        ]
      }, undefined],
      useDefaultOneworksMcpServer: false
    })

    expect(bundle.skills.map(asset => asset.displayName).sort()).toEqual(['research', 'review'])
    expect(bundle.skills.find(asset => asset.name === 'research')).toEqual(expect.objectContaining({
      sourcePath: join(workspace, '.oo/skills/research/SKILL.md'),
      resolvedBy: undefined
    }))
    expect(bundle.skills.find(asset => asset.name === 'review')).toEqual(expect.objectContaining({
      origin: 'plugin',
      sourcePath: expect.stringContaining('/node_modules/@oneworks/plugin-review/skills/review/SKILL.md')
    }))
  })

  it('keeps scoped project skills alongside unscoped home skills with the same base name', async () => {
    const workspace = await createWorkspace()
    const realHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__

    await writeDocument(
      join(realHome!, '.agents/skills/research/SKILL.md'),
      '---\ndescription: home research\n---\nhome research body'
    )
    await installPluginPackage(workspace, '@oneworks/plugin-team', {
      'package.json': JSON.stringify(
        {
          name: '@oneworks/plugin-team',
          version: '1.0.0'
        },
        null,
        2
      ),
      'skills/research/SKILL.md': '---\ndescription: scoped research\n---\nscoped research body'
    })

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        plugins: [
          { id: 'team', scope: 'team' }
        ]
      }, undefined],
      useDefaultOneworksMcpServer: false
    })

    expect(bundle.skills.map(asset => asset.displayName).sort()).toEqual(['research', 'team/research'])
    expect(bundle.skills.find(asset => asset.displayName === 'research')).toEqual(expect.objectContaining({
      resolvedBy: 'home-bridge'
    }))
    expect(bundle.skills.find(asset => asset.displayName === 'team/research')).toEqual(expect.objectContaining({
      origin: 'plugin'
    }))
  })

  it('does not install configured project skills during bundle resolution and warns when requested', async () => {
    const workspace = await createWorkspace()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        skills: [
          {
            name: 'design-review',
            source: 'example-source/default/public',
            rename: 'internal-review'
          }
        ]
      }, undefined],
      warnMissingConfiguredSkills: true,
      useDefaultOneworksMcpServer: false
    })

    expect(bundle.skills.map(asset => asset.name)).not.toContain('internal-review')
    expect(skillsCliMocks.installSkillsCliSkillToTemp).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Declared skills are not installed: internal-review'))
  })

  it('warns when a configured skill source collection is missing', async () => {
    const workspace = await createWorkspace()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        skills: [
          {
            include: ['*'],
            source: 'example-source/default/public'
          }
        ]
      }, undefined],
      warnMissingConfiguredSkills: true,
      useDefaultOneworksMcpServer: false
    })

    expect(bundle.skills.map(asset => asset.name)).toEqual([])
    expect(skillsCliMocks.installSkillsCliSourceToTemp).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Declared skill sources are not installed: example-source/default/public')
    )
  })

  it('does not warn for installed configured skill source collections', async () => {
    const workspace = await createWorkspace()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await writeDocument(
      join(workspace, '.oo/skills/source-review/SKILL.md'),
      '---\nname: source-review\ndescription: Existing skill\n---\nExisting content.\n'
    )
    await writeDocument(
      join(workspace, '.oo/skills.lock.yaml'),
      [
        'version: 1',
        'skills:',
        '  source-review:',
        '    name: source-review',
        '    requested: true',
        '    installPath: .oo/skills/source-review',
        '    source: example-source/default/public',
        '    hash: sha256:test',
        '    installedAt: "2026-05-14T00:00:00.000Z"'
      ].join('\n')
    )

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        skills: [
          {
            include: ['*'],
            source: 'example-source/default/public'
          }
        ]
      }, undefined],
      warnMissingConfiguredSkills: true,
      useDefaultOneworksMcpServer: false
    })

    expect(bundle.skills.map(asset => asset.name)).toContain('source-review')
    expect(warn).not.toHaveBeenCalled()
  })

  it('loads installed configured skills without attempting runtime updates', async () => {
    const workspace = await createWorkspace()
    await writeDocument(
      join(workspace, '.oo/skills/internal-review/SKILL.md'),
      '---\nname: internal-review\ndescription: Existing skill\n---\nExisting content.\n'
    )

    const skippedBundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        skills: [
          {
            name: 'design-review',
            source: 'example-source/default/public',
            rename: 'internal-review'
          }
        ]
      }, undefined],
      warnMissingConfiguredSkills: true,
      useDefaultOneworksMcpServer: false
    })

    expect(skippedBundle.skills.map(asset => asset.name)).toContain('internal-review')
    expect(skillsCliMocks.installSkillsCliSkillToTemp).not.toHaveBeenCalled()
  })

  it('loads workspace entities from the env-configured entities dir', async () => {
    const workspace = await createWorkspace()
    const previousEntitiesDir = process.env.__ONEWORKS_PROJECT_ENTITIES_DIR__

    try {
      process.env.__ONEWORKS_PROJECT_ENTITIES_DIR__ = 'agents'
      await writeDocument(
        join(workspace, '.oo/agents/reviewer/README.md'),
        '---\ndescription: 负责代码评审\n---\n检查风险'
      )

      const bundle = await resolveWorkspaceAssetBundle({
        cwd: workspace,
        configs: [undefined, undefined],
        useDefaultOneworksMcpServer: false
      })

      expect(bundle.entities.map(asset => asset.displayName)).toEqual(['reviewer'])
      expect(bundle.entities[0]?.sourcePath).toContain('/.oo/agents/reviewer/README.md')
    } finally {
      if (previousEntitiesDir == null) {
        delete process.env.__ONEWORKS_PROJECT_ENTITIES_DIR__
      } else {
        process.env.__ONEWORKS_PROJECT_ENTITIES_DIR__ = previousEntitiesDir
      }
    }
  })

  it('loads declared project-home managed Claude plugins as directory plugins', async () => {
    const workspace = await createWorkspace()
    const previousProjectHomeProjectsDir = process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = join(workspace, '.oneworks-projects')
    const installDir = getManagedPluginInstallDir(workspace, 'claude', 'demo', process.env)
    const oneworksDir = join(installDir, 'oneworks')

    try {
      await writeDocument(
        join(installDir, '.oneworks-plugin.json'),
        JSON.stringify(
          {
            version: 1,
            adapter: 'claude',
            name: 'demo',
            scope: 'demo',
            installedAt: new Date().toISOString(),
            source: {
              type: 'path',
              path: './demo'
            },
            nativePluginPath: 'native',
            oneworksPluginPath: 'oneworks'
          },
          null,
          2
        )
      )
      await writeDocument(
        join(installDir, 'native/server.js'),
        'process.stdout.write("ok")\n'
      )
      const claudePluginRootToken = '${' + 'CLAUDE_PLUGIN_ROOT}'
      const claudePluginDataToken = '${' + 'CLAUDE_PLUGIN_DATA}'
      await writeDocument(
        join(oneworksDir, 'skills/research/SKILL.md'),
        `---\ndescription: 检索资料\n---\nUse ${claudePluginRootToken} with ${claudePluginDataToken}`
      )
      await writeDocument(
        join(oneworksDir, 'mcp/browser.json'),
        JSON.stringify(
          {
            command: `${claudePluginRootToken}/server.js`,
            args: ['--data', claudePluginDataToken],
            env: {
              CLAUDE_PLUGIN_ROOT: claudePluginRootToken,
              CLAUDE_PLUGIN_DATA: claudePluginDataToken
            }
          },
          null,
          2
        )
      )
      await writeDocument(
        join(oneworksDir, 'hooks.js'),
        'module.exports = { name: "demo-managed" }\n'
      )

      const bundle = await resolveWorkspaceAssetBundle({
        cwd: workspace,
        configs: [
          {
            plugins: [
              {
                id: oneworksDir,
                scope: 'demo'
              }
            ]
          },
          undefined
        ],
        useDefaultOneworksMcpServer: false
      })
      const nativePluginRoot = join(installDir, 'native')
      const pluginDataRoot = resolveProjectHomePath(
        workspace,
        process.env,
        '.local',
        'plugins',
        'claude',
        'demo',
        'data'
      )

      expect(bundle.skills.map(asset => asset.displayName)).toContain('demo/research')
      expect(bundle.skills.find(asset => asset.displayName === 'demo/research')?.payload.definition.body)
        .toContain(`Use ${nativePluginRoot} with ${pluginDataRoot}`)
      expect(Object.keys(bundle.mcpServers)).toContain('demo/browser')
      expect(bundle.mcpServers['demo/browser']?.payload.config).toEqual(expect.objectContaining({
        command: `${nativePluginRoot}/server.js`,
        args: ['--data', pluginDataRoot],
        env: expect.objectContaining({
          CLAUDE_PLUGIN_ROOT: nativePluginRoot,
          CLAUDE_PLUGIN_DATA: pluginDataRoot
        })
      }))
      await expect(stat(pluginDataRoot)).resolves.toEqual(
        expect.objectContaining({ isDirectory: expect.any(Function) })
      )
      expect(bundle.hookPlugins).toEqual(expect.arrayContaining([
        expect.objectContaining({
          scope: 'demo',
          origin: 'plugin'
        })
      ]))
    } finally {
      if (previousProjectHomeProjectsDir == null) {
        delete process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
      } else {
        process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = previousProjectHomeProjectsDir
      }
    }
  })

  it('loads installed built-in marketplace plugins without an explicit plugins entry', async () => {
    const workspace = await createWorkspace()
    const previousProjectHomeProjectsDir = process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = join(workspace, '.oneworks-projects')
    const installDir = getManagedPluginInstallDir(
      workspace,
      'codex',
      'openai-plugins--github',
      process.env
    )
    const oneworksDir = join(installDir, 'oneworks')

    try {
      await writeDocument(
        join(installDir, '.oneworks-plugin.json'),
        JSON.stringify({
          version: 1,
          adapter: 'codex',
          name: 'github',
          scope: 'github-tools',
          installedAt: new Date().toISOString(),
          source: {
            type: 'marketplace',
            marketplace: 'openai-plugins',
            plugin: 'github'
          },
          nativePluginPath: 'native',
          oneworksPluginPath: 'oneworks'
        })
      )
      await writeDocument(
        join(oneworksDir, 'skills/review/SKILL.md'),
        '---\ndescription: Review GitHub changes\n---\nReview the pull request.'
      )

      const bundle = await resolveWorkspaceAssetBundle({
        cwd: workspace,
        configs: [
          {
            marketplaces: {
              'openai-plugins': {
                type: 'codex',
                plugins: { github: { enabled: true, scope: 'github-tools' } }
              }
            }
          },
          undefined
        ],
        useDefaultOneworksMcpServer: false
      })

      expect(bundle.pluginConfigs).toEqual([
        { id: oneworksDir, scope: 'github-tools' }
      ])
      expect(bundle.skills.map(asset => asset.displayName)).toContain('github-tools/review')
    } finally {
      if (previousProjectHomeProjectsDir == null) {
        delete process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
      } else {
        process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = previousProjectHomeProjectsDir
      }
    }
  })

  it('adds the built-in OneWorks MCP server when enabled and omits it when disabled', async () => {
    const workspace = await createWorkspace()

    const enabledBundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [undefined, undefined],
      useDefaultOneworksMcpServer: true
    })

    expect(enabledBundle.mcpServers).toHaveProperty('OneWorks')
    expect(enabledBundle.mcpServers.OneWorks?.payload.config).toEqual(expect.objectContaining({
      command: process.execPath,
      args: [expect.stringMatching(/packages\/mcp\/cli\.js$/)]
    }))

    const disabledBundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [undefined, undefined],
      useDefaultOneworksMcpServer: false
    })

    expect(disabledBundle.mcpServers).not.toHaveProperty('OneWorks')
  })

  it('discovers configured workspaces from glob patterns and entries', async () => {
    const workspace = await createWorkspace()

    await writeDocument(join(workspace, 'services/billing/README.md'), '# billing\n')
    await writeDocument(join(workspace, 'services/legacy/README.md'), '# legacy\n')
    await writeDocument(join(workspace, 'docs/README.md'), '# docs\n')

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        workspaces: {
          include: ['services/*'],
          exclude: ['services/legacy'],
          entries: {
            docs: {
              path: 'docs',
              description: 'Documentation workspace'
            }
          }
        }
      }, undefined],
      useDefaultOneworksMcpServer: false
    })

    expect(bundle.workspaces.map(asset => asset.displayName)).toEqual(['billing', 'docs'])
    expect(bundle.workspaces.map(asset => asset.payload)).toEqual([
      expect.objectContaining({
        id: 'billing',
        path: 'services/billing'
      }),
      expect.objectContaining({
        id: 'docs',
        path: 'docs',
        description: 'Documentation workspace'
      })
    ])
  })

  it('skips disabled plugin instances and lets disabled child overrides suppress default child activation', async () => {
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
      'skills/research/SKILL.md': '---\ndescription: 检索资料\n---\n阅读 README.md'
    })
    await installPluginPackage(workspace, '@oneworks/plugin-bundle', {
      'package.json': JSON.stringify(
        {
          name: '@oneworks/plugin-bundle',
          version: '1.0.0'
        },
        null,
        2
      ),
      'index.js': [
        'module.exports = {',
        '  __oneWorksPluginManifest: true,',
        '  children: {',
        '    review: {',
        '      source: { type: "package", id: "@oneworks/plugin-review" },',
        '      activation: "default"',
        '    }',
        '  }',
        '}',
        ''
      ].join('\n')
    })
    await installPluginPackage(workspace, '@oneworks/plugin-review', {
      'package.json': JSON.stringify(
        {
          name: '@oneworks/plugin-review',
          version: '1.0.0'
        },
        null,
        2
      ),
      'skills/audit/SKILL.md': '---\ndescription: 代码审计\n---\n检查 child plugin 是否启用'
    })

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        plugins: [
          { id: 'demo', scope: 'demo', enabled: false },
          {
            id: 'bundle',
            scope: 'bundle',
            children: [
              { id: 'review', enabled: false }
            ]
          }
        ]
      }, undefined],
      useDefaultOneworksMcpServer: false
    })

    expect(bundle.skills).toEqual([])
    expect(bundle.pluginInstances.map(instance => instance.packageId)).toEqual(['@oneworks/plugin-bundle'])
  })

  it('composes scoped child assets without adding another top-level plugin instance', async () => {
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
      'index.js': [
        'module.exports = {',
        '  __oneWorksPluginManifest: true,',
        '  children: {',
        '    "standard-dev": {',
        '      source: { type: "package", id: "@oneworks/plugin-standard-dev" },',
        '      activation: "optional"',
        '    }',
        '  }',
        '}',
        ''
      ].join('\n')
    })
    await installPluginPackage(workspace, '@oneworks/plugin-standard-dev', {
      'package.json': JSON.stringify(
        {
          name: '@oneworks/plugin-standard-dev',
          version: '1.0.0'
        },
        null,
        2
      ),
      'skills/standard-dev-flow/SKILL.md': [
        '---',
        'name: standard-dev-flow',
        'description: 标准研发流程',
        '---',
        '执行标准研发流程'
      ].join('\n'),
      'entities/dev-planner/README.md': [
        '---',
        'description: 标准研发规划实体',
        'skills:',
        '  - standard-dev-flow',
        '---',
        '规划研发任务'
      ].join('\n')
    })

    const bundle = await resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        plugins: [{
          id: 'demo',
          scope: 'demo',
          children: [{ id: 'standard-dev', scope: 'std' }]
        }]
      }, undefined],
      useDefaultOneworksMcpServer: false
    })

    expect(bundle.pluginInstances).toHaveLength(1)
    expect(bundle.pluginInstances[0]).toMatchObject({
      packageId: '@oneworks/plugin-demo',
      scope: 'demo'
    })
    expect(bundle.pluginInstances[0]?.children).toEqual([
      expect.objectContaining({
        packageId: '@oneworks/plugin-standard-dev',
        scope: 'std'
      })
    ])
    expect(bundle.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({
        displayName: 'std/standard-dev-flow',
        packageId: '@oneworks/plugin-standard-dev'
      })
    ]))
    expect(bundle.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        displayName: 'std/dev-planner',
        packageId: '@oneworks/plugin-standard-dev'
      })
    ]))
  })

  it('lets later config layers disable matching plugin instances by id and scope', async () => {
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
      configs: [
        {
          plugins: [
            { id: 'logger' }
          ]
        },
        {
          plugins: [
            { id: 'logger', enabled: false }
          ]
        }
      ],
      useDefaultOneworksMcpServer: false
    })

    expect(bundle.pluginConfigs).toEqual([
      { id: 'logger', enabled: false }
    ])
    expect(bundle.pluginInstances).toEqual([])
    expect(bundle.hookPlugins).toEqual([])
  })

  it('surfaces invalid plugin manifests instead of silently falling back to directory scanning', async () => {
    const workspace = await createWorkspace()

    await installPluginPackage(workspace, '@oneworks/plugin-bad-manifest', {
      'package.json': JSON.stringify(
        {
          name: '@oneworks/plugin-bad-manifest',
          version: '1.0.0',
          exports: {
            '.': './index.js'
          }
        },
        null,
        2
      ),
      'index.js': [
        'module.exports = {',
        '  __oneWorksPluginManifest: true,',
        '  scope: "bad",',
        '  assets: {',
        '    skills: "./custom-skills"',
        '  }',
        '}',
        ''
      ].join('\n'),
      'custom-skills/research/SKILL.md': '---\ndescription: 检索资料\n---\n阅读 README.md'
    })

    await expect(resolveWorkspaceAssetBundle({
      cwd: workspace,
      configs: [{
        plugins: [
          { id: '@oneworks/plugin-bad-manifest' }
        ]
      }, undefined],
      useDefaultOneworksMcpServer: false
    })).rejects.toThrow('Failed to load plugin manifest for @oneworks/plugin-bad-manifest')
  })
})
