/* eslint-disable max-lines -- skill hub flow coverage keeps registry/search/install regressions together. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetConfigCache } from '@oneworks/config'
import { clearSkillsCliCachesForTest } from '@oneworks/utils/skills-cli'

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  resolveManagedNpmCliInstallOptions: vi.fn(),
  updateConfigFile: vi.fn()
}))

vi.mock('@oneworks/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@oneworks/config')>()
  mocks.updateConfigFile.mockImplementation(actual.updateConfigFile)
  return {
    ...actual,
    updateConfigFile: mocks.updateConfigFile
  }
})

vi.mock('node:child_process', () => ({
  execFile: mocks.execFile
}))

vi.mock('@oneworks/utils/managed-npm-cli', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@oneworks/utils/managed-npm-cli')>()
  return {
    ...actual,
    resolveManagedNpmCliInstallOptions: mocks.resolveManagedNpmCliInstallOptions
  }
})

const createExecImplementation = (
  callback: (
    args: string[],
    options: { cwd?: string }
  ) => { stderr?: string; stdout?: string } | Error | Promise<{ stderr?: string; stdout?: string } | Error>
) => {
  mocks.execFile.mockImplementation(
    ((...invokeArgs: any[]) => {
      const args = invokeArgs[1] as string[]
      const options = invokeArgs[2] as { cwd?: string }
      const done = invokeArgs[3] as ((error: Error | null, stdout: string, stderr: string) => void)

      Promise.resolve(callback(args, options))
        .then((result) => {
          if (result instanceof Error) {
            done(
              result,
              (result as Error & { stdout?: string }).stdout ?? '',
              (result as Error & { stderr?: string }).stderr ?? ''
            )
            return
          }

          done(null, result.stdout ?? '', result.stderr ?? '')
        })
        .catch((error) => {
          done(error, error?.stdout ?? '', error?.stderr ?? '')
        })

      return {} as any
    }) as any
  )
}

describe('skills CLI-backed skill hub flow', () => {
  let workspace = ''
  let originalRealHomeEnv: string | undefined
  let originalWorkspaceEnv: string | undefined

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), 'ow-skill-hub-skills-cli-'))
    originalRealHomeEnv = process.env.__ONEWORKS_PROJECT_REAL_HOME__
    originalWorkspaceEnv = process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
    process.env.__ONEWORKS_PROJECT_REAL_HOME__ = path.join(workspace, '.test-home')
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspace
    resetConfigCache()
    clearSkillsCliCachesForTest()
    vi.clearAllMocks()
    mocks.resolveManagedNpmCliInstallOptions.mockImplementation((params: {
      config?: {
        package?: string
        source?: 'managed' | 'path' | 'system'
        version?: string
      }
    }) => {
      const packageName = params.config?.package ?? 'skills'
      const version = params.config?.version ?? 'latest'
      return {
        autoInstall: true,
        npmPath: 'npm',
        packageName,
        packageSpec: `${packageName}@${version}`,
        source: params.config?.source ?? 'managed',
        version
      }
    })
  })

  afterEach(async () => {
    if (originalRealHomeEnv == null) {
      delete process.env.__ONEWORKS_PROJECT_REAL_HOME__
    } else {
      process.env.__ONEWORKS_PROJECT_REAL_HOME__ = originalRealHomeEnv
    }
    if (originalWorkspaceEnv == null) {
      delete process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
    } else {
      process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = originalWorkspaceEnv
    }
    resetConfigCache()
    clearSkillsCliCachesForTest()
    await rm(workspace, { recursive: true, force: true })
  })

  it('parses fancy skills --list output', async () => {
    const { parseSkillsCliListOutput } = await import('#~/services/skill-hub/skills-cli.js')
    expect(parseSkillsCliListOutput([
      '◇  Available Skills',
      '│',
      '│    internal-review',
      '│',
      '│      Review code with internal checklists.',
      '│',
      '│    docs-writer',
      '│',
      '│      Write release docs with internal templates.',
      '│',
      '└  Use --skill <name> to install specific skills'
    ].join('\n'))).toEqual([
      {
        name: 'internal-review',
        description: 'Review code with internal checklists.'
      },
      {
        name: 'docs-writer',
        description: 'Write release docs with internal templates.'
      }
    ])
  })

  it('searches built-in official registries without requiring config', async () => {
    const skillBySource = new Map([
      ['vercel-labs/agent-skills', 'vercel-react-best-practices'],
      ['anthropics/skills', 'frontend-design'],
      ['microsoft/skills', 'microsoft-docs']
    ])
    const startedSources: string[] = []
    let releaseSearches: () => void = () => undefined
    const searchGate = new Promise<void>((resolve) => {
      releaseSearches = resolve
    })
    createExecImplementation(async (args) => {
      const source = args[args.indexOf('add') + 1]
      const skill = source == null ? undefined : skillBySource.get(source)
      if (skill == null) return new Error(`Unexpected built-in source: ${source}`)
      startedSources.push(source)
      await searchGate
      return { stdout: `  ${skill} - Official skill from ${source}.` }
    })

    const { searchSkillHub } = await import('#~/services/skill-hub/index.js')
    const searchPromise = searchSkillHub()
    let parallelStartError: unknown
    try {
      await vi.waitFor(() => expect(startedSources).toHaveLength(3), { timeout: 500 })
    } catch (error) {
      parallelStartError = error
    } finally {
      releaseSearches()
    }
    const result = await searchPromise
    if (parallelStartError != null) throw parallelStartError

    expect(result.registries).toEqual([
      expect.objectContaining({
        builtIn: true,
        id: 'project:vercel-labs/agent-skills',
        source: 'vercel-labs/agent-skills',
        title: 'Vercel Agent Skills'
      }),
      expect.objectContaining({
        builtIn: true,
        id: 'project:anthropics/skills',
        source: 'anthropics/skills',
        title: 'Anthropic Skills'
      }),
      expect.objectContaining({
        builtIn: true,
        id: 'project:microsoft/skills',
        source: 'microsoft/skills',
        title: 'Microsoft Skills'
      })
    ])
    expect(result.items.map(item => ({ builtIn: item.builtIn, name: item.name, source: item.source }))).toEqual([
      { builtIn: true, name: 'frontend-design', source: 'anthropics/skills' },
      { builtIn: true, name: 'microsoft-docs', source: 'microsoft/skills' },
      { builtIn: true, name: 'vercel-react-best-practices', source: 'vercel-labs/agent-skills' }
    ])
    expect(mocks.execFile).toHaveBeenCalledTimes(3)
    mocks.execFile.mock.calls.forEach(call => {
      expect(call[2]).toEqual(expect.objectContaining({ timeout: 30_000 }))
    })
  })

  it('limits concurrent registry searches to three child processes', async () => {
    const sources = Array.from({ length: 5 }, (_, index) => `example-source/catalog-${index + 1}`)
    await writeFile(
      path.join(workspace, '.oo.config.json'),
      JSON.stringify({ skillsMeta: { sources } })
    )
    const startedSources: string[] = []
    let releaseSearches: () => void = () => undefined
    const searchGate = new Promise<void>((resolve) => {
      releaseSearches = resolve
    })
    createExecImplementation(async (args) => {
      const source = args[args.indexOf('add') + 1]!
      startedSources.push(source)
      await searchGate
      return { stdout: `  example-skill - Skill from ${source}.` }
    })

    const { searchSkillHub } = await import('#~/services/skill-hub/index.js')
    const searchPromise = searchSkillHub({ includeBuiltIns: false })
    let concurrencyError: unknown
    try {
      await vi.waitFor(() => expect(startedSources).toHaveLength(3), { timeout: 500 })
      await Promise.resolve()
      expect(startedSources).toHaveLength(3)
    } catch (error) {
      concurrencyError = error
    } finally {
      releaseSearches()
    }

    const result = await searchPromise
    if (concurrencyError != null) throw concurrencyError
    expect(result.registries).toHaveLength(5)
    expect(startedSources).toHaveLength(5)
  })

  it('keeps healthy built-in registry results when another source fails', async () => {
    createExecImplementation((args) => {
      const source = args[args.indexOf('add') + 1]
      if (source === 'anthropics/skills') return new Error('Anthropic source unavailable')
      if (source === 'vercel-labs/agent-skills') {
        return { stdout: '  vercel-react-best-practices - Vercel React guidance.' }
      }
      if (source === 'microsoft/skills') {
        return { stdout: '  microsoft-docs - Microsoft documentation guidance.' }
      }
      return new Error(`Unexpected built-in source: ${source}`)
    })

    const { searchSkillHub } = await import('#~/services/skill-hub/index.js')
    const result = await searchSkillHub()

    expect(result.items.map(item => item.source)).toEqual([
      'microsoft/skills',
      'vercel-labs/agent-skills'
    ])
    expect(result.registries.find(item => item.source === 'anthropics/skills')).toEqual(
      expect.objectContaining({
        builtIn: true,
        error: expect.stringContaining('Anthropic source unavailable')
      })
    )
  })

  it('prefers configured official sources over matching built-ins across config layers', async () => {
    const homeDir = process.env.__ONEWORKS_PROJECT_REAL_HOME__!
    await mkdir(path.join(homeDir, '.oneworks'), { recursive: true })
    await writeFile(
      path.join(homeDir, '.oneworks', '.oo.config.json'),
      JSON.stringify({
        skillRegistries: [{
          registry: 'https://registry.example.com',
          source: 'vercel-labs/agent-skills',
          title: 'Company Vercel Skills'
        }]
      })
    )
    await writeFile(
      path.join(workspace, '.oo.config.json'),
      JSON.stringify({
        skillRegistries: [{ source: 'anthropics/skills', title: 'Project Anthropic Skills' }]
      })
    )
    await writeFile(
      path.join(workspace, '.oo.dev.config.json'),
      JSON.stringify({
        skillRegistries: [{ source: 'microsoft/skills', title: 'Local Microsoft Skills' }]
      })
    )
    createExecImplementation((args) => {
      const source = args[args.indexOf('add') + 1]
      return { stdout: `  example-skill - Skill from ${source}.` }
    })

    const { searchSkillHub } = await import('#~/services/skill-hub/index.js')
    const result = await searchSkillHub()

    expect(result.registries).toHaveLength(3)
    expect(result.registries).toEqual([
      expect.objectContaining({
        configSource: 'global',
        registry: 'https://registry.example.com',
        source: 'vercel-labs/agent-skills',
        title: 'Company Vercel Skills'
      }),
      expect.objectContaining({
        configSource: 'project',
        source: 'anthropics/skills',
        title: 'Project Anthropic Skills'
      }),
      expect.objectContaining({
        configSource: 'user',
        source: 'microsoft/skills',
        title: 'Local Microsoft Skills'
      })
    ])
    result.registries.forEach(registry => expect(registry).not.toHaveProperty('builtIn'))
  })

  it('lists disabled built-ins but excludes them from search and install', async () => {
    await writeFile(
      path.join(workspace, '.oo.config.json'),
      JSON.stringify({
        skillRegistries: [{
          enabled: false,
          source: 'anthropics/skills'
        }]
      })
    )
    createExecImplementation((args) => {
      const source = args[args.indexOf('add') + 1]
      return { stdout: `  example-skill - Skill from ${source}.` }
    })

    const { installSkillHubItem, listSkillHubRegistries, searchSkillHub } = await import(
      '#~/services/skill-hub/index.js'
    )
    const searchResult = await searchSkillHub()
    const disabledRegistry = searchResult.registries.find(item => item.source === 'anthropics/skills')

    expect(disabledRegistry).toEqual(expect.objectContaining({
      enabled: false,
      searchable: false,
      source: 'anthropics/skills'
    }))
    expect(searchResult.items.some(item => item.source === 'anthropics/skills')).toBe(false)
    expect(mocks.execFile).toHaveBeenCalledTimes(2)

    await expect(listSkillHubRegistries()).resolves.toEqual({
      registries: expect.arrayContaining([
        expect.objectContaining({
          builtIn: true,
          enabled: false,
          source: 'anthropics/skills'
        })
      ])
    })
    await expect(installSkillHubItem({
      registry: 'project:anthropics/skills',
      skill: 'example-skill',
      workspaceFolder: workspace
    })).rejects.toThrow('was not found')
    expect(mocks.execFile).toHaveBeenCalledTimes(2)
  })

  it('inherits disabled state and metadata across registry config layers', async () => {
    const homeDir = process.env.__ONEWORKS_PROJECT_REAL_HOME__!
    await mkdir(path.join(homeDir, '.oneworks'), { recursive: true })
    await writeFile(
      path.join(homeDir, '.oneworks', '.oo.config.json'),
      JSON.stringify({
        skillRegistries: [{
          enabled: false,
          registry: 'https://registry.example.com',
          source: 'anthropics/skills'
        }]
      })
    )
    await writeFile(
      path.join(workspace, '.oo.config.json'),
      JSON.stringify({
        skillRegistries: [{
          source: 'anthropics/skills',
          title: 'Project Anthropic Skills'
        }]
      })
    )
    createExecImplementation((args) => {
      const source = args[args.indexOf('add') + 1]
      return { stdout: `  example-skill - Skill from ${source}.` }
    })

    const { installSkillHubItem, listSkillHubRegistries, searchSkillHub } = await import(
      '#~/services/skill-hub/index.js'
    )
    const searchResult = await searchSkillHub()
    expect(searchResult.items.some(item => item.source === 'anthropics/skills')).toBe(false)
    expect(searchResult.registries.find(item => item.source === 'anthropics/skills')).toEqual(
      expect.objectContaining({
        configSource: 'project',
        enabled: false,
        registry: 'https://registry.example.com',
        title: 'Project Anthropic Skills'
      })
    )
    await expect(listSkillHubRegistries()).resolves.toEqual({
      registries: expect.arrayContaining([
        expect.objectContaining({
          builtIn: true,
          configSource: 'project',
          enabled: false,
          registry: 'https://registry.example.com',
          title: 'Project Anthropic Skills'
        })
      ])
    })
    await expect(installSkillHubItem({
      registry: 'project:anthropics/skills',
      skill: 'example-skill',
      workspaceFolder: workspace
    })).rejects.toThrow('was not found')
    expect(mocks.execFile).toHaveBeenCalledTimes(2)
  })

  it('searches configured skills registries through the skills CLI', async () => {
    await writeFile(
      path.join(workspace, '.oo.config.json'),
      JSON.stringify(
        {
          skills: {
            registry: 'https://registry.example.com'
          },
          skillRegistries: [
            {
              source: 'example-source/default/public',
              title: 'Team Tools'
            }
          ]
        },
        null,
        2
      )
    )
    await mkdir(path.join(workspace, '.oo', 'skills', 'internal-review'), { recursive: true })
    await writeFile(
      path.join(workspace, '.oo', 'skills', 'internal-review', 'SKILL.md'),
      '---\nname: internal-review\ndescription: review skill\n---\nReview skill body\n'
    )

    createExecImplementation(() => ({
      stdout: [
        '  internal-review - Review code with internal checklists.',
        '  docs-writer - Write release docs with internal templates.'
      ].join('\n')
    }))

    const { searchSkillHub } = await import('#~/services/skill-hub/index.js')
    await expect(searchSkillHub({
      includeBuiltIns: false,
      query: 'review'
    })).resolves.toEqual({
      registries: [
        {
          id: 'project:example-source/default/public',
          name: 'example-source/default/public',
          type: 'skills-cli',
          enabled: true,
          searchable: true,
          source: 'example-source/default/public',
          title: 'Team Tools',
          configSource: 'project',
          configLabel: '.oo.config.json'
        }
      ],
      items: [
        expect.objectContaining({
          registry: 'project:example-source/default/public',
          registryName: 'Team Tools',
          configSource: 'project',
          configLabel: '.oo.config.json',
          name: 'internal-review',
          installed: true,
          declared: false,
          declaredSources: [],
          source: 'example-source/default/public'
        })
      ],
      sources: ['example-source/default/public'],
      total: 1
    })

    await expect(searchSkillHub({
      includeBuiltIns: false,
      limit: 1,
      offset: 0,
      sort: 'nameAsc'
    })).resolves.toMatchObject({
      hasMore: true,
      items: [expect.objectContaining({ name: 'docs-writer' })],
      sources: ['example-source/default/public'],
      total: 2
    })
    await expect(searchSkillHub({
      includeBuiltIns: false,
      installFilter: 'installed',
      limit: 20,
      offset: 0,
      source: 'example-source/default/public'
    })).resolves.toMatchObject({
      items: [expect.objectContaining({ installed: true, name: 'internal-review' })],
      total: 1
    })

    expect(mocks.execFile).toHaveBeenCalledWith(
      'npm',
      [
        'exec',
        '--yes',
        '--package',
        'skills@latest',
        '--',
        'skills',
        'add',
        'example-source/default/public',
        '--list',
        '-y'
      ],
      expect.objectContaining({
        cwd: expect.stringContaining('ow-skills-cli-list-'),
        env: expect.objectContaining({
          npm_config_registry: 'https://registry.example.com'
        })
      }),
      expect.any(Function)
    )
  })

  it('searches skillsMeta sources without treating registries as install defaults', async () => {
    await writeFile(
      path.join(workspace, '.oo.config.json'),
      JSON.stringify(
        {
          skillsMeta: {
            registries: ['https://registry.example.com'],
            sources: ['example-source/default/public']
          }
        },
        null,
        2
      )
    )

    createExecImplementation(() => ({
      stdout: '  internal-review - Review code with internal checklists.'
    }))

    const { searchSkillHub } = await import('#~/services/skill-hub/index.js')
    await expect(searchSkillHub({
      includeBuiltIns: false,
      query: 'review'
    })).resolves.toEqual({
      registries: [
        {
          id: 'project:example-source/default/public',
          name: 'example-source/default/public',
          type: 'skills-cli',
          enabled: true,
          searchable: true,
          source: 'example-source/default/public',
          configSource: 'project',
          configLabel: '.oo.config.json'
        }
      ],
      items: [
        expect.objectContaining({
          registry: 'project:example-source/default/public',
          name: 'internal-review',
          source: 'example-source/default/public'
        })
      ],
      sources: ['example-source/default/public'],
      total: 1
    })

    expect(mocks.execFile).toHaveBeenCalledWith(
      'npm',
      expect.any(Array),
      expect.objectContaining({
        env: expect.not.objectContaining({
          npm_config_registry: 'https://registry.example.com'
        })
      }),
      expect.any(Function)
    )
  })

  it('keeps global skills registries attributed to global config', async () => {
    const homeDir = process.env.__ONEWORKS_PROJECT_REAL_HOME__!
    await mkdir(path.join(homeDir, '.oneworks'), { recursive: true })
    await writeFile(
      path.join(homeDir, '.oneworks', '.oo.config.json'),
      JSON.stringify(
        {
          skills: [{
            name: 'internal-review',
            source: 'example-source/default/public'
          }],
          skillRegistries: [
            {
              source: 'example-source/default/public',
              title: 'Global Tools',
              registry: 'https://registry.example.com'
            }
          ]
        },
        null,
        2
      )
    )

    createExecImplementation(() => ({
      stdout: '  internal-review - Review code with internal checklists.'
    }))

    const { searchSkillHub } = await import('#~/services/skill-hub/index.js')
    await expect(searchSkillHub({
      includeBuiltIns: false,
      query: 'review'
    })).resolves.toEqual({
      registries: [
        {
          id: 'global:example-source/default/public',
          name: 'example-source/default/public',
          type: 'skills-cli',
          enabled: true,
          searchable: true,
          source: 'example-source/default/public',
          title: 'Global Tools',
          registry: 'https://registry.example.com',
          configSource: 'global',
          configLabel: '~/.oneworks/.oo.config.json'
        }
      ],
      items: [
        expect.objectContaining({
          registry: 'global:example-source/default/public',
          registryName: 'Global Tools',
          configSource: 'global',
          configLabel: '~/.oneworks/.oo.config.json',
          name: 'internal-review',
          declared: true,
          declaredSources: ['global'],
          source: 'example-source/default/public'
        })
      ],
      sources: ['example-source/default/public'],
      total: 1
    })

    expect(mocks.execFile).toHaveBeenCalledWith(
      'npm',
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          npm_config_registry: 'https://registry.example.com'
        })
      }),
      expect.any(Function)
    )
  })

  it('does not apply global skill registries when global config is disabled', async () => {
    const homeDir = process.env.__ONEWORKS_PROJECT_REAL_HOME__!
    await mkdir(path.join(homeDir, '.oneworks'), { recursive: true })
    await writeFile(
      path.join(homeDir, '.oneworks', '.oo.config.json'),
      JSON.stringify(
        {
          disableGlobalConfig: true,
          skillRegistries: [
            {
              source: 'example-source/default/public',
              title: 'Global Tools'
            }
          ]
        },
        null,
        2
      )
    )

    const { searchSkillHub } = await import('#~/services/skill-hub/index.js')
    await expect(searchSkillHub({
      includeBuiltIns: false,
      query: 'review'
    })).resolves.toEqual({
      registries: [],
      items: [],
      sources: [],
      total: 0
    })
    expect(mocks.execFile).not.toHaveBeenCalled()
  })

  it('installs a built-in registry skill without requiring registry configuration', async () => {
    createExecImplementation(async (args, options) => {
      if (!args.includes('--skill')) {
        return new Error(`Unexpected skills CLI args: ${args.join(' ')}`)
      }

      const skillDir = path.join(String(options.cwd), '.agents', 'skills', 'vercel-react-best-practices')
      await mkdir(skillDir, { recursive: true })
      await writeFile(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: vercel-react-best-practices\ndescription: Vercel React guidance\n---\nVercel skill body\n'
      )
      return { stdout: 'installed\n' }
    })

    const { installSkillHubItem } = await import('#~/services/skill-hub/index.js')
    const result = await installSkillHubItem({
      registry: 'project:vercel-labs/agent-skills',
      skill: 'vercel-react-best-practices',
      workspaceFolder: workspace
    })

    expect(result).toEqual(expect.objectContaining({
      configSource: 'project',
      registry: 'project:vercel-labs/agent-skills',
      registryName: 'Vercel Agent Skills',
      skill: 'vercel-react-best-practices',
      source: 'vercel-labs/agent-skills'
    }))
    await expect(readFile(path.join(workspace, '.oo.config.json'), 'utf8')).resolves.toContain(
      '"source": "vercel-labs/agent-skills"'
    )
    await expect(
      readFile(path.join(workspace, '.oo', 'skills', 'vercel-react-best-practices', 'SKILL.md'), 'utf8')
    ).resolves.toContain('Vercel skill body')
  })

  it('installs a built-in registry skill into global config when requested', async () => {
    createExecImplementation(async (args, options) => {
      if (!args.includes('--skill')) {
        return new Error(`Unexpected skills CLI args: ${args.join(' ')}`)
      }

      const skillDir = path.join(String(options.cwd), '.agents', 'skills', 'algorithmic-art')
      await mkdir(skillDir, { recursive: true })
      await writeFile(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: algorithmic-art\ndescription: Algorithmic art\n---\nArt skill body\n'
      )
      return { stdout: 'installed\n' }
    })

    const { installSkillHubItem } = await import('#~/services/skill-hub/index.js')
    const result = await installSkillHubItem({
      registry: 'project:anthropics/skills',
      skill: 'algorithmic-art',
      target: 'global',
      workspaceFolder: workspace
    })

    const homeDir = process.env.__ONEWORKS_PROJECT_REAL_HOME__!
    expect(result).toEqual(expect.objectContaining({
      configSource: 'global',
      configLabel: '~/.oneworks/.oo.config.json',
      configPath: path.join(homeDir, '.oneworks', '.oo.config.json'),
      registry: 'project:anthropics/skills',
      skill: 'algorithmic-art',
      source: 'anthropics/skills'
    }))
    await expect(
      readFile(path.join(homeDir, '.oneworks', '.oo.config.json'), 'utf8')
    ).resolves.toContain('"source": "anthropics/skills"')
    await expect(
      readFile(path.join(workspace, '.oo.config.json'), 'utf8')
    ).rejects.toThrow()
    await expect(
      readFile(path.join(workspace, '.oo', 'skills', 'algorithmic-art', 'SKILL.md'), 'utf8')
    ).resolves.toContain('Art skill body')
  })

  it('rejects cross-layer skill target conflicts before changing config or disk', async () => {
    const homeDir = process.env.__ONEWORKS_PROJECT_REAL_HOME__!
    await mkdir(path.join(homeDir, '.oneworks'), { recursive: true })
    const globalConfigPath = path.join(homeDir, '.oneworks', '.oo.config.json')
    const originalConfig = JSON.stringify(
      {
        disableGlobalConfig: true,
        skills: [{ name: 'algorithmic-art', source: 'other/skills' }]
      },
      null,
      2
    )
    await writeFile(globalConfigPath, originalConfig)

    const { installSkillHubItem } = await import('#~/services/skill-hub/index.js')
    await expect(installSkillHubItem({
      registry: 'project:anthropics/skills',
      skill: 'algorithmic-art',
      target: 'project',
      workspaceFolder: workspace
    })).rejects.toThrow('already exists in ~/.oneworks/.oo.config.json')
    await expect(readFile(globalConfigPath, 'utf8')).resolves.toBe(originalConfig)
    expect(mocks.execFile).not.toHaveBeenCalled()
  })

  it('allows the same declaration to be added to another config layer', async () => {
    const homeDir = process.env.__ONEWORKS_PROJECT_REAL_HOME__!
    await mkdir(path.join(homeDir, '.oneworks'), { recursive: true })
    await writeFile(
      path.join(homeDir, '.oneworks', '.oo.config.json'),
      JSON.stringify(
        {
          skills: [{ name: 'algorithmic-art', source: 'anthropics/skills' }]
        },
        null,
        2
      )
    )
    createExecImplementation(async (args, options) => {
      if (!args.includes('--skill')) return new Error(`Unexpected skills CLI args: ${args.join(' ')}`)
      const skillDir = path.join(String(options.cwd), '.agents', 'skills', 'algorithmic-art')
      await mkdir(skillDir, { recursive: true })
      await writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: algorithmic-art\n---\nArt skill body\n')
      return { stdout: 'installed\n' }
    })

    const { installSkillHubItem } = await import('#~/services/skill-hub/index.js')
    await expect(installSkillHubItem({
      registry: 'project:anthropics/skills',
      skill: 'algorithmic-art',
      target: 'project',
      workspaceFolder: workspace
    })).resolves.toEqual(expect.objectContaining({ configSource: 'project' }))
    await expect(readFile(path.join(workspace, '.oo.config.json'), 'utf8')).resolves.toContain(
      '"source": "anthropics/skills"'
    )
  })

  it('reports declarations from disabled global config in search results', async () => {
    const homeDir = process.env.__ONEWORKS_PROJECT_REAL_HOME__!
    await mkdir(path.join(homeDir, '.oneworks'), { recursive: true })
    await writeFile(
      path.join(homeDir, '.oneworks', '.oo.config.json'),
      JSON.stringify(
        {
          disableGlobalConfig: true,
          skills: [{ name: 'algorithmic-art', source: 'anthropics/skills' }]
        },
        null,
        2
      )
    )
    createExecImplementation(() => ({ stdout: '  algorithmic-art - Algorithmic art.' }))

    const { searchSkillHub } = await import('#~/services/skill-hub/index.js')
    await expect(searchSkillHub({
      query: 'algorithmic-art',
      registry: 'project:anthropics/skills'
    })).resolves.toMatchObject({
      items: [{
        declared: true,
        declaredSources: ['global'],
        name: 'algorithmic-art'
      }]
    })
  })

  it('does not persist a built-in declaration when installation fails', async () => {
    createExecImplementation(() => new Error('Vercel source download failed'))

    const { installSkillHubItem } = await import('#~/services/skill-hub/index.js')
    await expect(installSkillHubItem({
      registry: 'project:vercel-labs/agent-skills',
      skill: 'vercel-react-best-practices',
      workspaceFolder: workspace
    })).rejects.toThrow('Vercel source download failed')
    await expect(readFile(path.join(workspace, '.oo.config.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('restores the previous skill when the config commit fails during force reinstall', async () => {
    const skillDir = path.join(workspace, '.oo', 'skills', 'vercel-react-best-practices')
    await mkdir(skillDir, { recursive: true })
    await writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: vercel-react-best-practices\n---\nOld body\n')
    createExecImplementation(async (args, options) => {
      if (!args.includes('--skill')) return new Error(`Unexpected skills CLI args: ${args.join(' ')}`)
      const stagedSkillDir = path.join(String(options.cwd), '.agents', 'skills', 'vercel-react-best-practices')
      await mkdir(stagedSkillDir, { recursive: true })
      await writeFile(
        path.join(stagedSkillDir, 'SKILL.md'),
        '---\nname: vercel-react-best-practices\n---\nNew body\n'
      )
      return { stdout: 'reinstalled\n' }
    })
    mocks.updateConfigFile.mockRejectedValueOnce(new Error('config commit failed'))

    const { installSkillHubItem } = await import('#~/services/skill-hub/index.js')
    await expect(installSkillHubItem({
      force: true,
      registry: 'project:vercel-labs/agent-skills',
      skill: 'vercel-react-best-practices',
      workspaceFolder: workspace
    })).rejects.toThrow('config commit failed')

    await expect(readFile(path.join(skillDir, 'SKILL.md'), 'utf8')).resolves.toContain('Old body')
    await expect(readFile(path.join(workspace, '.oo.config.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves both declarations when different skills finish installation concurrently', async () => {
    createExecImplementation(async (args, options) => {
      if (!args.includes('--skill')) return new Error(`Unexpected skills CLI args: ${args.join(' ')}`)
      const skill = args[args.indexOf('--skill') + 1]!
      const stagedSkillDir = path.join(String(options.cwd), '.agents', 'skills', skill)
      await mkdir(stagedSkillDir, { recursive: true })
      await writeFile(
        path.join(stagedSkillDir, 'SKILL.md'),
        `---\nname: ${skill}\n---\nConcurrent body\n`
      )
      return { stdout: 'installed\n' }
    })

    const actualConfig = await vi.importActual<typeof import('@oneworks/config')>('@oneworks/config')
    let configWrites = 0
    let releaseConfigWrites: () => void = () => undefined
    const configWriteGate = new Promise<void>((resolve) => {
      releaseConfigWrites = resolve
    })
    mocks.updateConfigFile.mockImplementation(async (
      options: Parameters<typeof actualConfig.updateConfigFile>[0]
    ) => {
      configWrites += 1
      if (configWrites === 2) releaseConfigWrites()
      await configWriteGate
      return actualConfig.updateConfigFile(options)
    })

    try {
      const { installSkillHubItem } = await import('#~/services/skill-hub/index.js')
      await Promise.all([
        installSkillHubItem({
          registry: 'project:vercel-labs/agent-skills',
          skill: 'vercel-react-best-practices',
          workspaceFolder: workspace
        }),
        installSkillHubItem({
          registry: 'project:anthropics/skills',
          skill: 'frontend-design',
          workspaceFolder: workspace
        })
      ])

      const config = JSON.parse(await readFile(path.join(workspace, '.oo.config.json'), 'utf8'))
      expect(config.skills.map((skill: { name: string }) => skill.name).sort()).toEqual([
        'frontend-design',
        'vercel-react-best-practices'
      ])
      await expect(
        readFile(path.join(workspace, '.oo', 'skills', 'frontend-design', 'SKILL.md'), 'utf8')
      ).resolves.toContain('Concurrent body')
      await expect(
        readFile(path.join(workspace, '.oo', 'skills', 'vercel-react-best-practices', 'SKILL.md'), 'utf8')
      ).resolves.toContain('Concurrent body')
    } finally {
      mocks.updateConfigFile.mockImplementation(actualConfig.updateConfigFile)
    }
  })

  it('allows a declared built-in skill to be explicitly reinstalled', async () => {
    await writeFile(
      path.join(workspace, '.oo.config.json'),
      JSON.stringify(
        {
          skills: [{
            name: 'vercel-react-best-practices',
            source: 'vercel-labs/agent-skills'
          }]
        },
        null,
        2
      )
    )
    createExecImplementation(async (args, options) => {
      if (!args.includes('--skill')) return new Error(`Unexpected skills CLI args: ${args.join(' ')}`)
      const skillDir = path.join(String(options.cwd), '.agents', 'skills', 'vercel-react-best-practices')
      await mkdir(skillDir, { recursive: true })
      await writeFile(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: vercel-react-best-practices\ndescription: Vercel React guidance\n---\nUpdated body\n'
      )
      return { stdout: 'reinstalled\n' }
    })

    const { installSkillHubItem } = await import('#~/services/skill-hub/index.js')
    await expect(installSkillHubItem({
      force: true,
      registry: 'project:vercel-labs/agent-skills',
      skill: 'vercel-react-best-practices',
      workspaceFolder: workspace
    })).resolves.toEqual(expect.objectContaining({ name: 'vercel-react-best-practices' }))
    const config = JSON.parse(await readFile(path.join(workspace, '.oo.config.json'), 'utf8'))
    expect(config.skills).toHaveLength(1)
    await expect(
      readFile(path.join(workspace, '.oo', 'skills', 'vercel-react-best-practices', 'SKILL.md'), 'utf8')
    ).resolves.toContain('Updated body')
  })

  it('declares the installed skill into the matching config file and installs it locally', async () => {
    await writeFile(
      path.join(workspace, '.oo.dev.config.json'),
      JSON.stringify(
        {
          skillRegistries: [
            {
              source: 'example-source/default/public',
              registry: 'https://registry.example.com'
            }
          ]
        },
        null,
        2
      )
    )

    createExecImplementation(async (args, options) => {
      if (!args.includes('--skill')) {
        return new Error(`Unexpected skills CLI args: ${args.join(' ')}`)
      }

      const skillDir = path.join(String(options.cwd), '.agents', 'skills', 'internal-review')
      await mkdir(skillDir, { recursive: true })
      await writeFile(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: internal-review\ndescription: review skill\n---\nReview skill body\n'
      )
      await writeFile(path.join(skillDir, 'notes.md'), 'supporting file\n')

      return {
        stdout: 'installed\n'
      }
    })

    const { installSkillHubItem } = await import('#~/services/skill-hub/index.js')
    const result = await installSkillHubItem({
      registry: 'user:example-source/default/public',
      skill: 'internal-review',
      workspaceFolder: workspace
    })

    expect(result).toEqual(expect.objectContaining({
      registry: 'user:example-source/default/public',
      registryName: 'example-source/default/public',
      configSource: 'user',
      configLabel: '.oo.dev.config.json',
      skill: 'internal-review',
      source: 'example-source/default/public',
      name: 'internal-review'
    }))
    await expect(
      readFile(path.join(workspace, '.oo.dev.config.json'), 'utf8')
    ).resolves.toContain('"skills"')
    await expect(
      readFile(path.join(workspace, '.oo.dev.config.json'), 'utf8')
    ).resolves.toContain('"source": "example-source/default/public"')
    await expect(
      readFile(path.join(workspace, '.oo', 'skills', 'internal-review', 'SKILL.md'), 'utf8')
    ).resolves.toContain('Review skill body')
    await expect(
      readFile(path.join(workspace, '.oo', 'skills', 'internal-review', 'notes.md'), 'utf8')
    ).resolves.toContain('supporting file')
  })

  it('does not materialize extended skills when declaring a skill from the hub', async () => {
    await writeFile(
      path.join(workspace, 'base-skills.json'),
      JSON.stringify(
        {
          skills: ['base-review']
        },
        null,
        2
      )
    )
    await writeFile(
      path.join(workspace, '.oo.config.json'),
      JSON.stringify(
        {
          extend: './base-skills.json',
          skillRegistries: [
            {
              source: 'example-source/default/public',
              registry: 'https://registry.example.com'
            }
          ]
        },
        null,
        2
      )
    )

    createExecImplementation(async (args, options) => {
      if (!args.includes('--skill')) {
        return new Error(`Unexpected skills CLI args: ${args.join(' ')}`)
      }

      const skillDir = path.join(String(options.cwd), '.agents', 'skills', 'docs-writer')
      await mkdir(skillDir, { recursive: true })
      await writeFile(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: docs-writer\ndescription: docs skill\n---\nDocs skill body\n'
      )

      return {
        stdout: 'installed\n'
      }
    })

    const { installSkillHubItem } = await import('#~/services/skill-hub/index.js')
    await installSkillHubItem({
      registry: 'project:example-source/default/public',
      skill: 'docs-writer',
      workspaceFolder: workspace
    })

    const config = JSON.parse(await readFile(path.join(workspace, '.oo.config.json'), 'utf8'))
    expect(config.extend).toBe('./base-skills.json')
    expect(config.skills).toEqual([
      {
        name: 'docs-writer',
        registry: 'https://registry.example.com',
        source: 'example-source/default/public'
      }
    ])
    expect(JSON.stringify(config)).not.toContain('base-review')
  })

  it('declares skills from global registries back into global config', async () => {
    const homeDir = process.env.__ONEWORKS_PROJECT_REAL_HOME__!
    await mkdir(path.join(homeDir, '.oneworks'), { recursive: true })
    await writeFile(
      path.join(homeDir, '.oneworks', '.oo.config.json'),
      JSON.stringify(
        {
          skillRegistries: [
            {
              source: 'example-source/default/public',
              registry: 'https://registry.example.com'
            }
          ]
        },
        null,
        2
      )
    )

    createExecImplementation(async (args, options) => {
      if (!args.includes('--skill')) {
        return new Error(`Unexpected skills CLI args: ${args.join(' ')}`)
      }

      const skillDir = path.join(String(options.cwd), '.agents', 'skills', 'internal-review')
      await mkdir(skillDir, { recursive: true })
      await writeFile(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: internal-review\ndescription: review skill\n---\nReview skill body\n'
      )

      return {
        stdout: 'installed\n'
      }
    })

    const { installSkillHubItem } = await import('#~/services/skill-hub/index.js')
    const result = await installSkillHubItem({
      registry: 'global:example-source/default/public',
      skill: 'internal-review',
      workspaceFolder: workspace
    })

    expect(result).toEqual(expect.objectContaining({
      registry: 'global:example-source/default/public',
      configSource: 'global',
      configLabel: '~/.oneworks/.oo.config.json',
      configPath: path.join(homeDir, '.oneworks', '.oo.config.json'),
      source: 'example-source/default/public',
      name: 'internal-review'
    }))
    await expect(
      readFile(path.join(homeDir, '.oneworks', '.oo.config.json'), 'utf8')
    ).resolves.toContain('"source": "example-source/default/public"')
    await expect(
      readFile(path.join(workspace, '.oo.config.json'), 'utf8')
    ).rejects.toThrow()
  })
})
