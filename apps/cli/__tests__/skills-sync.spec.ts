/* eslint-disable import/first, max-lines -- skill sync coverage keeps install, dependency, and scoped path regressions together. */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  installProjectSkill: vi.fn(),
  installProjectSkillCollection: vi.fn()
}))

vi.mock('@oneworks/utils', async () => {
  const actual = await vi.importActual<typeof import('@oneworks/utils')>('@oneworks/utils')
  return {
    ...actual,
    installProjectSkill: mocks.installProjectSkill,
    installProjectSkillCollection: mocks.installProjectSkillCollection
  }
})

import { resetConfigCache } from '@oneworks/config'
import { computeSkillDirectoryHash, readProjectSkillsLockfile, writeProjectSkillsLockfile } from '@oneworks/utils'

import { resolveInstallTargets } from '#~/commands/skills/install.js'
import { syncProjectSkills } from '#~/commands/skills/sync.js'

const tempDirs: string[] = []

const writeDocument = async (filePath: string, content: string) => {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
}

const pathExists = async (filePath: string) => {
  try {
    await readFile(filePath, 'utf8')
    return true
  } catch {
    return false
  }
}

const createWorkspace = async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ow-skills-sync-'))
  tempDirs.push(cwd)
  return cwd
}

const installPluginPackage = async (
  workspace: string,
  packageName: string,
  files: Record<string, string>
) => {
  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      await writeDocument(path.join(workspace, 'node_modules', ...packageName.split('/'), relativePath), content)
    })
  )
}

const mockSkillInstall = (workspace: string, contents: Record<string, string>) => {
  mocks.installProjectSkill.mockImplementation(async (params: {
    installPathSegments?: string[]
    skill: {
      ref: string
      targetDirName: string
      targetName: string
    }
  }) => {
    const installDir = path.join(
      workspace,
      '.oo/skills',
      ...(params.installPathSegments ?? []),
      params.skill.targetDirName
    )
    await writeDocument(
      path.join(installDir, 'SKILL.md'),
      contents[params.skill.targetName] ?? [
        '---',
        `name: ${params.skill.targetName}`,
        `description: ${params.skill.targetName}`,
        '---',
        `${params.skill.targetName}.`
      ].join('\n')
    )
    return {
      dirName: params.skill.targetDirName,
      hash: await computeSkillDirectoryHash(installDir),
      installDir,
      name: params.skill.targetName,
      ref: params.skill.ref,
      skillPath: path.join(installDir, 'SKILL.md')
    }
  })
}

const mockCollectionInstall = (workspace: string, skillNames: string[]) => {
  mocks.installProjectSkillCollection.mockImplementation(async (params: {
    installPathSegments?: string[]
    source: string
  }) => {
    const actual = await vi.importActual<typeof import('@oneworks/utils')>('@oneworks/utils')

    return await Promise.all(skillNames.map(async (skillName) => {
      const normalized = actual.normalizeProjectSkillInstall({
        name: skillName,
        source: params.source
      })!
      const installDir = path.join(
        workspace,
        '.oo/skills',
        ...(params.installPathSegments ?? []),
        normalized.targetDirName
      )
      await writeDocument(
        path.join(installDir, 'SKILL.md'),
        [
          '---',
          `name: ${normalized.targetName}`,
          `description: ${normalized.targetName}`,
          '---',
          `${normalized.targetName}.`
        ].join('\n')
      )

      return {
        dirName: normalized.targetDirName,
        hash: await computeSkillDirectoryHash(installDir),
        installDir,
        name: normalized.targetName,
        normalized,
        ref: normalized.ref,
        skillPath: path.join(installDir, 'SKILL.md')
      }
    }))
  })
}

