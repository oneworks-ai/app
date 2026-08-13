/* eslint-disable max-lines -- integration fixtures stay together to share isolated workspace lifecycle. */
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { generateAdapterQueryOptions } from '#~/generate-adapter-query-options.js'
import { resolveProjectOoPath } from '@oneworks/utils'

const tempDirs: string[] = []
const originalRuntimeProtocolConsumer = process.env.__ONEWORKS_RUNTIME_PROTOCOL_CONSUMER__
const originalProjectHomeProjectsDir = process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
const originalProjectWorkspaceFolder = process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
const originalPackageCacheDir = process.env.__ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__
const originalKiroApiKey = process.env.KIRO_API_KEY

const createWorkspace = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'generate-adapter-query-options-'))
  tempDirs.push(dir)
  return dir
}

const writeDocument = async (filePath: string, content: string) => {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
}

const configVariable = (name: string) => ['$', '{', name, '}'].join('')

afterEach(async () => {
  if (originalRuntimeProtocolConsumer == null) {
    delete process.env.__ONEWORKS_RUNTIME_PROTOCOL_CONSUMER__
  } else {
    process.env.__ONEWORKS_RUNTIME_PROTOCOL_CONSUMER__ = originalRuntimeProtocolConsumer
  }
  if (originalProjectHomeProjectsDir == null) {
    delete process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
  } else {
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = originalProjectHomeProjectsDir
  }
  if (originalProjectWorkspaceFolder == null) {
    delete process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
  } else {
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = originalProjectWorkspaceFolder
  }
  if (originalPackageCacheDir == null) {
    delete process.env.__ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__
  } else {
    process.env.__ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__ = originalPackageCacheDir
  }
  if (originalKiroApiKey == null) {
    delete process.env.KIRO_API_KEY
  } else {
    process.env.KIRO_API_KEY = originalKiroApiKey
  }
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('generateAdapterQueryOptions', () => {
  it('scrubs Kiro workspace query-options cache without mutating live MCP inputs', async () => {
    const workspace = await createWorkspace()
    const firstSecret = 'kiro-query-options secret/+?first'
    const secondSecret = 'kiro-query-options secret/+?second'
    process.env.__ONEWORKS_RUNTIME_PROTOCOL_CONSUMER__ = '1'
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = join(workspace, '.oneworks-projects')
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspace
    process.env.KIRO_API_KEY = firstSecret
    const configPath = join(workspace, '.oo.config.json')
    const writeMcpConfig = async (secret: string) => {
      const encoded = encodeURIComponent(secret)
      const fullyEncoded = [...Buffer.from(secret, 'utf8')]
        .map((byte, index) =>
          `%${
            index % 2 === 0
              ? byte.toString(16).padStart(2, '0').toUpperCase()
              : byte.toString(16).padStart(2, '0')
          }`
        )
        .join('')
      await writeDocument(
        configPath,
        JSON.stringify(
          {
            disableGlobalConfig: true,
            adapters: {
              kiro: {
                configContent: {
                  [`header-${secret}`]: 'sensitive-key-value',
                  [`encoded-${encoded}`]: 'encoded-key-value'
                }
              }
            },
            defaultIncludeMcpServers: ['stdio', 'remote', 'events'],
            mcpServers: {
              stdio: {
                command: process.execPath,
                args: ['fixture.mjs'],
                env: {
                  TOKEN: configVariable('KIRO_API_KEY'),
                  AUTHORIZATION: `Bearer ${configVariable('KIRO_API_KEY')}`,
                  SAFE_MODE: 'read-only'
                }
              },
              remote: {
                type: 'http',
                url: `https://example.test/mcp?token=${configVariable('KIRO_API_KEY')}`,
                headers: {
                  Authorization: `Bearer ${configVariable('KIRO_API_KEY')}`,
                  'x-encoded-secret': encoded,
                  'x-safe-header': 'safe-value'
                }
              },
              events: {
                type: 'sse',
                url: `https://example.test/events?encoded=${fullyEncoded}`,
                headers: { 'x-secret': configVariable('KIRO_API_KEY'), 'x-fully-encoded': fullyEncoded }
              }
            }
          },
          null,
          2
        )
      )
    }
    await writeMcpConfig(firstSecret)

    const generate = async () =>
      await generateAdapterQueryOptions(
        undefined,
        undefined,
        workspace,
        { adapter: 'kiro' }
      )
    const [, firstLiveOptions] = await generate()
    expect(JSON.stringify(firstLiveOptions)).toContain(firstSecret)
    expect(firstLiveOptions.assetBundle?.mcpServers.stdio?.payload.config).toEqual(expect.objectContaining({
      env: expect.objectContaining({ TOKEN: firstSecret, SAFE_MODE: 'read-only' })
    }))

    const cacheDir = resolveProjectOoPath(workspace, process.env, 'caches', 'workspace-query-options')
    const firstCacheFiles = await readdir(cacheDir)
    expect(firstCacheFiles).toHaveLength(1)
    const firstDisk = await readFile(join(cacheDir, firstCacheFiles[0]!), 'utf8')
    for (
      const material of [
        firstSecret,
        encodeURIComponent(firstSecret),
        Buffer.from(firstSecret).toString('base64'),
        `header-${firstSecret}`
      ]
    ) expect(firstDisk).not.toContain(material)
    expect(firstDisk).toContain('SAFE_MODE')
    expect(firstDisk).toContain('read-only')
    expect(firstDisk).toContain('x-safe-header')

    const cachedEntry = JSON.parse(firstDisk) as { resolvedOptions: { systemPrompt?: string } }
    cachedEntry.resolvedOptions.systemPrompt = 'redacted-cache-must-not-reach-live-runtime'
    await writeFile(join(cacheDir, firstCacheFiles[0]!), JSON.stringify(cachedEntry), 'utf8')
    const [, cacheHitRegeneratedOptions] = await generate()
    expect(JSON.stringify(cacheHitRegeneratedOptions)).toContain(firstSecret)
    expect(JSON.stringify(cacheHitRegeneratedOptions)).not.toContain('[redacted Kiro credential]')
    expect(JSON.stringify(cacheHitRegeneratedOptions)).not.toContain('redacted-cache-must-not-reach-live-runtime')

    process.env.KIRO_API_KEY = secondSecret
    await writeMcpConfig(secondSecret)
    const [, resumedLiveOptions] = await generate()
    expect(JSON.stringify(resumedLiveOptions)).toContain(secondSecret)
    expect(JSON.stringify(resumedLiveOptions)).not.toContain(firstSecret)
    const allDisk = (await Promise.all(
      (await readdir(cacheDir)).map(async file => await readFile(join(cacheDir, file), 'utf8'))
    )).join('\n')
    for (const material of [firstSecret, secondSecret, encodeURIComponent(secondSecret)]) {
      expect(allDisk).not.toContain(material)
    }
  })

  it('invalidates runtime query option cache when selected asset files change', async () => {
    const workspace = await createWorkspace()
    process.env.__ONEWORKS_RUNTIME_PROTOCOL_CONSUMER__ = '1'
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = join(workspace, '.oneworks-projects')
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspace
    const skillPath = join(workspace, '.oo/skills/research/SKILL.md')

    await writeDocument(
      skillPath,
      '---\ndescription: 初始检索资料\n---\n阅读 README.md'
    )

    const [, firstResolvedConfig] = await generateAdapterQueryOptions(
      undefined,
      undefined,
      workspace,
      {
        adapter: 'custom',
        skills: {
          include: ['research']
        }
      }
    )

    await new Promise(resolve => setTimeout(resolve, 20))
    await writeDocument(
      skillPath,
      '---\ndescription: 更新后的检索资料\n---\n阅读 README.md'
    )

    const [, secondResolvedConfig] = await generateAdapterQueryOptions(
      undefined,
      undefined,
      workspace,
      {
        adapter: 'custom',
        skills: {
          include: ['research']
        }
      }
    )

    expect(firstResolvedConfig.systemPrompt).toContain('初始检索资料')
    expect(secondResolvedConfig.systemPrompt).toContain('更新后的检索资料')
    expect(secondResolvedConfig.systemPrompt).not.toContain('初始检索资料')
  })

  it('keeps entity prompt generation stable when entity metadata contains rule references', async () => {
    const workspace = await createWorkspace()

    await writeDocument(
      join(workspace, '.oo/entities/api-developer/rules/migrate.md'),
      '---\ndescription: 文件内描述\n---\n遵循新的 API 迁移流程'
    )
    await writeDocument(
      join(workspace, '.oo/entities/api-developer/index.json'),
      JSON.stringify(
        {
          prompt: '你是 API 开发实体',
          rules: [
            {
              path: './rules/migrate.md',
              desc: '迁移老范式的 API 代码到新范式'
            },
            {
              type: 'remote',
              tags: ['business', 'api-develop'],
              desc: '遇到未说明的方法时，可查询远程知识库'
            }
          ]
        },
        null,
        2
      )
    )

    const [, resolvedConfig] = await generateAdapterQueryOptions(
      'entity',
      'api-developer',
      workspace
    )

    expect(resolvedConfig.systemPrompt).toContain('你是 API 开发实体')
  })

  it('keeps explicitly included skills as route guidance in normal mode', async () => {
    const workspace = await createWorkspace()

    await writeDocument(
      join(workspace, '.oo/skills/research/SKILL.md'),
      '---\ndescription: 检索资料\n---\n阅读 README.md'
    )
    await writeDocument(
      join(workspace, '.oo/skills/review/SKILL.md'),
      '---\ndescription: 代码评审\n---\n检查风险'
    )

    const [, resolvedConfig] = await generateAdapterQueryOptions(
      undefined,
      undefined,
      workspace,
      {
        adapter: 'custom',
        skills: {
          include: ['research']
        }
      }
    )

    expect(resolvedConfig.systemPrompt).not.toContain('The following skill modules are loaded for the project')
    expect(resolvedConfig.systemPrompt).toContain('<skills>')
    expect(resolvedConfig.systemPrompt).toContain('# research')
    expect(resolvedConfig.systemPrompt).toContain('> Skill description: 检索资料')
    expect(resolvedConfig.systemPrompt).toContain('> Skill file path: .oo/skills/research/SKILL.md')
    expect(resolvedConfig.systemPrompt).toContain(
      '> Do not preload the body by default; read the corresponding skill file only when the task clearly requires it.'
    )
    expect(resolvedConfig.systemPrompt).not.toContain('<skill-content>')
    expect(resolvedConfig.systemPrompt).not.toContain('# review')
  })

  it('removes excluded skills from the generated skill routes', async () => {
    const workspace = await createWorkspace()

    await writeDocument(
      join(workspace, '.oo/skills/research/SKILL.md'),
      '---\ndescription: 检索资料\n---\n阅读 README.md'
    )
    await writeDocument(
      join(workspace, '.oo/skills/review/SKILL.md'),
      '---\ndescription: 代码评审\n---\n检查风险'
    )

    const [, resolvedConfig] = await generateAdapterQueryOptions(
      undefined,
      undefined,
      workspace,
      {
        adapter: 'custom',
        skills: {
          exclude: ['review']
        }
      }
    )

    expect(resolvedConfig.systemPrompt).toContain('<skills>')
    expect(resolvedConfig.systemPrompt).toContain('# research')
    expect(resolvedConfig.systemPrompt).toContain('> Skill file path: .oo/skills/research/SKILL.md')
    expect(resolvedConfig.systemPrompt).not.toContain('# review')
    expect(resolvedConfig.systemPrompt).not.toContain('<skill-content>')
  })

  it('omits route-only skills when the resolved adapter provides native project skills', async () => {
    const workspace = await createWorkspace()

    await writeDocument(
      join(workspace, '.oo.config.json'),
      JSON.stringify(
        {
          adapters: {
            'claude-code': {},
            codex: {}
          },
          modelServices: {
            gpt: {
              apiBaseUrl: 'https://example.invalid/responses',
              apiKey: 'demo',
              models: ['kimi-k2.5']
            }
          },
          models: {
            'gpt,kimi-k2.5': {
              defaultAdapter: 'claude-code'
            }
          }
        },
        null,
        2
      )
    )
    await writeDocument(
      join(workspace, '.oo/skills/research/SKILL.md'),
      '---\ndescription: 检索资料\n---\n阅读 README.md'
    )

    const [, resolvedConfig] = await generateAdapterQueryOptions(
      undefined,
      undefined,
      workspace,
      {
        model: 'gpt,kimi-k2.5'
      }
    )

    expect(resolvedConfig.systemPrompt).not.toContain('<skills>')
    expect(resolvedConfig.systemPrompt).not.toContain('# research')
    expect(resolvedConfig.systemPrompt).not.toContain('Skill file path: .oo/skills/research/SKILL.md')
  })

  it('supports entity skill include selectors', async () => {
    const workspace = await createWorkspace()

    await writeDocument(
      join(workspace, '.oo/skills/research/SKILL.md'),
      '---\ndescription: 检索资料\n---\n阅读 README.md'
    )
    await writeDocument(
      join(workspace, '.oo/skills/review/SKILL.md'),
      '---\ndescription: 代码评审\n---\n检查风险'
    )
    await writeDocument(
      join(workspace, '.oo/entities/api-developer/index.json'),
      JSON.stringify(
        {
          prompt: '你是 API 开发实体',
          skills: {
            type: 'include',
            list: ['review']
          }
        },
        null,
        2
      )
    )

    const [, resolvedConfig] = await generateAdapterQueryOptions(
      'entity',
      'api-developer',
      workspace,
      { adapter: 'custom' }
    )

    expect(resolvedConfig.systemPrompt).toContain('The following skill modules are loaded for the project')
    expect(resolvedConfig.systemPrompt).toContain('# review')
    expect(resolvedConfig.systemPrompt).toContain('> Skill description: 代码评审')
    expect(resolvedConfig.systemPrompt).toContain('<skill-content>')
    expect(resolvedConfig.systemPrompt).toContain('检查风险')
    expect(resolvedConfig.systemPrompt).not.toContain('<skills>\n# review')
    expect(resolvedConfig.systemPrompt).toContain('<skills>')
    expect(resolvedConfig.systemPrompt).toContain('# research')
  })

  it('supports entity skill exclude selectors', async () => {
    const workspace = await createWorkspace()

    await writeDocument(
      join(workspace, '.oo/skills/research/SKILL.md'),
      '---\ndescription: 检索资料\n---\n阅读 README.md'
    )
    await writeDocument(
      join(workspace, '.oo/skills/review/SKILL.md'),
      '---\ndescription: 代码评审\n---\n检查风险'
    )
    await writeDocument(
      join(workspace, '.oo/entities/api-developer/index.json'),
      JSON.stringify(
        {
          prompt: '你是 API 开发实体',
          skills: {
            type: 'exclude',
            list: ['review']
          }
        },
        null,
        2
      )
    )

    const [, resolvedConfig] = await generateAdapterQueryOptions(
      'entity',
      'api-developer',
      workspace,
      { adapter: 'custom' }
    )

    expect(resolvedConfig.systemPrompt).toContain('The following skill modules are loaded for the project')
    expect(resolvedConfig.systemPrompt).toContain('# research')
    expect(resolvedConfig.systemPrompt).toContain('<skill-content>')
    expect(resolvedConfig.systemPrompt).toContain('阅读 README.md')
    expect(resolvedConfig.systemPrompt).toContain('<skills>')
    expect(resolvedConfig.systemPrompt).toContain('# review')
    expect(resolvedConfig.systemPrompt).not.toContain('<skills>\n# research')
    expect(resolvedConfig.systemPrompt).not.toContain('<skill-content>\n检查风险\n</skill-content>')
  })

  it('loads route skills from injected plugin packages', async () => {
    const workspace = await createWorkspace()
    const pluginDir = join(workspace, 'node_modules', '@oneworks', 'plugin-cli-skills')

    await writeDocument(
      join(pluginDir, 'package.json'),
      JSON.stringify(
        {
          name: '@oneworks/plugin-cli-skills',
          version: '1.0.0'
        },
        null,
        2
      )
    )
    await writeDocument(
      join(pluginDir, 'skills', 'oneworks-cli-quickstart', 'SKILL.md'),
      '---\ndescription: CLI 快速入门\n---\n先执行 oneworks list 再恢复会话'
    )

    const [, resolvedConfig] = await generateAdapterQueryOptions(
      undefined,
      undefined,
      workspace,
      {
        adapter: 'custom',
        plugins: [
          {
            id: '@oneworks/plugin-cli-skills'
          }
        ]
      }
    )

    expect(resolvedConfig.systemPrompt).toContain('<skills>')
    expect(resolvedConfig.systemPrompt).toContain('# oneworks-cli-quickstart')
    expect(resolvedConfig.systemPrompt).toContain('> Skill description: CLI 快速入门')
  })

  it('adds configured workspace routes to the default system prompt', async () => {
    const workspace = await createWorkspace()

    await writeDocument(
      join(workspace, '.oo.config.json'),
      JSON.stringify(
        {
          workspaces: {
            include: ['services/*']
          }
        },
        null,
        2
      )
    )
    await writeDocument(join(workspace, 'services/billing/README.md'), '# billing\n')

    const [, resolvedConfig] = await generateAdapterQueryOptions(
      undefined,
      undefined,
      workspace
    )

    expect(resolvedConfig.systemPrompt).toContain('The project includes the following registered workspaces')
    expect(resolvedConfig.systemPrompt).toContain('Identifier: billing')
    expect(resolvedConfig.systemPrompt).toContain('Path: services/billing')
    expect(resolvedConfig.systemPrompt).toContain('session.start')
  })

  it('loads task assets from the selected workspace target', async () => {
    const workspace = await createWorkspace()

    await writeDocument(
      join(workspace, '.oo.config.json'),
      JSON.stringify(
        {
          workspaces: {
            include: ['services/*']
          }
        },
        null,
        2
      )
    )
    await writeDocument(join(workspace, 'services/billing/.oo/rules/always.md'), '---\nalways: true\n---\nBilling rule')

    const [, resolvedConfig] = await generateAdapterQueryOptions(
      'workspace',
      'billing',
      workspace
    )

    expect(resolvedConfig.workspace?.path).toBe('services/billing')
    expect(resolvedConfig.systemPrompt).toContain('Billing rule')
  })

  it('merges injected plugins with workspace config plugins in the returned asset bundle', async () => {
    const workspace = await createWorkspace()
    process.env.__ONEWORKS_PROJECT_PACKAGE_CACHE_DIR__ = join(workspace, '.package-cache')
    const cliPluginDir = join(workspace, 'node_modules', '@oneworks', 'plugin-cli-skills')
    const loggerPluginDir = join(workspace, 'node_modules', '@oneworks', 'plugin-logger')

    await writeDocument(
      join(workspace, '.oo.config.json'),
      JSON.stringify(
        {
          disableGlobalConfig: true,
          plugins: [
            {
              id: 'logger'
            }
          ]
        },
        null,
        2
      )
    )
    await writeDocument(
      join(cliPluginDir, 'package.json'),
      JSON.stringify(
        {
          name: '@oneworks/plugin-cli-skills',
          version: '1.0.0'
        },
        null,
        2
      )
    )
    await writeDocument(
      join(cliPluginDir, 'skills', 'oneworks-cli-quickstart', 'SKILL.md'),
      '---\ndescription: CLI 快速入门\n---\n先执行 oneworks list 再恢复会话'
    )
    await writeDocument(
      join(loggerPluginDir, 'package.json'),
      JSON.stringify(
        {
          name: '@oneworks/plugin-logger',
          version: '1.0.0'
        },
        null,
        2
      )
    )
    await writeDocument(
      join(loggerPluginDir, 'hooks.js'),
      'module.exports = { TaskStart: async (_ctx, _input, next) => next() }\n'
    )

    const [, resolvedConfig] = await generateAdapterQueryOptions(
      undefined,
      undefined,
      workspace,
      {
        plugins: [
          {
            id: '@oneworks/plugin-cli-skills'
          }
        ]
      }
    )

    expect(resolvedConfig.assetBundle?.pluginConfigs).toEqual([
      { id: 'logger' },
      { id: '@oneworks/plugin-cli-skills' }
    ])
    expect(resolvedConfig.assetBundle?.hookPlugins.map(asset => asset.packageId)).toEqual([
      '@oneworks/plugin-logger'
    ])
  })
})
