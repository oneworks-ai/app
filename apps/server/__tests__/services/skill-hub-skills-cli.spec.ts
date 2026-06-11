/* eslint-disable max-lines -- skill hub flow coverage keeps registry/search/install regressions together. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetConfigCache } from '@oneworks/config'
import { clearSkillsCliCachesForTest } from '@oneworks/utils/skills-cli'

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  resolveManagedNpmCliInstallOptions: vi.fn()
}))

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
          source: 'example-source/default/public'
        })
      ]
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
      ]
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
          skills: {
            registry: 'https://registry.example.com'
          },
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

    createExecImplementation(() => ({
      stdout: '  internal-review - Review code with internal checklists.'
    }))

    const { searchSkillHub } = await import('#~/services/skill-hub/index.js')
    await expect(searchSkillHub({
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
          source: 'example-source/default/public'
        })
      ]
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
      query: 'review'
    })).resolves.toEqual({
      registries: [],
      items: []
    })
    expect(mocks.execFile).not.toHaveBeenCalled()
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
