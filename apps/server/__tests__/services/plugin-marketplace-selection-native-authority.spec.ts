import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { resetConfigCache } from '@oneworks/config'
import {
  openFilesystemAuthorityForTest,
  prepareFilesystemAuthorityTestControlRoot,
  startFilesystemAuthorityBroker
} from '@oneworks/fs-authority-native/testing'
import { getManagedPluginInstallDir } from '@oneworks/utils/managed-plugin'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setPluginMarketplaceSelection } from '#~/services/plugins/marketplace-selection.js'
import { convertClaudePluginToOneWorks } from '../../../../packages/adapters/claude-code/src/plugins/convert'
import {
  detectClaudePluginRoot,
  mergeClaudePluginManifest,
  parseClaudePluginManifest
} from '../../../../packages/adapters/claude-code/src/plugins/source'

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

const envKeys = [
  '__ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__',
  '__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__',
  '__ONEWORKS_PROJECT_LAUNCH_CWD__',
  '__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__',
  '__ONEWORKS_PROJECT_WORKSPACE_FOLDER__'
] as const

describe('plugin marketplace selection with native authority', () => {
  let broker: Awaited<ReturnType<typeof startFilesystemAuthorityBroker>> | undefined
  let controlRoot = ''
  let previousEnv: Partial<Record<(typeof envKeys)[number], string>>
  let root = ''
  let secret = ''
  let workspace = ''

  beforeEach(async () => {
    previousEnv = Object.fromEntries(envKeys.flatMap(key => (
      process.env[key] == null ? [] : [[key, process.env[key]]]
    )))
    root = await mkdtemp(path.join(tmpdir(), 'ow-ma-'))
    workspace = path.join(root, 'workspace')
    const marketplace = path.join(workspace, 'team-marketplace')
    const plugin = path.join(marketplace, 'plugins', 'reviewer')
    const prepared = prepareFilesystemAuthorityTestControlRoot(path.join(root, 'authority'))
    controlRoot = prepared.controlRoot
    secret = prepared.secret

    await mkdir(path.join(plugin, '.claude-plugin'), { recursive: true })
    await mkdir(path.join(plugin, 'commands'), { recursive: true })
    await writeFile(path.join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'reviewer' }))
    await writeFile(path.join(plugin, 'commands', 'review.md'), 'Review through native authority\n')
    await writeFile(
      path.join(workspace, '.oo.config.json'),
      `${
        JSON.stringify(
          {
            disableGlobalConfig: true,
            marketplaces: {
              'team-tools': {
                type: 'claude-code',
                options: { source: { source: 'directory', path: marketplace } },
                plugins: { reviewer: { enabled: false, scope: 'review' } }
              }
            }
          },
          null,
          2
        )
      }\n`
    )

    process.env.__ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__ = '1'
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(root, 'projects')
    process.env.__ONEWORKS_PROJECT_LAUNCH_CWD__ = workspace
    process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ = workspace
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspace

    broker = await startFilesystemAuthorityBroker({
      controlRoot: prepared.controlRoot,
      secret: prepared.secret
    })
    loadAdapterPluginInstallerMock.mockResolvedValue({
      adapter: 'claude',
      displayName: 'Claude',
      resolveSource: async (context: { cwd: string; requestedSource: string }) => {
        const separator = context.requestedSource.lastIndexOf('@')
        const pluginName = context.requestedSource.slice(0, separator)
        const marketplaceName = context.requestedSource.slice(separator + 1)
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
    })
    await resetConfigCache()
  })

  afterEach(async () => {
    await resetConfigCache()
    await broker?.close()
    broker = undefined
    for (const key of envKeys) {
      const value = previousEnv[key]
      if (value == null) delete process.env[key]
      else process.env[key] = value
    }
    loadAdapterPluginInstallerMock.mockReset()
    await rm(root, { recursive: true, force: true })
  })

  it('installs a managed marketplace plugin through the candidate-owned broker', async () => {
    await expect(setPluginMarketplaceSelection({
      enabled: true,
      marketplace: 'team-tools',
      plugin: 'reviewer',
      target: 'project'
    }, {
      openAuthority: workspaceRoot =>
        openFilesystemAuthorityForTest(workspaceRoot, {
          autoStart: false,
          controlRoot,
          secret,
          timeoutMs: 5000
        })
    })).resolves.toEqual([{
      action: 'installed',
      marketplace: 'team-tools',
      plugin: 'reviewer'
    }])

    expect(broker?.endpoint).toBe(path.join(controlRoot, 'b.sock'))
    const installDir = getManagedPluginInstallDir(workspace, 'claude', 'team-tools--reviewer', process.env)
    await expect(readFile(path.join(installDir, 'oneworks/skills/review/SKILL.md'), 'utf8'))
      .resolves.toContain('Review through native authority')
  })
})
