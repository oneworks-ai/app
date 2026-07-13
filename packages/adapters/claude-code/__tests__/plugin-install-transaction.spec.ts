import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { installAdapterPluginWithInstaller } from '../../../../apps/cli/src/commands/@core/plugin-install'
import { claudeCodePluginInstaller } from '../src/plugins/index'

const tempDirs: string[] = []
const originalProjectHomeProjectsDir = process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__

const createPlugin = async (name: string) => {
  const cwd = await fs.mkdtemp(path.join(tmpdir(), 'ow-plugin-transaction-'))
  tempDirs.push(cwd)
  process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = path.join(cwd, '.oneworks-projects')
  const pluginSourceDir = path.join(cwd, 'plugin')
  await fs.mkdir(path.join(pluginSourceDir, '.claude-plugin'), { recursive: true })
  await fs.mkdir(path.join(pluginSourceDir, 'commands'), { recursive: true })
  await fs.writeFile(
    path.join(pluginSourceDir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name }, null, 2)
  )
  await fs.writeFile(path.join(pluginSourceDir, 'commands', 'review.md'), 'stable v1\n')
  return { cwd, pluginSourceDir }
}

afterEach(async () => {
  vi.restoreAllMocks()
  if (originalProjectHomeProjectsDir == null) {
    delete process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__
  } else {
    process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = originalProjectHomeProjectsDir
  }
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })))
})

const expectStableInstall = async (installDir: string, workspacePluginDir: string | undefined) => {
  await expect(
    fs.readFile(path.join(workspacePluginDir!, 'skills', 'review', 'SKILL.md'), 'utf8')
  ).resolves.toContain('stable v1')
  await expect(fs.access(path.join(installDir, '.oneworks-plugin.json'))).resolves.toBeUndefined()
}

describe('managed plugin install transaction', () => {
  it('keeps the previous install when a forced update fails conversion', async () => {
    const { cwd, pluginSourceDir } = await createPlugin('Transactional Plugin')
    const initial = await installAdapterPluginWithInstaller(claudeCodePluginInstaller, {
      cwd,
      source: pluginSourceDir
    })
    await fs.mkdir(path.join(pluginSourceDir, 'skills', 'review'), { recursive: true })
    await fs.writeFile(path.join(pluginSourceDir, 'skills', 'review', 'SKILL.md'), 'conflicting v2\n')

    await expect(installAdapterPluginWithInstaller(claudeCodePluginInstaller, {
      cwd,
      source: pluginSourceDir,
      force: true
    })).rejects.toThrow(/assets conflict/i)

    await expectStableInstall(initial.installDir, initial.workspacePluginDir)
  })

  it('keeps the previous install when writing the staged config fails', async () => {
    const { cwd, pluginSourceDir } = await createPlugin('Config Write Plugin')
    const initial = await installAdapterPluginWithInstaller(claudeCodePluginInstaller, {
      cwd,
      source: pluginSourceDir
    })
    const originalWriteFile = fs.writeFile.bind(fs)
    vi.spyOn(fs, 'writeFile').mockImplementation(async (file, data, options) => {
      if (String(file).includes('.install-staging-') && String(file).endsWith('.oneworks-plugin.json')) {
        throw new Error('simulated config write failure')
      }
      return originalWriteFile(file, data, options)
    })

    await expect(installAdapterPluginWithInstaller(claudeCodePluginInstaller, {
      cwd,
      source: pluginSourceDir,
      force: true
    })).rejects.toThrow('simulated config write failure')

    await expectStableInstall(initial.installDir, initial.workspacePluginDir)
  })

  it('restores the backup when committing the staged install fails', async () => {
    const { cwd, pluginSourceDir } = await createPlugin('Rename Rollback Plugin')
    const initial = await installAdapterPluginWithInstaller(claudeCodePluginInstaller, {
      cwd,
      source: pluginSourceDir
    })
    await fs.writeFile(path.join(pluginSourceDir, 'commands', 'review.md'), 'candidate v2\n')

    const originalRename = fs.rename.bind(fs)
    let rejectedStagingCommit = false
    vi.spyOn(fs, 'rename').mockImplementation(async (oldPath, newPath) => {
      if (!rejectedStagingCommit && String(oldPath).includes('.install-staging-')) {
        rejectedStagingCommit = true
        throw new Error('simulated staging commit failure')
      }
      return originalRename(oldPath, newPath)
    })

    await expect(installAdapterPluginWithInstaller(claudeCodePluginInstaller, {
      cwd,
      source: pluginSourceDir,
      force: true
    })).rejects.toThrow('simulated staging commit failure')

    await expectStableInstall(initial.installDir, initial.workspacePluginDir)
    await expect(fs.readdir(path.dirname(initial.installDir))).resolves.not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^\.install-(backup|staging)-/u)])
    )
  })
})
