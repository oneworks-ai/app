import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { installAdapterPluginWithInstaller, syncConfiguredMarketplacePlugins } from '#~/managed-plugin-install.js'
import { resolveProjectHomePath } from '@oneworks/utils/ai-path'
import { getManagedPluginInstallDir } from '@oneworks/utils/managed-plugin'
import { convertClaudePluginToOneWorks } from '../../adapters/claude-code/src/plugins/convert'
import {
  detectClaudePluginRoot,
  mergeClaudePluginManifest,
  parseClaudePluginManifest
} from '../../adapters/claude-code/src/plugins/source'

const { loadAdapterPluginInstallerMock } = vi.hoisted(() => ({
  loadAdapterPluginInstallerMock: vi.fn()
}))

vi.mock('@oneworks/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@oneworks/types')>()
  return {
    ...actual,
    loadAdapterPluginInstaller: loadAdapterPluginInstallerMock
  }
})

const tempDirs: string[] = []
const originalProjectHomeProjectsDir = process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__

afterEach(async () => {
  if (originalProjectHomeProjectsDir == null) {
    delete process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
  } else {
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = originalProjectHomeProjectsDir
  }
  vi.restoreAllMocks()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  loadAdapterPluginInstallerMock.mockReset()
})

const createMarketplaceWorkspace = async (options?: {
  syncOnRun?: boolean
}) => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'ow-marketplace-sync-'))
  tempDirs.push(workspace)
  process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(workspace, '.oneworks-projects')

  const marketplaceDir = path.join(workspace, 'team-marketplace')
  const pluginSourceDir = path.join(marketplaceDir, 'plugins', 'reviewer')

  await mkdir(path.join(marketplaceDir, '.claude-plugin'), { recursive: true })
  await mkdir(path.join(pluginSourceDir, '.claude-plugin'), { recursive: true })
  await mkdir(path.join(pluginSourceDir, 'commands'), { recursive: true })

  await writeFile(
    path.join(workspace, '.oo.config.yaml'),
    [
      'marketplaces:',
      '  team-tools:',
      '    type: claude-code',
      `    syncOnRun: ${options?.syncOnRun === true ? 'true' : 'false'}`,
      '    plugins:',
      '      reviewer:',
      '        scope: review',
      '    options:',
      '      source:',
      '        source: directory',
      `        path: ${JSON.stringify(marketplaceDir)}`
    ].join('\n')
  )
  await writeFile(
    path.join(marketplaceDir, '.claude-plugin', 'marketplace.json'),
    JSON.stringify(
      {
        metadata: {
          pluginRoot: './plugins'
        },
        plugins: [
          {
            name: 'reviewer',
            source: 'reviewer'
          }
        ]
      },
      null,
      2
    )
  )
  await writeFile(
    path.join(pluginSourceDir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'reviewer' }, null, 2)
  )
  await writeFile(path.join(pluginSourceDir, 'commands', 'review.md'), 'Review from marketplace v1\n')

  return {
    workspace,
    marketplaceDir,
    pluginSourceDir
  }
}