describe('skills sync', () => {
  afterEach(async () => {
    vi.clearAllMocks()
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  it('installs declared skills and their metadata dependencies into the project lockfile', async () => {
    const workspace = await createWorkspace()
    mockSkillInstall(workspace, {
      'app-builder': [
        '---',
        'name: app-builder',
        'description: Build apps',
        'dependencies:',
        '  - name: frontend-design',
        '    source: example/skills',
        '    version: "^1.0.0"',
        '---',
        'Build apps.'
      ].join('\n')
    })

    await syncProjectSkills({
      state: {
        projectConfig: {},
        userConfig: undefined
      } as never,
      targets: ['app-builder'],
      workspaceFolder: workspace
    })

    expect(mocks.installProjectSkill).toHaveBeenCalledTimes(2)
    const lockfile = await readProjectSkillsLockfile(workspace)
    expect(lockfile.skills).toEqual({
      'app-builder': expect.objectContaining({
        dependencies: ['frontend-design'],
        installPath: '.oo/skills/app-builder',
        name: 'app-builder',
        requested: true
      }),
      'frontend-design': expect.objectContaining({
        constraints: [{ from: 'app-builder', version: '^1.0.0' }],
        dependencyOf: ['app-builder'],
        installPath: '.oo/skills/frontend-design',
        name: 'frontend-design',
        requested: false,
        source: 'example/skills',
        version: '^1.0.0'
      })
    })
  })

  it('allows an empty project skills list so plugin dependencies can still sync', async () => {
    const workspace = await createWorkspace()

    await expect(resolveInstallTargets({
      args: [],
      options: {},
      workspaceFolder: workspace
    })).resolves.toEqual([])
  })

  it('skips configured global skills when global config is disabled', async () => {
    const workspace = await createWorkspace()
    const previousRealHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__
    const previousWorkspace = process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__

    try {
      process.env.__ONEWORKS_PROJECT_REAL_HOME__ = path.join(workspace, '.home')
      process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspace
      await writeDocument(
        path.join(workspace, '.home', '.oo', 'config.json'),
        JSON.stringify({
          disableGlobalConfig: true,
          skills: ['global-review']
        })
      )
      await writeDocument(
        path.join(workspace, '.oo.config.yaml'),
        [
          'skills:',
          '  - project-review'
        ].join('\n')
      )

      resetConfigCache()
      await expect(resolveInstallTargets({
        args: [],
        options: {},
        workspaceFolder: workspace
      })).resolves.toEqual([
        {
          declaration: 'project-review',
          installPathSegments: []
        }
      ])
    } finally {
      if (previousRealHome == null) {
        delete process.env.__ONEWORKS_PROJECT_REAL_HOME__
      } else {
        process.env.__ONEWORKS_PROJECT_REAL_HOME__ = previousRealHome
      }
      if (previousWorkspace == null) {
        delete process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
      } else {
        process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = previousWorkspace
      }
      resetConfigCache()
    }
  })

  it('resolves configured extend skills into an .extends install scope', async () => {
    const workspace = await createWorkspace()
    await writeDocument(
      path.join(workspace, 'base-skills.yaml'),
      [
        'skills:',
        '  - base-review',
        '  - source: larksuite/cli',
        '    include:',
        '      - "*"'
      ].join('\n')
    )
    await writeDocument(
      path.join(workspace, '.oo.config.yaml'),
      [
        'extend: ./base-skills.yaml',
        'skills:',
        '  - project-review'
      ].join('\n')
    )

    await expect(resolveInstallTargets({
      args: [],
      options: {},
      workspaceFolder: workspace
    })).resolves.toEqual([
      {
        declaration: 'base-review',
        installPathSegments: ['.extends', 'base-skills']
      },
      {
        declaration: {
          source: 'larksuite/cli',
          include: ['*']
        },
        installPathSegments: ['.extends', 'base-skills']
      },
      {
        declaration: 'project-review',
        installPathSegments: []
      }
    ])
  })

  it('installs source collections once and records each included skill in the lockfile', async () => {
    const workspace = await createWorkspace()
    mockCollectionInstall(workspace, ['lark-doc', 'lark-sheets'])
    mockSkillInstall(workspace, {})

    await syncProjectSkills({
      state: {
        projectConfig: {},
        userConfig: undefined
      } as never,
      targets: [
        {
          source: 'larksuite/cli',
          include: ['*']
        }
      ],
      workspaceFolder: workspace
    })

    expect(mocks.installProjectSkillCollection).toHaveBeenCalledTimes(1)
    expect(mocks.installProjectSkill).not.toHaveBeenCalled()
    expect((await readProjectSkillsLockfile(workspace)).skills).toEqual({
      'lark-doc': expect.objectContaining({
        installPath: '.oo/skills/larksuite-cli/lark-doc',
        name: 'lark-doc',
        requested: true,
        source: 'larksuite/cli'
      }),
      'lark-sheets': expect.objectContaining({
        installPath: '.oo/skills/larksuite-cli/lark-sheets',
        name: 'lark-sheets',
        requested: true,
        source: 'larksuite/cli'
      })
    })
  })

  it('reports progress around source collection installs', async () => {
    const workspace = await createWorkspace()
    const progressEvents: string[] = []
    mockCollectionInstall(workspace, ['lark-doc'])

    await syncProjectSkills({
      progress: {
        completeStep: label => progressEvents.push(`complete:${label}`),
        fail: label => progressEvents.push(`fail:${label ?? ''}`),
        failStep: label => progressEvents.push(`fail-step:${label}`),
        finish: label => progressEvents.push(`finish:${label ?? ''}`),
        startStep: label => progressEvents.push(`start:${label}`)
      },
      state: {
        projectConfig: {},
        userConfig: undefined
      } as never,
      targets: [
        {
          source: 'larksuite/cli',
          include: ['*']
        }
      ],
      workspaceFolder: workspace
    })

    expect(progressEvents).toEqual([
      'start:source larksuite/cli',
      'complete:source larksuite/cli'
    ])
  })

  it('installs extended source collections under the extend and collection segments', async () => {
    const workspace = await createWorkspace()
    mockCollectionInstall(workspace, ['lark-doc'])

    await syncProjectSkills({
      state: {
        projectConfig: {},
        userConfig: undefined
      } as never,
      targets: [
        {
          declaration: {
            source: 'larksuite/cli',
            include: ['*']
          },
          installPathSegments: ['.extends', 'base-skills']
        }
      ],
      workspaceFolder: workspace
    })

    expect(mocks.installProjectSkillCollection).toHaveBeenCalledWith(expect.objectContaining({
      installPathSegments: ['.extends', 'base-skills', 'larksuite-cli']
    }))
    expect((await readProjectSkillsLockfile(workspace)).skills?.['lark-doc']).toEqual(expect.objectContaining({
      installPath: '.oo/skills/.extends/base-skills/larksuite-cli/lark-doc'
    }))
  })

  it('removes an unchanged previous managed install when a skill moves to a scoped path', async () => {
    const workspace = await createWorkspace()
    const oldInstallDir = path.join(workspace, '.oo/skills/lark-doc')
    await writeDocument(
      path.join(oldInstallDir, 'SKILL.md'),
      [
        '---',
        'name: lark-doc',
        'description: old',
        '---',
        'Old docs.'
      ].join('\n')
    )
    await writeProjectSkillsLockfile(workspace, {
      version: 1,
      skills: {
        'lark-doc': {
          hash: await computeSkillDirectoryHash(oldInstallDir),
          installedAt: '2026-01-01T00:00:00.000Z',
          installPath: '.oo/skills/lark-doc',
          name: 'lark-doc',
          requested: true,
          source: 'larksuite/cli'
        }
      }
    })
    mockCollectionInstall(workspace, ['lark-doc'])

    await syncProjectSkills({
      state: {
        projectConfig: {},
        userConfig: undefined
      } as never,
      targets: [
        {
          declaration: {
            source: 'larksuite/cli',
            include: ['*']
          },
          installPathSegments: ['.extends', 'base-skills']
        }
      ],
      workspaceFolder: workspace
    })

    expect(await pathExists(path.join(oldInstallDir, 'SKILL.md'))).toBe(false)
    expect(
      await pathExists(
        path.join(workspace, '.oo/skills/.extends/base-skills/larksuite-cli/lark-doc/SKILL.md')
      )
    ).toBe(true)
  })

  it('prunes empty scoped containers after a managed skill moves', async () => {
    const workspace = await createWorkspace()
    const oldInstallDir = path.join(workspace, '.oo/skills/.extends/ai-config/larksuite-cli/lark-doc')
    await writeDocument(
      path.join(oldInstallDir, 'SKILL.md'),
      [
        '---',
        'name: lark-doc',
        'description: old',
        '---',
        'Old docs.'
      ].join('\n')
    )
    await writeProjectSkillsLockfile(workspace, {
      version: 1,
      skills: {
        'lark-doc': {
          hash: await computeSkillDirectoryHash(oldInstallDir),
          installedAt: '2026-01-01T00:00:00.000Z',
          installPath: '.oo/skills/.extends/ai-config/larksuite-cli/lark-doc',
          name: 'lark-doc',
          requested: true,
          source: 'larksuite/cli'
        }
      }
    })
    mockCollectionInstall(workspace, ['lark-doc'])

    await syncProjectSkills({
      state: {
        projectConfig: {},
        userConfig: undefined
      } as never,
      targets: [
        {
          declaration: {
            source: 'larksuite/cli',
            include: ['*']
          },
          installPathSegments: ['.extends', 'douyin-open-ai-infra-harness-cli']
        }
      ],
      workspaceFolder: workspace
    })

    await expect(readdir(path.join(workspace, '.oo/skills/.extends/ai-config'))).rejects.toThrow()
    expect(
      await pathExists(
        path.join(workspace, '.oo/skills/.extends/douyin-open-ai-infra-harness-cli/larksuite-cli/lark-doc/SKILL.md')
      )
    ).toBe(true)
  })

  it('fails when multiple dependencies require incompatible versions of the same skill', async () => {
    const workspace = await createWorkspace()
    mockSkillInstall(workspace, {
      'app-one': [
        '---',
        'name: app-one',
        'description: First app',
        'dependencies:',
        '  - name: shared-helper',
        '    source: example/skills',
        '    version: "1.0.0"',
        '---',
        'App one.'
      ].join('\n'),
      'app-two': [
        '---',
        'name: app-two',
        'description: Second app',
        'dependencies:',
        '  - name: shared-helper',
        '    source: example/skills',
        '    version: "2.0.0"',
        '---',
        'App two.'
      ].join('\n')
    })

    await expect(syncProjectSkills({
      state: {
        projectConfig: {},
        userConfig: undefined
      } as never,
      targets: ['app-one', 'app-two'],
      workspaceFolder: workspace
    })).rejects.toThrow('Conflicting dependency versions for shared-helper')
  })

  it('deduplicates compatible exact and range dependency versions in the same scope', async () => {
    const workspace = await createWorkspace()
    mockSkillInstall(workspace, {
      'app-one': [
        '---',
        'name: app-one',
        'description: First app',
        'dependencies:',
        '  - name: shared-helper',
        '    source: example/skills',
        '    version: "1.2.3"',
        '---',
        'App one.'
      ].join('\n'),
      'app-two': [
        '---',
        'name: app-two',
        'description: Second app',
        'dependencies:',
        '  - name: shared-helper',
        '    source: example/skills',
        '    version: "^1.0.0"',
        '---',
        'App two.'
      ].join('\n')
    })

    await syncProjectSkills({
      state: {
        projectConfig: {},
        userConfig: undefined
      } as never,
      targets: ['app-one', 'app-two'],
      workspaceFolder: workspace
    })

    const installedTargets = mocks.installProjectSkill.mock.calls
      .map(([params]) => params.skill.targetName)
    expect(installedTargets).toEqual(['app-one', 'shared-helper', 'app-two'])
    expect((await readProjectSkillsLockfile(workspace)).skills?.['shared-helper']).toEqual(
      expect.objectContaining({
        constraints: [
          { from: 'app-one', version: '1.2.3' },
          { from: 'app-two', version: '^1.0.0' }
        ],
        dependencyOf: ['app-one', 'app-two'],
        source: 'example/skills',
        version: '1.2.3'
      })
    )
  })

  it('materializes plugin skill dependencies under .oo/skills/.plugins and removes stale plugin deps', async () => {
    const workspace = await createWorkspace()
    await installPluginPackage(workspace, '@oneworks/plugin-review', {
      'package.json': JSON.stringify({ name: '@oneworks/plugin-review', version: '1.0.0' }, null, 2),
      'skills/review-helper/SKILL.md': [
        '---',
        'name: review-helper',
        'description: Review helper',
        'dependencies:',
        '  - name: shared-runtime',
        '    source: example/skills',
        '    version: "1.0.0"',
        '---',
        'Review code.'
      ].join('\n')
    })
    mockSkillInstall(workspace, {})

    await syncProjectSkills({
      state: {
        projectConfig: {
          plugins: [{ id: '@oneworks/plugin-review', scope: 'review' }]
        },
        userConfig: undefined
      } as never,
      targets: [],
      workspaceFolder: workspace
    })

    expect(mocks.installProjectSkill).toHaveBeenCalledWith(expect.objectContaining({
      installPathSegments: ['.plugins', 'review'],
      skill: expect.objectContaining({
        targetName: 'shared-runtime'
      })
    }))
    expect(await pathExists(path.join(workspace, '.oo/skills/.plugins/review/shared-runtime/SKILL.md'))).toBe(true)
    expect((await readProjectSkillsLockfile(workspace)).pluginSkills).toEqual({
      'review/shared-runtime': expect.objectContaining({
        dependencyOf: ['plugin:review/review-helper'],
        installPath: '.oo/skills/.plugins/review/shared-runtime',
        name: 'shared-runtime',
        pluginInstance: 'review',
        requested: false
      })
    })

    await syncProjectSkills({
      state: {
        projectConfig: {},
        userConfig: undefined
      } as never,
      targets: [],
      workspaceFolder: workspace
    })

    expect(await pathExists(path.join(workspace, '.oo/skills/.plugins/review/shared-runtime/SKILL.md'))).toBe(false)
    expect((await readProjectSkillsLockfile(workspace)).pluginSkills).toBeUndefined()
  })

  it('refuses to clean stale plugin dependencies when local edits changed their hash', async () => {
    const workspace = await createWorkspace()
    await installPluginPackage(workspace, '@oneworks/plugin-review', {
      'package.json': JSON.stringify({ name: '@oneworks/plugin-review', version: '1.0.0' }, null, 2),
      'skills/review-helper/SKILL.md': [
        '---',
        'name: review-helper',
        'description: Review helper',
        'dependencies:',
        '  - name: shared-runtime',
        '    source: example/skills',
        '    version: "1.0.0"',
        '---',
        'Review code.'
      ].join('\n')
    })
    mockSkillInstall(workspace, {})

    await syncProjectSkills({
      state: {
        projectConfig: {
          plugins: [{ id: '@oneworks/plugin-review', scope: 'review' }]
        },
        userConfig: undefined
      } as never,
      targets: [],
      workspaceFolder: workspace
    })
    const dependencyPath = path.join(workspace, '.oo/skills/.plugins/review/shared-runtime')
    await writeDocument(path.join(dependencyPath, 'LOCAL.md'), 'local edits\n')

    await expect(syncProjectSkills({
      state: {
        projectConfig: {},
        userConfig: undefined
      } as never,
      targets: [],
      workspaceFolder: workspace
    })).rejects.toThrow('has local changes')

    expect(await pathExists(path.join(dependencyPath, 'SKILL.md'))).toBe(true)
    expect((await readProjectSkillsLockfile(workspace)).pluginSkills).toHaveProperty('review/shared-runtime')
  })
})
