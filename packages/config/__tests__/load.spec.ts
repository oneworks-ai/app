import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { describe, expect, it, vi } from 'vitest'

import {
  ADAPTER_COMMON_CONFIG_KEYS,
  DISABLE_DEV_CONFIG_ENV,
  DISABLE_GLOBAL_CONFIG_ENV,
  buildConfigJsonVariables,
  buildResolvedConfigState,
  loadAdapterConfig,
  loadConfig,
  loadConfigState,
  resetConfigCache,
  resolveAdapterCommonConfig,
  resolveAdapterConfig,
  resolveAdapterConfigEntry,
  resolveAdapterConfigWithContribution,
  resolveConfigState,
  resolveDisableGlobalConfig,
  splitAdapterConfigEntry
} from '#~/load.js'

const restoreEnvValue = (key: string, value: string | undefined) => {
  if (value == null) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

describe('loadConfig', () => {
  it('resolves the global disable switch by config precedence', () => {
    expect(resolveDisableGlobalConfig({
      globalConfig: { disableGlobalConfig: true },
      projectConfig: { disableGlobalConfig: false },
      userConfig: undefined
    })).toBe(false)

    expect(resolveDisableGlobalConfig({
      globalConfig: { disableGlobalConfig: false },
      projectConfig: { disableGlobalConfig: true },
      userConfig: { disableGlobalConfig: false }
    })).toBe(false)
  })

  it('can skip workspace dev config via env override', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-load-'))
    const previousCwd = process.cwd()
    const previousDisableDevConfig = process.env[DISABLE_DEV_CONFIG_ENV]

    try {
      await writeFile(
        path.join(tempDir, '.oo.config.json'),
        JSON.stringify({
          defaultModel: 'project-model'
        })
      )
      await writeFile(
        path.join(tempDir, '.oo.dev.config.json'),
        JSON.stringify({
          defaultModel: 'dev-model'
        })
      )

      process.chdir(tempDir)
      process.env[DISABLE_DEV_CONFIG_ENV] = '1'
      resetConfigCache()

      const [projectConfig, userConfig] = await loadConfig({
        jsonVariables: {}
      })

      expect(projectConfig?.defaultModel).toBe('project-model')
      expect(userConfig).toBeUndefined()
    } finally {
      process.chdir(previousCwd)
      if (previousDisableDevConfig == null) {
        delete process.env[DISABLE_DEV_CONFIG_ENV]
      } else {
        process.env[DISABLE_DEV_CONFIG_ENV] = previousDisableDevConfig
      }
      resetConfigCache()
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('adds channel session CLI permissions as runtime defaults without project config writes', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-channel-permissions-'))

    try {
      resetConfigCache()
      const state = await loadConfigState({
        cwd: tempDir,
        disableDevConfig: true,
        disableGlobalConfig: true,
        env: {
          __ONEWORKS_PROJECT_CHANNEL_TYPE__: 'wechat',
          __ONEWORKS_PROJECT_CHANNEL_KEY__: 'erjie'
        }
      })

      expect(state.projectSource).toBeUndefined()
      expect(state.effectiveProjectConfig?.permissions?.allow).toEqual([
        'bash-oneworks-channel-send',
        'bash-oneworks-mem'
      ])
      expect(state.mergedConfig.permissions?.allow).toEqual([
        'bash-oneworks-channel-send',
        'bash-oneworks-mem'
      ])
    } finally {
      await rm(tempDir, { force: true, recursive: true })
      resetConfigCache()
    }
  })

  it('uses the supplied env when resolving the workspace config directory', async () => {
    const workspaceA = await mkdtemp(path.join(os.tmpdir(), 'ow-config-workspace-a-'))
    const workspaceB = await mkdtemp(path.join(os.tmpdir(), 'ow-config-workspace-b-'))
    const previousWorkspaceFolder = process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__

    try {
      await writeFile(
        path.join(workspaceA, '.oo.config.json'),
        JSON.stringify({
          defaultModel: 'workspace-a-model'
        })
      )
      await writeFile(
        path.join(workspaceB, '.oo.config.json'),
        JSON.stringify({
          defaultModel: 'workspace-b-model'
        })
      )

      process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspaceA
      resetConfigCache()

      const env = {
        ...process.env,
        __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceB
      }
      const [projectConfig] = await loadConfig({
        cwd: workspaceB,
        env,
        jsonVariables: buildConfigJsonVariables(workspaceB, env)
      })

      expect(projectConfig?.defaultModel).toBe('workspace-b-model')
    } finally {
      if (previousWorkspaceFolder == null) {
        delete process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
      } else {
        process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = previousWorkspaceFolder
      }
      resetConfigCache()
      await rm(workspaceA, { force: true, recursive: true })
      await rm(workspaceB, { force: true, recursive: true })
    }
  })

  it('uses the supplied env when resolving the global config directory', async () => {
    const globalHomeA = await mkdtemp(path.join(os.tmpdir(), 'ow-config-global-a-'))
    const globalHomeB = await mkdtemp(path.join(os.tmpdir(), 'ow-config-global-b-'))
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'ow-config-global-env-'))
    const previousRealHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__

    try {
      await mkdir(path.join(globalHomeA, '.oneworks'), { recursive: true })
      await mkdir(path.join(globalHomeB, '.oneworks'), { recursive: true })
      await writeFile(
        path.join(globalHomeA, '.oneworks', '.oo.config.json'),
        JSON.stringify({
          defaultModel: 'global-a-model'
        })
      )
      await writeFile(
        path.join(globalHomeB, '.oneworks', '.oo.config.json'),
        JSON.stringify({
          defaultModel: 'global-b-model'
        })
      )

      process.env.__ONEWORKS_PROJECT_REAL_HOME__ = globalHomeA
      resetConfigCache()

      const env = {
        ...process.env,
        __ONEWORKS_PROJECT_REAL_HOME__: globalHomeB
      }
      const [projectConfig] = await loadConfig({
        cwd: workspace,
        env,
        jsonVariables: buildConfigJsonVariables(workspace, env)
      })

      expect(projectConfig?.defaultModel).toBe('global-b-model')
    } finally {
      restoreEnvValue('__ONEWORKS_PROJECT_REAL_HOME__', previousRealHome)
      resetConfigCache()
      await rm(globalHomeA, { force: true, recursive: true })
      await rm(globalHomeB, { force: true, recursive: true })
      await rm(workspace, { force: true, recursive: true })
    }
  })

  it('falls back to the primary workspace dev config when the current worktree has none', async () => {
    const primaryDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-primary-'))
    const worktreeDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-worktree-'))
    const previousPrimaryWorkspace = process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__

    try {
      await writeFile(
        path.join(worktreeDir, '.oo.config.json'),
        JSON.stringify({
          defaultModel: 'project-model'
        })
      )
      await writeFile(
        path.join(primaryDir, '.oo.dev.config.json'),
        JSON.stringify({
          defaultModel: 'primary-dev-model'
        })
      )

      process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ = primaryDir
      resetConfigCache()

      const [projectConfig, userConfig] = await loadConfig({
        cwd: worktreeDir,
        jsonVariables: {}
      })

      expect(projectConfig?.defaultModel).toBe('project-model')
      expect(userConfig?.defaultModel).toBe('primary-dev-model')
    } finally {
      if (previousPrimaryWorkspace == null) {
        delete process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__
      } else {
        process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ = previousPrimaryWorkspace
      }
      resetConfigCache()
      await rm(primaryDir, { force: true, recursive: true })
      await rm(worktreeDir, { force: true, recursive: true })
    }
  })

  it('layers global ~/.oneworks/.oo.config.json before project and workspace dev config', async () => {
    const realHomeDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-global-home-'))
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-global-workspace-'))
    const previousRealHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__

    try {
      process.env.__ONEWORKS_PROJECT_REAL_HOME__ = realHomeDir
      await mkdir(path.join(realHomeDir, '.oneworks'), { recursive: true })
      await writeFile(
        path.join(realHomeDir, '.oneworks', '.oo.config.json'),
        JSON.stringify({
          defaultModelService: 'global-service',
          env: {
            GLOBAL_ONLY: 'global',
            SHARED: 'global'
          },
          adapters: {
            codex: {
              defaultModel: 'global-model'
            }
          }
        })
      )
      await writeFile(
        path.join(workspaceDir, '.oo.config.json'),
        JSON.stringify({
          defaultModelService: 'project-service',
          env: {
            PROJECT_ONLY: 'project',
            SHARED: 'project'
          },
          adapters: {
            codex: {
              includeModels: ['project-include']
            }
          }
        })
      )
      await writeFile(
        path.join(workspaceDir, '.oo.dev.config.json'),
        JSON.stringify({
          defaultModel: 'dev-model',
          env: {
            DEV_ONLY: 'dev'
          },
          adapters: {
            codex: {
              excludeModels: ['dev-exclude']
            }
          }
        })
      )

      resetConfigCache()
      const state = await loadConfigState({
        cwd: workspaceDir,
        jsonVariables: {}
      })

      expect(state.globalSource?.configPath).toBe(path.join(realHomeDir, '.oneworks', '.oo.config.json'))
      expect(state.projectSource?.configPath).toBe(path.join(workspaceDir, '.oo.config.json'))
      expect(state.userSource?.configPath).toBe(path.join(workspaceDir, '.oo.dev.config.json'))
      expect(state.globalConfig).toMatchObject({
        defaultModelService: 'global-service'
      })
      expect(state.effectiveProjectConfig).toMatchObject({
        defaultModelService: 'project-service',
        env: {
          GLOBAL_ONLY: 'global',
          PROJECT_ONLY: 'project',
          SHARED: 'project'
        },
        adapters: {
          codex: {
            defaultModel: 'global-model',
            includeModels: ['project-include']
          }
        }
      })
      expect(state.projectConfig).toBe(state.effectiveProjectConfig)
      expect(state.userConfig).toMatchObject({
        defaultModel: 'dev-model',
        env: {
          DEV_ONLY: 'dev'
        },
        adapters: {
          codex: {
            excludeModels: ['dev-exclude']
          }
        }
      })
      expect(state.mergedConfig).toMatchObject({
        defaultModelService: 'project-service',
        defaultModel: 'dev-model',
        env: {
          GLOBAL_ONLY: 'global',
          PROJECT_ONLY: 'project',
          DEV_ONLY: 'dev',
          SHARED: 'project'
        },
        adapters: {
          codex: {
            defaultModel: 'global-model',
            includeModels: ['project-include'],
            excludeModels: ['dev-exclude']
          }
        }
      })
    } finally {
      restoreEnvValue('__ONEWORKS_PROJECT_REAL_HOME__', previousRealHome)
      resetConfigCache()
      await rm(realHomeDir, { force: true, recursive: true })
      await rm(workspaceDir, { force: true, recursive: true })
    }
  })

  it('loads global config from real home instead of mock HOME', async () => {
    const realHomeDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-real-home-'))
    const mockHomeDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-mock-home-'))
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-mock-workspace-'))
    const previousRealHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__
    const previousHome = process.env.HOME

    try {
      process.env.__ONEWORKS_PROJECT_REAL_HOME__ = realHomeDir
      process.env.HOME = mockHomeDir
      await mkdir(path.join(realHomeDir, '.oneworks'), { recursive: true })
      await mkdir(path.join(mockHomeDir, '.oneworks'), { recursive: true })
      await writeFile(
        path.join(realHomeDir, '.oneworks', '.oo.config.json'),
        JSON.stringify({
          defaultModel: 'real-home-model'
        })
      )
      await writeFile(
        path.join(mockHomeDir, '.oneworks', '.oo.config.json'),
        JSON.stringify({
          defaultModel: 'mock-home-model'
        })
      )

      resetConfigCache()
      const state = await loadConfigState({
        cwd: workspaceDir,
        jsonVariables: {}
      })

      expect(state.globalSource?.configPath).toBe(path.join(realHomeDir, '.oneworks', '.oo.config.json'))
      expect(state.mergedConfig.defaultModel).toBe('real-home-model')
    } finally {
      restoreEnvValue('__ONEWORKS_PROJECT_REAL_HOME__', previousRealHome)
      restoreEnvValue('HOME', previousHome)
      resetConfigCache()
      await rm(realHomeDir, { force: true, recursive: true })
      await rm(mockHomeDir, { force: true, recursive: true })
      await rm(workspaceDir, { force: true, recursive: true })
    }
  })

  it('falls back to HOME for global config when real home env is absent', async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-home-fallback-'))
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-home-fallback-workspace-'))
    const previousRealHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__
    const previousHome = process.env.HOME

    try {
      delete process.env.__ONEWORKS_PROJECT_REAL_HOME__
      process.env.HOME = homeDir
      await mkdir(path.join(homeDir, '.oneworks'), { recursive: true })
      await writeFile(
        path.join(homeDir, '.oneworks', '.oo.config.json'),
        JSON.stringify({
          defaultModel: 'home-global-model'
        })
      )

      resetConfigCache()
      const state = await loadConfigState({
        cwd: workspaceDir,
        jsonVariables: {}
      })

      expect(state.globalSource?.configPath).toBe(path.join(homeDir, '.oneworks', '.oo.config.json'))
      expect(state.mergedConfig.defaultModel).toBe('home-global-model')
    } finally {
      restoreEnvValue('__ONEWORKS_PROJECT_REAL_HOME__', previousRealHome)
      restoreEnvValue('HOME', previousHome)
      resetConfigCache()
      await rm(homeDir, { force: true, recursive: true })
      await rm(workspaceDir, { force: true, recursive: true })
    }
  })

  it('keeps global config when workspace dev configs are disabled', async () => {
    const realHomeDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-global-disabled-home-'))
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-global-disabled-workspace-'))
    const previousRealHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__
    const previousDisableDevConfig = process.env[DISABLE_DEV_CONFIG_ENV]

    try {
      process.env.__ONEWORKS_PROJECT_REAL_HOME__ = realHomeDir
      process.env[DISABLE_DEV_CONFIG_ENV] = '1'
      await mkdir(path.join(realHomeDir, '.oneworks'), { recursive: true })
      await writeFile(
        path.join(realHomeDir, '.oneworks', '.oo.config.json'),
        JSON.stringify({
          defaultModel: 'global-model'
        })
      )
      await writeFile(
        path.join(workspaceDir, '.oo.dev.config.json'),
        JSON.stringify({
          defaultModel: 'dev-model'
        })
      )

      resetConfigCache()
      const state = await loadConfigState({
        cwd: workspaceDir,
        jsonVariables: {}
      })

      expect(state.globalSource?.configPath).toBe(path.join(realHomeDir, '.oneworks', '.oo.config.json'))
      expect(state.userSource).toBeUndefined()
      expect(state.mergedConfig.defaultModel).toBe('global-model')
    } finally {
      restoreEnvValue('__ONEWORKS_PROJECT_REAL_HOME__', previousRealHome)
      restoreEnvValue(DISABLE_DEV_CONFIG_ENV, previousDisableDevConfig)
      resetConfigCache()
      await rm(realHomeDir, { force: true, recursive: true })
      await rm(workspaceDir, { force: true, recursive: true })
    }
  })

  it('skips reading global config via env override and separates the config cache', async () => {
    const realHomeDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-global-env-home-'))
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-global-env-workspace-'))
    const previousRealHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__
    const previousDisableGlobalConfig = process.env[DISABLE_GLOBAL_CONFIG_ENV]

    try {
      process.env.__ONEWORKS_PROJECT_REAL_HOME__ = realHomeDir
      delete process.env[DISABLE_GLOBAL_CONFIG_ENV]
      await mkdir(path.join(realHomeDir, '.oneworks'), { recursive: true })
      await writeFile(
        path.join(realHomeDir, '.oneworks', '.oo.config.json'),
        JSON.stringify({
          defaultModel: 'global-model'
        })
      )

      resetConfigCache()
      const enabledState = await loadConfigState({
        cwd: workspaceDir,
        jsonVariables: {}
      })
      process.env[DISABLE_GLOBAL_CONFIG_ENV] = '1'
      const disabledState = await loadConfigState({
        cwd: workspaceDir,
        jsonVariables: {}
      })

      expect(enabledState.globalSource?.configPath).toBe(path.join(realHomeDir, '.oneworks', '.oo.config.json'))
      expect(enabledState.mergedConfig.defaultModel).toBe('global-model')
      expect(disabledState.globalSource).toBeUndefined()
      expect(disabledState.globalConfig).toBeUndefined()
      expect(disabledState.mergedConfig.defaultModel).toBeUndefined()
    } finally {
      restoreEnvValue('__ONEWORKS_PROJECT_REAL_HOME__', previousRealHome)
      restoreEnvValue(DISABLE_GLOBAL_CONFIG_ENV, previousDisableGlobalConfig)
      resetConfigCache()
      await rm(realHomeDir, { force: true, recursive: true })
      await rm(workspaceDir, { force: true, recursive: true })
    }
  })

  it('can disable applying global config from the config switch', async () => {
    const realHomeDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-global-switch-home-'))
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-global-switch-workspace-'))
    const previousRealHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__

    try {
      process.env.__ONEWORKS_PROJECT_REAL_HOME__ = realHomeDir
      await mkdir(path.join(realHomeDir, '.oneworks'), { recursive: true })
      await writeFile(
        path.join(realHomeDir, '.oneworks', '.oo.config.json'),
        JSON.stringify({
          defaultModelService: 'global-service',
          env: {
            GLOBAL_ONLY: 'global'
          }
        })
      )
      await writeFile(
        path.join(workspaceDir, '.oo.config.json'),
        JSON.stringify({
          disableGlobalConfig: true,
          defaultModel: 'project-model'
        })
      )

      resetConfigCache()
      const state = await loadConfigState({
        cwd: workspaceDir,
        jsonVariables: {}
      })

      expect(state.globalSource?.configPath).toBe(path.join(realHomeDir, '.oneworks', '.oo.config.json'))
      expect(state.globalConfig).toBeUndefined()
      expect(state.effectiveProjectConfig).toMatchObject({
        disableGlobalConfig: true,
        defaultModel: 'project-model'
      })
      expect(state.mergedConfig.defaultModel).toBe('project-model')
      expect(state.mergedConfig.defaultModelService).toBeUndefined()
      expect(state.mergedConfig.env?.GLOBAL_ONLY).toBeUndefined()
    } finally {
      restoreEnvValue('__ONEWORKS_PROJECT_REAL_HOME__', previousRealHome)
      resetConfigCache()
      await rm(realHomeDir, { force: true, recursive: true })
      await rm(workspaceDir, { force: true, recursive: true })
    }
  })

  it('keeps the global source editable when the global config disables itself', async () => {
    const realHomeDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-global-self-disabled-home-'))
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-global-self-disabled-workspace-'))
    const previousRealHome = process.env.__ONEWORKS_PROJECT_REAL_HOME__

    try {
      process.env.__ONEWORKS_PROJECT_REAL_HOME__ = realHomeDir
      await mkdir(path.join(realHomeDir, '.oneworks'), { recursive: true })
      await writeFile(
        path.join(realHomeDir, '.oneworks', '.oo.config.json'),
        JSON.stringify({
          disableGlobalConfig: true,
          defaultModel: 'global-model'
        })
      )

      resetConfigCache()
      const state = await loadConfigState({
        cwd: workspaceDir,
        jsonVariables: {}
      })

      expect(state.globalSource?.configPath).toBe(path.join(realHomeDir, '.oneworks', '.oo.config.json'))
      expect(state.globalSource?.resolvedConfig?.disableGlobalConfig).toBe(true)
      expect(state.globalConfig).toBeUndefined()
      expect(state.mergedConfig.defaultModel).toBeUndefined()
    } finally {
      restoreEnvValue('__ONEWORKS_PROJECT_REAL_HOME__', previousRealHome)
      resetConfigCache()
      await rm(realHomeDir, { force: true, recursive: true })
      await rm(workspaceDir, { force: true, recursive: true })
    }
  })

  it('loads project config from __ONEWORKS_PROJECT_CONFIG_DIR__ while keeping workspace json variables', async () => {
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-workspace-'))
    const launchDir = path.join(workspaceDir, 'c', 'd', 'e')
    const workspaceFolderPlaceholder = '${' + 'WORKSPACE_FOLDER}'
    const previousConfigDir = process.env.__ONEWORKS_PROJECT_CONFIG_DIR__
    const previousLaunchCwd = process.env.__ONEWORKS_PROJECT_LAUNCH_CWD__
    const previousWorkspaceFolder = process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__

    try {
      await mkdir(launchDir, { recursive: true })
      await writeFile(
        path.join(launchDir, '.oo.config.json'),
        JSON.stringify({
          env: {
            WORKSPACE_ROOT: workspaceFolderPlaceholder
          }
        })
      )

      process.env.__ONEWORKS_PROJECT_LAUNCH_CWD__ = launchDir
      process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = '../../..'
      process.env.__ONEWORKS_PROJECT_CONFIG_DIR__ = '.'
      resetConfigCache()

      const [projectConfig] = await loadConfig({
        cwd: launchDir,
        jsonVariables: buildConfigJsonVariables(launchDir, process.env)
      })

      expect(projectConfig?.env?.WORKSPACE_ROOT).toBe(workspaceDir)
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
      resetConfigCache()
      await rm(workspaceDir, { force: true, recursive: true })
    }
  })

  it('loads project config from the resolved workspace root when launched from a nested directory', async () => {
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-root-load-'))
    const launchDir = path.join(workspaceDir, 'apps', 'client', 'src')
    const previousLaunchCwd = process.env.__ONEWORKS_PROJECT_LAUNCH_CWD__
    const previousWorkspaceFolder = process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
    const previousConfigDir = process.env.__ONEWORKS_PROJECT_CONFIG_DIR__

    try {
      await mkdir(launchDir, { recursive: true })
      await writeFile(
        path.join(workspaceDir, '.oo.config.json'),
        JSON.stringify({
          defaultModel: 'root-model'
        })
      )

      process.env.__ONEWORKS_PROJECT_LAUNCH_CWD__ = launchDir
      process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspaceDir
      delete process.env.__ONEWORKS_PROJECT_CONFIG_DIR__
      resetConfigCache()

      const [projectConfig] = await loadConfig({
        cwd: launchDir,
        jsonVariables: buildConfigJsonVariables(launchDir, process.env)
      })

      expect(projectConfig?.defaultModel).toBe('root-model')
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
      resetConfigCache()
      await rm(workspaceDir, { force: true, recursive: true })
    }
  })

  it('exposes raw and resolved source config state for extended configs', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-source-state-'))

    try {
      await writeFile(
        path.join(tempDir, 'base.yaml'),
        `
permissions:
  allow:
    - Read
notifications:
  events:
    completed:
      title: Base Title
`
      )
      await writeFile(
        path.join(tempDir, '.oo.config.json'),
        JSON.stringify({
          extend: './base.yaml',
          permissions: {
            allow: ['Edit']
          },
          notifications: {
            events: {
              completed: {
                sound: '/tmp/done.mp3'
              }
            }
          }
        })
      )

      resetConfigCache()
      const state = await loadConfigState({
        cwd: tempDir,
        jsonVariables: {}
      })

      expect(state.projectSource?.configPath).toBe(path.join(tempDir, '.oo.config.json'))
      expect(state.projectSource?.extendPaths).toEqual(['./base.yaml'])
      expect(state.projectSource?.resolvedExtendPaths).toEqual([path.join(tempDir, 'base.yaml')])
      expect(state.projectSource?.rawConfig?.permissions?.allow).toEqual(['Edit'])
      expect(state.projectSource?.resolvedConfig?.permissions?.allow).toEqual(['Read', 'Edit'])
      expect(state.projectSource?.rawConfig?.notifications?.events?.completed).toEqual({
        sound: '/tmp/done.mp3'
      })
      expect(state.projectSource?.resolvedConfig?.notifications?.events?.completed).toEqual({
        title: 'Base Title',
        sound: '/tmp/done.mp3'
      })
    } finally {
      resetConfigCache()
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('resolves extend chains with layered merge semantics', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-extend-'))

    try {
      await writeFile(
        path.join(tempDir, 'base.yaml'),
        `
defaultModelService: openai
env:
  BASE_URL: https://base.example.com
permissions:
  allow:
    - Read
announcements:
  - base
defaultIncludeMcpServers:
  - docs
notifications:
  events:
    completed:
      title: Base Title
desktop:
  launcherShortcut: option+space
  iconTheme: matrix
marketplaces:
  team-tools:
    type: claude-code
    options:
      source:
        source: settings
        plugins:
          - name: reviewer
            source:
              source: npm
              package: "@acme/reviewer"
plugins:
  - id: logger
    options:
      level: info
adapters:
  codex:
    defaultModel: gpt-4.1
`
      )
      await writeFile(
        path.join(tempDir, '.oo.config.json'),
        JSON.stringify(
          {
            extend: './base.yaml',
            defaultModel: 'project-model',
            env: {
              API_KEY: `\${TEST_API_KEY}`
            },
            permissions: {
              allow: ['Edit']
            },
            announcements: ['project'],
            defaultIncludeMcpServers: ['browser'],
            notifications: {
              events: {
                completed: {
                  description: 'Project Description'
                }
              }
            },
            desktop: {
              syncAppIcon: false
            },
            marketplaces: {
              'team-tools': {
                type: 'claude-code',
                enabled: false
              }
            },
            plugins: [
              {
                id: 'chrome',
                enabled: false,
                options: {
                  headless: true
                }
              }
            ],
            adapters: {
              codex: {
                excludeModels: ['gpt-4.1-mini']
              }
            }
          },
          null,
          2
        )
      )
      await writeFile(
        path.join(tempDir, 'user-base.json'),
        JSON.stringify(
          {
            plugins: [
              {
                id: 'telemetry',
                options: {
                  mode: 'summary'
                }
              }
            ],
            shortcuts: {
              openConfig: 'cmd+,'
            }
          },
          null,
          2
        )
      )
      await writeFile(
        path.join(tempDir, '.oo.dev.config.yaml'),
        `
extend:
  - ./user-base.json
plugins:
  - id: review
shortcuts:
  newSession: cmd+n
`
      )

      resetConfigCache()
      const [projectConfig, userConfig] = await loadConfig({
        cwd: tempDir,
        jsonVariables: {
          TEST_API_KEY: 'secret-key'
        }
      })

      expect(projectConfig).toMatchObject({
        defaultModelService: 'openai',
        defaultModel: 'project-model',
        env: {
          BASE_URL: 'https://base.example.com',
          API_KEY: 'secret-key'
        },
        permissions: {
          allow: ['Read', 'Edit', 'OneWorks']
        },
        announcements: ['base', 'project'],
        defaultIncludeMcpServers: ['docs', 'browser'],
        notifications: {
          events: {
            completed: {
              title: 'Base Title',
              description: 'Project Description'
            }
          }
        },
        desktop: {
          launcherShortcut: 'option+space',
          iconTheme: 'matrix',
          syncAppIcon: false
        },
        marketplaces: {
          'team-tools': {
            type: 'claude-code',
            enabled: false,
            options: {
              source: {
                source: 'settings',
                plugins: [
                  {
                    name: 'reviewer',
                    source: {
                      source: 'npm',
                      package: '@acme/reviewer'
                    }
                  }
                ]
              }
            }
          }
        },
        plugins: [
          {
            id: 'logger',
            options: {
              level: 'info'
            }
          },
          {
            id: 'chrome',
            enabled: false,
            options: {
              headless: true
            }
          }
        ],
        adapters: {
          codex: {
            defaultModel: 'gpt-4.1',
            excludeModels: ['gpt-4.1-mini']
          }
        }
      })
      expect(projectConfig?.extend).toBeUndefined()
      expect(userConfig).toMatchObject({
        plugins: [
          {
            id: 'telemetry',
            options: {
              mode: 'summary'
            }
          },
          {
            id: 'review'
          }
        ],
        shortcuts: {
          openConfig: 'cmd+,',
          newSession: 'cmd+n'
        }
      })
      expect(userConfig?.extend).toBeUndefined()
    } finally {
      resetConfigCache()
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('does not inject the built-in MCP permission when config disables the built-in server', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-disable-default-mcp-'))

    try {
      await writeFile(
        path.join(tempDir, '.oo.config.json'),
        JSON.stringify(
          {
            noDefaultOneworksMcpServer: true,
            permissions: {
              allow: ['Read']
            }
          },
          null,
          2
        )
      )

      resetConfigCache()
      const [projectConfig] = await loadConfig({
        cwd: tempDir,
        jsonVariables: {}
      })

      expect(projectConfig?.permissions?.allow).toEqual(['Read'])
    } finally {
      resetConfigCache()
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('throws a clear error for legacy object-map plugin configs in extend chains', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-legacy-plugins-'))

    try {
      await writeFile(
        path.join(tempDir, 'legacy.json'),
        JSON.stringify(
          {
            plugins: {
              logger: {
                level: 'info'
              }
            }
          },
          null,
          2
        )
      )
      await writeFile(
        path.join(tempDir, '.oo.config.json'),
        JSON.stringify(
          {
            extend: './legacy.json'
          },
          null,
          2
        )
      )

      resetConfigCache()
      const [projectConfig] = await loadConfig({
        cwd: tempDir,
        jsonVariables: {}
      })

      expect(projectConfig).toBeUndefined()
    } finally {
      resetConfigCache()
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('resolves extend from dependency packages and package subpaths', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-extend-package-'))

    try {
      const packageRoot = path.join(tempDir, 'node_modules', '@acme', 'ow-preset')
      await mkdir(path.join(packageRoot, 'presets'), { recursive: true })
      await writeFile(
        path.join(packageRoot, 'package.json'),
        JSON.stringify(
          {
            name: '@acme/ow-preset',
            version: '1.0.0'
          },
          null,
          2
        )
      )
      await writeFile(
        path.join(packageRoot, '.oo.config.yaml'),
        `
defaultModelService: preset-service
announcements:
  - package-root
`
      )
      await writeFile(
        path.join(packageRoot, 'presets', 'web.yaml'),
        `
permissions:
  allow:
    - Browser
modelServices:
  browser:
    apiBaseUrl: https://browser.example.com
    apiKey: browser-key
`
      )
      await writeFile(
        path.join(tempDir, '.oo.config.yaml'),
        `
extend:
  - "@acme/ow-preset"
  - "@acme/ow-preset/presets/web"
defaultModel: package-model
`
      )

      resetConfigCache()
      const [projectConfig, userConfig] = await loadConfig({
        cwd: tempDir,
        jsonVariables: {}
      })

      expect(projectConfig).toMatchObject({
        defaultModelService: 'preset-service',
        defaultModel: 'package-model',
        announcements: ['package-root'],
        permissions: {
          allow: ['Browser', 'OneWorks']
        },
        modelServices: {
          browser: {
            apiBaseUrl: 'https://browser.example.com',
            apiKey: 'browser-key'
          }
        }
      })
      expect(projectConfig?.extend).toBeUndefined()
      expect(userConfig).toBeUndefined()
    } finally {
      resetConfigCache()
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('merges config patches returned by configured plugin config hooks into the final user layer', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-plugin-hook-'))

    try {
      const pluginRoot = path.join(tempDir, 'node_modules', '@oneworks', 'plugin-relay')
      await mkdir(path.join(pluginRoot, 'dist'), { recursive: true })
      await writeFile(
        path.join(pluginRoot, 'package.json'),
        JSON.stringify(
          {
            name: '@oneworks/plugin-relay',
            version: '1.0.0',
            exports: {
              '.': './dist/index.js',
              './config': './dist/config.js',
              './package.json': './package.json'
            }
          },
          null,
          2
        )
      )
      await writeFile(
        path.join(pluginRoot, 'dist', 'index.js'),
        'module.exports = { __oneWorksPluginManifest: true }\n'
      )
      await writeFile(
        path.join(pluginRoot, 'dist', 'config.js'),
        `
module.exports = async (ctx) => {
  const serviceKey = ctx.plugin.options.serviceKey || 'relay'
  return {
    extend: './ignored-by-loader.json',
    defaultModelService: serviceKey,
    modelServices: {
      [serviceKey]: {
        title: 'Relay assigned service',
        apiBaseUrl: ctx.jsonVariables.RELAY_BASE_URL,
        apiKey: ctx.jsonVariables.RELAY_API_KEY,
        models: ['relay-model']
      }
    },
    permissions: {
      allow: ['RelayTool']
    }
  }
}
`
      )
      await writeFile(
        path.join(tempDir, '.oo.config.json'),
        JSON.stringify(
          {
            plugins: [
              {
                id: '@oneworks/plugin-relay',
                options: {
                  serviceKey: 'relay-team'
                }
              }
            ]
          },
          null,
          2
        )
      )
      await writeFile(
        path.join(tempDir, '.oo.dev.config.json'),
        JSON.stringify(
          {
            defaultModelService: 'local-service'
          },
          null,
          2
        )
      )

      resetConfigCache()
      const state = await loadConfigState({
        cwd: tempDir,
        env: {
          __ONEWORKS_PROJECT_DISABLE_GLOBAL_CONFIG__: '1'
        },
        jsonVariables: {
          RELAY_API_KEY: 'relay-secret',
          RELAY_BASE_URL: 'https://relay.example.com/v1'
        }
      })

      expect(state.projectConfig?.plugins).toEqual([
        {
          id: '@oneworks/plugin-relay',
          options: {
            serviceKey: 'relay-team'
          }
        }
      ])
      expect(state.userConfig?.defaultModelService).toBe('relay-team')
      expect(state.userConfig?.modelServices?.['relay-team']).toEqual({
        title: 'Relay assigned service',
        apiBaseUrl: 'https://relay.example.com/v1',
        apiKey: 'relay-secret',
        models: ['relay-model']
      })
      expect(state.userConfig?.extend).toBeUndefined()
      expect(state.userSource?.resolvedConfig?.defaultModelService).toBe('local-service')
      expect(state.mergedConfig.defaultModelService).toBe('relay-team')
      expect(state.mergedConfig.permissions?.allow).toEqual(['OneWorks', 'RelayTool'])
    } finally {
      resetConfigCache()
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('loads ESM-only plugin config hooks through dynamic import fallback', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-plugin-hook-esm-'))

    try {
      const pluginRoot = path.join(tempDir, 'node_modules', '@oneworks', 'plugin-esm-relay')
      await mkdir(path.join(pluginRoot, 'dist'), { recursive: true })
      await writeFile(
        path.join(pluginRoot, 'package.json'),
        JSON.stringify(
          {
            name: '@oneworks/plugin-esm-relay',
            version: '1.0.0',
            __oneWorksPluginManifest: true,
            configHook: {
              entry: './dist/config.mjs'
            },
            exports: {
              '.': './package.json',
              './package.json': './package.json'
            }
          },
          null,
          2
        )
      )
      await writeFile(
        path.join(pluginRoot, 'dist', 'config.mjs'),
        `
export default async (ctx) => {
  const serviceKey = ctx.plugin.options.serviceKey || 'esm-relay'
  return {
    defaultModelService: serviceKey,
    modelServices: {
      [serviceKey]: {
        apiBaseUrl: ctx.jsonVariables.RELAY_BASE_URL,
        apiKey: ctx.jsonVariables.RELAY_API_KEY
      }
    }
  }
}
`
      )
      await writeFile(
        path.join(tempDir, '.oo.config.json'),
        JSON.stringify(
          {
            plugins: [
              {
                id: '@oneworks/plugin-esm-relay',
                options: {
                  serviceKey: 'esm-team'
                }
              }
            ]
          },
          null,
          2
        )
      )

      resetConfigCache()
      const state = await loadConfigState({
        cwd: tempDir,
        disableGlobalConfig: true,
        jsonVariables: {
          RELAY_API_KEY: 'esm-secret',
          RELAY_BASE_URL: 'https://relay.example.com/v1'
        }
      })

      expect(state.userConfig?.defaultModelService).toBe('esm-team')
      expect(state.userConfig?.modelServices?.['esm-team']).toEqual({
        apiBaseUrl: 'https://relay.example.com/v1',
        apiKey: 'esm-secret'
      })
      expect(state.mergedConfig.defaultModelService).toBe('esm-team')
    } finally {
      resetConfigCache()
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('returns an empty project config when extend chain is circular', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-extend-cycle-'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await writeFile(
        path.join(tempDir, 'base.json'),
        JSON.stringify(
          {
            extend: './child.json',
            defaultModel: 'base'
          },
          null,
          2
        )
      )
      await writeFile(
        path.join(tempDir, 'child.json'),
        JSON.stringify(
          {
            extend: './base.json',
            defaultModel: 'child'
          },
          null,
          2
        )
      )
      await writeFile(
        path.join(tempDir, '.oo.config.json'),
        JSON.stringify(
          {
            extend: './base.json',
            defaultModel: 'project'
          },
          null,
          2
        )
      )

      resetConfigCache()
      const [projectConfig, userConfig] = await loadConfig({
        cwd: tempDir,
        jsonVariables: {}
      })

      expect(projectConfig).toBeUndefined()
      expect(userConfig).toBeUndefined()
      expect(errorSpy).toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
      resetConfigCache()
      await rm(tempDir, { force: true, recursive: true })
    }
  })

  it('builds resolved config state and adapter entries from merged config semantics', () => {
    const state = buildResolvedConfigState(
      {
        defaultModelService: 'project-service',
        adapters: {
          codex: {
            defaultModel: 'project-model',
            includeModels: ['project-include']
          }
        }
      } as any,
      {
        defaultModelService: 'user-service',
        adapters: {
          codex: {
            excludeModels: ['user-exclude']
          }
        }
      } as any
    )

    expect(state.mergedConfig.defaultModelService).toBe('user-service')
    expect(state.effectiveProjectConfig?.defaultModelService).toBe('project-service')
    expect(state.projectConfig).toBe(state.effectiveProjectConfig)
    expect(resolveAdapterConfigEntry('codex', state.mergedConfig)).toEqual({
      defaultModel: 'project-model',
      includeModels: ['project-include'],
      excludeModels: ['user-exclude']
    })
  })

  it('splits adapter config into common and native sections while allowing extra common keys', () => {
    const result = splitAdapterConfigEntry({
      packageId: '@oneworks/adapter-codex',
      defaultModel: 'gpt-5.4',
      includeModels: ['gpt-5.4'],
      excludeModels: ['gpt-4.1'],
      defaultAccount: 'work',
      accounts: {
        work: {
          apiKey: 'secret'
        }
      },
      effort: 'high',
      routingProfile: 'strict',
      settingsContent: {
        nested: true
      },
      model: 'legacy-model'
    } as {
      packageId?: string
      defaultModel?: string
      includeModels?: string[]
      excludeModels?: string[]
      defaultAccount?: string
      accounts?: Record<string, unknown>
      effort?: string
      routingProfile?: string
      settingsContent?: Record<string, unknown>
      model?: string
    }, {
      extraCommonKeys: ['effort', 'routingProfile']
    })

    expect(ADAPTER_COMMON_CONFIG_KEYS).toEqual([
      'packageId',
      'defaultModel',
      'includeModels',
      'excludeModels',
      'defaultAccount',
      'accounts'
    ])
    expect(result.common).toEqual({
      packageId: '@oneworks/adapter-codex',
      defaultModel: 'gpt-5.4',
      includeModels: ['gpt-5.4'],
      excludeModels: ['gpt-4.1'],
      defaultAccount: 'work',
      accounts: {
        work: {
          apiKey: 'secret'
        }
      },
      effort: 'high',
      routingProfile: 'strict',
      model: 'legacy-model'
    })
    expect(result.native).toEqual({
      settingsContent: {
        nested: true
      }
    })
  })

  it('resolves adapter common config from merged config state when extra common keys are declared', () => {
    const state = buildResolvedConfigState(
      {
        adapters: {
          codex: {
            defaultModel: 'project-model',
            includeModels: ['project-include']
          }
        }
      } as any,
      {
        adapters: {
          codex: {
            excludeModels: ['user-exclude'],
            effort: 'high',
            configOverrides: {
              model: 'gpt-5.4'
            }
          }
        }
      } as any
    )

    expect(resolveAdapterCommonConfig<{
      defaultModel?: string
      includeModels?: string[]
      excludeModels?: string[]
      effort?: string
    }, 'effort'>('codex', {
      configState: state
    }, {
      extraCommonKeys: ['effort']
    })).toEqual({
      defaultModel: 'project-model',
      includeModels: ['project-include'],
      excludeModels: ['user-exclude'],
      effort: 'high'
    })
  })

  it('reuses a precomputed resolved config state when available', () => {
    const state = buildResolvedConfigState(
      {
        defaultModel: 'project-model'
      } as any,
      {
        defaultModel: 'user-model'
      } as any
    )

    expect(resolveConfigState({
      configState: state,
      configs: [
        {
          defaultModel: 'stale-project-model'
        } as any,
        undefined
      ]
    })).toBe(state)
  })

  it('resolves adapter config sections from the merged config state', () => {
    const state = buildResolvedConfigState(
      {
        adapters: {
          'claude-code': {
            defaultModel: 'project-model',
            effort: 'medium',
            settingsContent: {
              permissionMode: 'plan'
            }
          }
        }
      } as any,
      {
        adapters: {
          'claude-code': {
            effort: 'high'
          }
        }
      } as any
    )

    const result = resolveAdapterConfig<{
      defaultModel?: string
      effort?: string
      settingsContent?: Record<string, unknown>
    }, 'effort'>('claude-code', {
      configState: state
    }, {
      extraCommonKeys: ['effort']
    })

    expect(result.common).toEqual({
      defaultModel: 'project-model',
      effort: 'high'
    })
    expect(result.native).toEqual({
      settingsContent: {
        permissionMode: 'plan'
      }
    })
  })

  it('deep merges declared native adapter config keys across project and user configs', () => {
    const state = buildResolvedConfigState(
      {
        adapters: {
          'claude-code': {
            settingsContent: {
              outputStyle: {
                tone: 'concise',
                bullets: true
              }
            },
            ccrOptions: {
              PORT: '4123'
            }
          }
        }
      } as any,
      {
        adapters: {
          'claude-code': {
            settingsContent: {
              outputStyle: {
                bullets: false
              },
              approvals: {
                mode: 'plan'
              }
            },
            ccrOptions: {
              APIKEY: 'router-key'
            }
          }
        }
      } as any
    )

    const result = resolveAdapterConfig<{
      settingsContent?: Record<string, unknown>
      ccrOptions?: Record<string, unknown>
    }>('claude-code', {
      configState: state
    }, {
      deepMergeKeys: ['settingsContent', 'ccrOptions']
    })

    expect(result.native).toEqual({
      settingsContent: {
        outputStyle: {
          tone: 'concise',
          bullets: false
        },
        approvals: {
          mode: 'plan'
        }
      },
      ccrOptions: {
        PORT: '4123',
        APIKEY: 'router-key'
      }
    })
  })

  it('reuses contribution metadata when resolving adapter config', () => {
    const state = buildResolvedConfigState(
      {
        adapters: {
          'claude-code': {
            defaultModel: 'project-model',
            effort: 'medium',
            settingsContent: {
              outputStyle: {
                tone: 'concise',
                bullets: true
              }
            }
          }
        }
      } as any,
      {
        adapters: {
          'claude-code': {
            effort: 'high',
            settingsContent: {
              outputStyle: {
                bullets: false
              },
              approvals: {
                mode: 'plan'
              }
            }
          }
        }
      } as any
    )

    const result = resolveAdapterConfigWithContribution<{
      defaultModel?: string
      effort?: string
      settingsContent?: Record<string, unknown>
    }, 'effort'>({
      adapterKey: 'claude-code',
      configEntry: {
        extraCommonKeys: ['effort'],
        deepMergeKeys: ['settingsContent']
      }
    }, {
      configState: state
    })

    expect(result.common).toEqual({
      defaultModel: 'project-model',
      effort: 'high'
    })
    expect(result.native).toEqual({
      settingsContent: {
        outputStyle: {
          tone: 'concise',
          bullets: false
        },
        approvals: {
          mode: 'plan'
        }
      }
    })
  })

  it('loads adapter config through the resolved config helper path', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ow-config-adapter-load-'))

    try {
      await writeFile(
        path.join(tempDir, '.oo.config.json'),
        JSON.stringify({
          adapters: {
            codex: {
              defaultModel: 'project-model'
            }
          }
        })
      )
      await writeFile(
        path.join(tempDir, '.oo.dev.config.json'),
        JSON.stringify({
          adapters: {
            codex: {
              excludeModels: ['user-exclude']
            }
          }
        })
      )

      resetConfigCache()
      const config = await loadAdapterConfig('codex', {
        cwd: tempDir,
        jsonVariables: {}
      })

      expect(config).toEqual({
        defaultModel: 'project-model',
        excludeModels: ['user-exclude']
      })
    } finally {
      resetConfigCache()
      await rm(tempDir, { force: true, recursive: true })
    }
  })
})
