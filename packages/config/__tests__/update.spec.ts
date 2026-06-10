/* eslint-disable max-lines -- config writer regression cases are kept together. */
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { describe, expect, it } from 'vitest'

import { updateConfigFile } from '#~/update.js'

describe('updateConfigFile', () => {
  it('writes global config updates into real home', async () => {
    const realHomeDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-update-global-home-'))
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-update-global-workspace-'))
    const previousRealHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__

    try {
      process.env.__ONEWORKS_PROJECT_REAL_HOME__ = realHomeDir

      const result = await updateConfigFile({
        workspaceFolder: workspaceDir,
        source: 'global',
        section: 'general',
        value: {
          defaultModelService: 'global-service'
        }
      })

      expect(result.configPath).toBe(path.join(realHomeDir, '.oneworks', '.oo.config.json'))
      const written = JSON.parse(await readFile(result.configPath, 'utf-8'))
      expect(written.defaultModelService).toBe('global-service')
    } finally {
      if (previousRealHome == null) {
        delete process.env.__ONEWORKS_PROJECT_REAL_HOME__
      } else {
        process.env.__ONEWORKS_PROJECT_REAL_HOME__ = previousRealHome
      }
      await rm(realHomeDir, { recursive: true, force: true })
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })

  it('writes the disable global config switch from the general section', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-update-general-'))

    try {
      const result = await updateConfigFile({
        workspaceFolder: tempDir,
        source: 'project',
        section: 'general',
        value: {
          disableGlobalConfig: true,
          defaultModelService: 'project-service'
        }
      })

      expect(result.updatedConfig.disableGlobalConfig).toBe(true)
      expect(result.updatedConfig.defaultModelService).toBe('project-service')

      const written = JSON.parse(await readFile(path.join(tempDir, '.oo.config.json'), 'utf-8'))
      expect(written).toEqual({
        disableGlobalConfig: true,
        defaultModelService: 'project-service'
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('writes desktop prefs into global config and project update channel into project config', async () => {
    const realHomeDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-update-desktop-home-'))
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-update-desktop-workspace-'))
    const previousRealHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__

    try {
      process.env.__ONEWORKS_PROJECT_REAL_HOME__ = realHomeDir

      const result = await updateConfigFile({
        workspaceFolder: workspaceDir,
        source: 'global',
        section: 'desktop',
        value: {
          launcherShortcut: 'option+space',
          iconTheme: 'matrix'
        }
      })

      expect(result.configPath).toBe(path.join(realHomeDir, '.oneworks', '.oo.config.json'))
      expect(JSON.parse(await readFile(result.configPath, 'utf-8'))).toEqual({
        desktop: {
          launcherShortcut: 'option+space',
          iconTheme: 'matrix'
        }
      })

      const projectResult = await updateConfigFile({
        workspaceFolder: workspaceDir,
        source: 'project',
        section: 'desktop',
        value: {
          autoUpdate: false,
          moduleUpdateChannels: {
            client: 'alpha',
            server: 'beta'
          },
          updateChannel: 'beta'
        }
      })

      expect(projectResult.configPath).toBe(path.join(workspaceDir, '.oo.config.json'))
      expect(JSON.parse(await readFile(projectResult.configPath, 'utf-8'))).toEqual({
        desktop: {
          autoUpdate: false,
          moduleUpdateChannels: {
            client: 'alpha',
            server: 'beta'
          },
          updateChannel: 'beta'
        }
      })

      const clearedProjectResult = await updateConfigFile({
        workspaceFolder: workspaceDir,
        source: 'project',
        section: 'desktop',
        value: {}
      })

      expect(clearedProjectResult.configPath).toBe(path.join(workspaceDir, '.oo.config.json'))
      expect(JSON.parse(await readFile(clearedProjectResult.configPath, 'utf-8'))).toEqual({
        desktop: {}
      })

      await expect(updateConfigFile({
        workspaceFolder: workspaceDir,
        source: 'project',
        section: 'desktop',
        value: {
          launcherShortcut: 'ctrl+space'
        }
      })).rejects.toThrow(
        'Config section "desktop" can only be written to global config, except project desktop auto-update settings.'
      )
    } finally {
      if (previousRealHome == null) {
        delete process.env.__ONEWORKS_PROJECT_REAL_HOME__
      } else {
        process.env.__ONEWORKS_PROJECT_REAL_HOME__ = previousRealHome
      }
      await rm(realHomeDir, { recursive: true, force: true })
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })

  it('preserves masked secret values when updating project config', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-update-'))

    try {
      const configPath = path.join(tempDir, '.oo.config.json')
      await writeFile(
        configPath,
        JSON.stringify(
          {
            modelServices: {
              openai: {
                apiKey: 'secret-key',
                baseURL: 'https://example.com'
              }
            }
          },
          null,
          2
        )
      )

      const result = await updateConfigFile({
        workspaceFolder: tempDir,
        source: 'project',
        section: 'modelServices',
        value: {
          openai: {
            apiKey: '******',
            baseURL: 'https://api.example.com'
          }
        }
      })

      expect(result.configPath).toBe(configPath)
      expect(result.updatedConfig.modelServices?.openai).toEqual({
        apiKey: 'secret-key',
        baseURL: 'https://api.example.com'
      })

      const written = JSON.parse(await readFile(configPath, 'utf-8'))
      expect(written.modelServices.openai).toEqual({
        apiKey: 'secret-key',
        baseURL: 'https://api.example.com'
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('falls back to the primary workspace dev config when the current worktree has none', async () => {
    const primaryDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-update-primary-'))
    const worktreeDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-update-worktree-'))
    const previousPrimaryWorkspace = process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__

    try {
      const primaryConfigPath = path.join(primaryDir, '.oo.dev.config.json')
      await writeFile(
        primaryConfigPath,
        JSON.stringify(
          {
            defaultModelService: 'openai',
            recommendedModels: [
              {
                service: 'openai',
                model: 'gpt-5.4'
              }
            ]
          },
          null,
          2
        )
      )

      process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ = primaryDir

      const result = await updateConfigFile({
        workspaceFolder: worktreeDir,
        source: 'user',
        section: 'general',
        value: {
          defaultModelService: 'openai',
          recommendedModels: [
            {
              service: 'openai',
              model: 'gpt-5.4-mini'
            }
          ]
        }
      })

      expect(result.configPath).toBe(primaryConfigPath)
      expect(result.updatedConfig.recommendedModels).toEqual([
        {
          service: 'openai',
          model: 'gpt-5.4-mini'
        }
      ])

      const written = JSON.parse(await readFile(primaryConfigPath, 'utf-8'))
      expect(written.recommendedModels).toEqual([
        {
          service: 'openai',
          model: 'gpt-5.4-mini'
        }
      ])
    } finally {
      if (previousPrimaryWorkspace == null) {
        delete process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__
      } else {
        process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ = previousPrimaryWorkspace
      }
      await rm(primaryDir, { recursive: true, force: true })
      await rm(worktreeDir, { recursive: true, force: true })
    }
  })

  it('creates the primary workspace dev config when no user config file exists', async () => {
    const primaryDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-update-primary-'))
    const worktreeDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-update-worktree-'))
    const previousPrimaryWorkspace = process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__

    try {
      process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ = primaryDir

      const result = await updateConfigFile({
        workspaceFolder: worktreeDir,
        source: 'user',
        section: 'general',
        value: {
          defaultModelService: 'openai',
          defaultModel: 'gpt-5.4-mini'
        }
      })

      const primaryConfigPath = path.join(primaryDir, '.oo.dev.config.json')
      expect(result.configPath).toBe(primaryConfigPath)
      expect(result.updatedConfig.defaultModel).toBe('gpt-5.4-mini')

      const written = JSON.parse(await readFile(primaryConfigPath, 'utf-8'))
      expect(written).toEqual({
        defaultModelService: 'openai',
        defaultModel: 'gpt-5.4-mini'
      })
    } finally {
      if (previousPrimaryWorkspace == null) {
        delete process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__
      } else {
        process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ = previousPrimaryWorkspace
      }
      await rm(primaryDir, { recursive: true, force: true })
      await rm(worktreeDir, { recursive: true, force: true })
    }
  })

  it('replaces a dangling primary workspace dev config symlink when creating user config', async () => {
    if (process.platform === 'win32') {
      return
    }

    const primaryDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-update-primary-'))
    const worktreeDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-update-worktree-'))
    const previousPrimaryWorkspace = process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__

    try {
      const primaryConfigPath = path.join(primaryDir, '.oo.dev.config.json')
      await symlink(path.join('missing-dir', '.oo.dev.config.json'), primaryConfigPath)
      process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ = primaryDir

      const result = await updateConfigFile({
        workspaceFolder: worktreeDir,
        source: 'user',
        section: 'general',
        value: {
          defaultModelService: 'openai',
          defaultModel: 'gpt-5.4-mini'
        }
      })

      expect(result.configPath).toBe(primaryConfigPath)
      expect((await lstat(primaryConfigPath)).isSymbolicLink()).toBe(false)

      const written = JSON.parse(await readFile(primaryConfigPath, 'utf-8'))
      expect(written).toEqual({
        defaultModelService: 'openai',
        defaultModel: 'gpt-5.4-mini'
      })
    } finally {
      if (previousPrimaryWorkspace == null) {
        delete process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__
      } else {
        process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ = previousPrimaryWorkspace
      }
      await rm(primaryDir, { recursive: true, force: true })
      await rm(worktreeDir, { recursive: true, force: true })
    }
  })

  it('preserves unrelated general fields when updating only permissions', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-update-'))

    try {
      const configPath = path.join(tempDir, '.oo.config.json')
      await writeFile(
        configPath,
        JSON.stringify(
          {
            announcements: ['hello'],
            shortcuts: {
              openConfig: 'mod+,'
            },
            skills: [
              'https://registry.example.com@example-source/default/public@design-review@1.0.3'
            ],
            permissions: {
              allow: ['ChromeDevtools'],
              deny: [],
              ask: ['Bash(kill:*)']
            }
          },
          null,
          2
        )
      )

      const result = await updateConfigFile({
        workspaceFolder: tempDir,
        source: 'project',
        section: 'general',
        value: {
          permissions: {
            allow: ['Bash'],
            deny: [],
            ask: []
          }
        }
      })

      expect(result.updatedConfig.announcements).toEqual(['hello'])
      expect(result.updatedConfig.shortcuts).toEqual({
        openConfig: 'mod+,'
      })
      expect(result.updatedConfig.skills).toEqual([
        'https://registry.example.com@example-source/default/public@design-review@1.0.3'
      ])
      expect(result.updatedConfig.permissions).toEqual({
        allow: ['Bash'],
        deny: [],
        ask: []
      })

      const written = JSON.parse(await readFile(configPath, 'utf-8'))
      expect(written).toEqual({
        announcements: ['hello'],
        shortcuts: {
          openConfig: 'mod+,'
        },
        skills: [
          'https://registry.example.com@example-source/default/public@design-review@1.0.3'
        ],
        permissions: {
          allow: ['Bash'],
          deny: [],
          ask: []
        }
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('updates message link settings from the general section', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-update-'))

    try {
      const configPath = path.join(tempDir, '.oo.config.json')
      await writeFile(configPath, JSON.stringify({}, null, 2))

      const result = await updateConfigFile({
        workspaceFolder: tempDir,
        source: 'project',
        section: 'general',
        value: {
          messageLinks: {
            externalLinkTarget: 'currentTab',
            workspaceFileTarget: 'externalIde',
            workspaceFileOpener: 'vscode',
            imageLinkMode: 'link',
            plainWorkspacePathMode: 'text'
          }
        }
      })

      expect(result.updatedConfig.messageLinks).toEqual({
        externalLinkTarget: 'currentTab',
        workspaceFileTarget: 'externalIde',
        workspaceFileOpener: 'vscode',
        imageLinkMode: 'link',
        plainWorkspacePathMode: 'text'
      })

      const written = JSON.parse(await readFile(configPath, 'utf-8'))
      expect(written.messageLinks).toEqual(result.updatedConfig.messageLinks)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('writes experiment section updates without dropping unrelated config', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-update-'))

    try {
      const configPath = path.join(tempDir, '.oo.config.json')
      await writeFile(
        configPath,
        JSON.stringify(
          {
            defaultModel: 'gpt-5.4',
            experiments: {
              agentRoom: false,
              automation: false,
              benchmark: false,
              sessionTimeline: false
            }
          },
          null,
          2
        )
      )

      const result = await updateConfigFile({
        workspaceFolder: tempDir,
        source: 'project',
        section: 'experiments',
        value: {
          agentRoom: true,
          automation: true,
          benchmark: true,
          sessionTimeline: true
        }
      })

      expect(result.updatedConfig.defaultModel).toBe('gpt-5.4')
      expect(result.updatedConfig.experiments).toEqual({
        agentRoom: true,
        automation: true,
        benchmark: true,
        sessionTimeline: true
      })

      const written = JSON.parse(await readFile(configPath, 'utf-8'))
      expect(written).toEqual({
        defaultModel: 'gpt-5.4',
        experiments: {
          agentRoom: true,
          automation: true,
          benchmark: true,
          sessionTimeline: true
        }
      })
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })

  it('writes config updates into __ONEWORKS_PROJECT_CONFIG_DIR__ when provided', async () => {
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-update-workspace-'))
    const launchDir = path.join(workspaceDir, 'c', 'd', 'e')
    const previousConfigDir = process.env.__ONEWORKS_PROJECT_CONFIG_DIR__
    const previousLaunchCwd = process.env.__ONEWORKS_PROJECT_LAUNCH_CWD__
    const previousWorkspaceFolder = process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__

    try {
      await mkdir(launchDir, { recursive: true })
      await writeFile(
        path.join(launchDir, '.oo.config.json'),
        JSON.stringify(
          {
            defaultModel: 'gpt-5.4'
          },
          null,
          2
        )
      )

      process.env.__ONEWORKS_PROJECT_LAUNCH_CWD__ = launchDir
      process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = '../../..'
      process.env.__ONEWORKS_PROJECT_CONFIG_DIR__ = '.'

      const result = await updateConfigFile({
        workspaceFolder: launchDir,
        source: 'project',
        section: 'general',
        value: {
          defaultModel: 'gpt-5.4-mini'
        }
      })

      expect(result.configPath).toBe(path.join(launchDir, '.oo.config.json'))
      const written = JSON.parse(await readFile(result.configPath, 'utf-8'))
      expect(written.defaultModel).toBe('gpt-5.4-mini')
    } finally {
      if (previousConfigDir == null) {
        delete process.env.__ONEWORKS_PROJECT_CONFIG_DIR__
      } else {
        process.env.__ONEWORKS_PROJECT_CONFIG_DIR__ = previousConfigDir
      }
      if (previousLaunchCwd == null) {
        delete process.env.__ONEWORKS_PROJECT_LAUNCH_CWD__
      } else {
        process.env.__ONEWORKS_PROJECT_LAUNCH_CWD__ = previousLaunchCwd
      }
      if (previousWorkspaceFolder == null) {
        delete process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
      } else {
        process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = previousWorkspaceFolder
      }
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })

  it('writes project config updates into the resolved workspace root when launched from a nested directory', async () => {
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-update-root-'))
    const launchDir = path.join(workspaceDir, 'apps', 'client', 'src')
    const previousLaunchCwd = process.env.__ONEWORKS_PROJECT_LAUNCH_CWD__
    const previousWorkspaceFolder = process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
    const previousConfigDir = process.env.__ONEWORKS_PROJECT_CONFIG_DIR__

    try {
      await mkdir(launchDir, { recursive: true })
      await writeFile(
        path.join(workspaceDir, '.oo.config.json'),
        JSON.stringify(
          {
            defaultModel: 'gpt-5.4'
          },
          null,
          2
        )
      )

      process.env.__ONEWORKS_PROJECT_LAUNCH_CWD__ = launchDir
      process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspaceDir
      delete process.env.__ONEWORKS_PROJECT_CONFIG_DIR__

      const result = await updateConfigFile({
        workspaceFolder: launchDir,
        source: 'project',
        section: 'general',
        value: {
          defaultModel: 'gpt-5.4-mini'
        }
      })

      expect(result.configPath).toBe(path.join(workspaceDir, '.oo.config.json'))
      const written = JSON.parse(await readFile(result.configPath, 'utf-8'))
      expect(written.defaultModel).toBe('gpt-5.4-mini')
    } finally {
      if (previousLaunchCwd == null) {
        delete process.env.__ONEWORKS_PROJECT_LAUNCH_CWD__
      } else {
        process.env.__ONEWORKS_PROJECT_LAUNCH_CWD__ = previousLaunchCwd
      }
      if (previousWorkspaceFolder == null) {
        delete process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
      } else {
        process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = previousWorkspaceFolder
      }
      if (previousConfigDir == null) {
        delete process.env.__ONEWORKS_PROJECT_CONFIG_DIR__
      } else {
        process.env.__ONEWORKS_PROJECT_CONFIG_DIR__ = previousConfigDir
      }
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })
})