describe('syncConfiguredMarketplacePlugins', () => {
  const mockInstaller = {
    adapter: 'claude',
    displayName: 'Claude',
    resolveSource: async (context: { cwd: string; requestedSource: string }) => {
      const separatorIndex = context.requestedSource.lastIndexOf('@')
      const pluginName = context.requestedSource.slice(0, separatorIndex)
      const marketplaceName = context.requestedSource.slice(separatorIndex + 1)
      return {
        installSource: {
          type: 'path' as const,
          path: path.join(context.cwd, 'team-marketplace', 'plugins', pluginName)
        },
        managedSource: {
          type: 'marketplace' as const,
          marketplace: marketplaceName,
          plugin: pluginName
        }
      }
    },
    detectPluginRoot: detectClaudePluginRoot,
    readManifest: parseClaudePluginManifest,
    mergeManifest: mergeClaudePluginManifest,
    convertToOneWorks: convertClaudePluginToOneWorks
  }

  it('installs declared marketplace plugins into project home when missing', async () => {
    const { workspace } = await createMarketplaceWorkspace()
    loadAdapterPluginInstallerMock.mockResolvedValue(mockInstaller)
    const installDir = getManagedPluginInstallDir(workspace, 'claude', 'team-tools--reviewer', process.env)
    const sentinelPath = path.join(installDir, 'sentinel.txt')
    await mkdir(installDir, { recursive: true })
    await writeFile(sentinelPath, 'user-owned\n')

    for (const force of [false, true]) {
      await expect(installAdapterPluginWithInstaller(mockInstaller, {
        cwd: workspace,
        force,
        silent: true,
        source: 'reviewer@team-tools'
      })).rejects.toThrow(/not a valid managed plugin install/i)
      await expect(readFile(sentinelPath, 'utf8')).resolves.toBe('user-owned\n')
    }
    await rm(installDir, { recursive: true })

    const results = await syncConfiguredMarketplacePlugins({
      cwd: workspace,
      marketplaces: {
        'team-tools': {
          type: 'claude-code',
          syncOnRun: false,
          plugins: {
            reviewer: {
              scope: 'review'
            }
          }
        }
      }
    })

    expect(results).toEqual([
      {
        marketplace: 'team-tools',
        plugin: 'reviewer',
        action: 'installed'
      }
    ])
    await expect(
      readFile(path.join(installDir, 'oneworks/skills/review/SKILL.md'), 'utf8')
    ).resolves.toContain('Review from marketplace v1')
    await expect(
      readFile(path.join(installDir, '.oneworks-plugin.json'), 'utf8')
    ).resolves.toContain('"scope": "review"')
    await expect(stat(path.join(installDir, 'data'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      stat(
        resolveProjectHomePath(workspace, process.env, '.local', 'plugins', 'claude', 'team-tools--reviewer', 'data')
      )
    ).resolves.toEqual(expect.objectContaining({ isDirectory: expect.any(Function) }))
    await expect(stat(path.join(workspace, '.oo/plugins/reviewer'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('updates declared marketplace plugins on run when syncOnRun is enabled', async () => {
    const { workspace, pluginSourceDir } = await createMarketplaceWorkspace({ syncOnRun: true })
    loadAdapterPluginInstallerMock.mockResolvedValue(mockInstaller)
    const installDir = getManagedPluginInstallDir(workspace, 'claude', 'team-tools--reviewer', process.env)

    await syncConfiguredMarketplacePlugins({
      cwd: workspace,
      marketplaces: {
        'team-tools': {
          type: 'claude-code',
          syncOnRun: true,
          plugins: {
            reviewer: {
              scope: 'review'
            }
          }
        }
      }
    })
    await writeFile(path.join(pluginSourceDir, 'commands', 'review.md'), 'Review from marketplace v2\n')

    const results = await syncConfiguredMarketplacePlugins({
      cwd: workspace,
      marketplaces: {
        'team-tools': {
          type: 'claude-code',
          syncOnRun: true,
          plugins: {
            reviewer: {
              scope: 'review'
            }
          }
        }
      }
    })

    expect(results.at(-1)).toEqual({
      marketplace: 'team-tools',
      plugin: 'reviewer',
      action: 'updated'
    })
    await expect(
      readFile(path.join(installDir, 'oneworks/skills/review/SKILL.md'), 'utf8')
    ).resolves.toContain('Review from marketplace v2')
  })

  it('rejects duplicate runtime scopes before installing marketplace plugins', async () => {
    const { workspace } = await createMarketplaceWorkspace()
    loadAdapterPluginInstallerMock.mockResolvedValue(mockInstaller)

    await expect(syncConfiguredMarketplacePlugins({
      cwd: workspace,
      marketplaces: {
        'team-tools': {
          type: 'claude-code',
          plugins: { reviewer: { scope: 'review' } }
        },
        'other-tools': {
          type: 'claude-code',
          plugins: { auditor: { scope: 'review' } }
        }
      }
    })).rejects.toThrow(/scope "review" is declared by both/i)

    expect(loadAdapterPluginInstallerMock).not.toHaveBeenCalled()
  })
})

describe('installAdapterPluginWithInstaller ownership', () => {
  it('does not force-replace a different plugin with the same lossy slug', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'ow-plugin-slug-collision-'))
    tempDirs.push(workspace)
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(workspace, '.oneworks-projects')
    const firstSource = path.join(workspace, 'first-source')
    const secondSource = path.join(workspace, 'second-source')
    for (
      const [source, name, sentinel] of [
        [firstSource, 'Foo Bar', 'first owner'],
        [secondSource, 'foo-bar', 'colliding owner']
      ]
    ) {
      await mkdir(path.join(source, '.claude-plugin'), { recursive: true })
      await mkdir(path.join(source, 'commands'), { recursive: true })
      await writeFile(
        path.join(source, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name }, null, 2)
      )
      await writeFile(path.join(source, 'commands', 'owner.md'), `${sentinel}\n`)
    }
    const installer = {
      adapter: 'claude',
      convertToOneWorks: convertClaudePluginToOneWorks,
      detectPluginRoot: detectClaudePluginRoot,
      mergeManifest: mergeClaudePluginManifest,
      readManifest: parseClaudePluginManifest
    }
    await installAdapterPluginWithInstaller(installer, {
      cwd: workspace,
      silent: true,
      source: firstSource
    })
    const installDir = getManagedPluginInstallDir(workspace, 'claude', 'foo-bar', process.env)

    await expect(installAdapterPluginWithInstaller(installer, {
      cwd: workspace,
      force: true,
      silent: true,
      source: secondSource
    })).rejects.toThrow(/different plugin/i)
    await expect(readFile(path.join(installDir, 'oneworks', 'skills', 'owner', 'SKILL.md'), 'utf8'))
      .resolves.toContain('first owner')
    await expect(readFile(path.join(installDir, '.oneworks-plugin.json'), 'utf8'))
      .resolves.toContain('"name": "Foo Bar"')
  })
})
