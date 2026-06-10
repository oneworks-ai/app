import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

describe('loadDotenv', () => {
  const restoreKeys = ['TEST_PRIMARY_ONLY', 'TEST_SHARED_VALUE', 'TEST_CONFIG_ONLY']
  const restoreEnv = new Map<string, string | undefined>()
  const restoreScopedEnv = [
    '__ONEWORKS_PROJECT_LAUNCH_CWD__',
    '__ONEWORKS_PROJECT_WORKSPACE_FOLDER__',
    '__ONEWORKS_PROJECT_CONFIG_DIR__',
    '__ONEWORKS_PROJECT_BASE_DIR__',
    '__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__',
    '__ONEWORKS_PROJECT_HOME_PROJECT_DIR__',
    '__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__',
    '__ONEWORKS_PROJECT_CONFIG_DIR_RESOLVE_CWD__',
    '__ONEWORKS_PROJECT_BASE_DIR_RESOLVE_CWD__',
    '__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__',
    '__ONEWORKS_PROJECT_DOTENV_FILES__',
    '__ONEWORKS_PROJECT_PACKAGE_DIR__'
  ] as const
  const restoreScopedValues = new Map<string, string | undefined>()

  afterEach(() => {
    for (const key of restoreKeys) {
      const previousValue = restoreEnv.get(key)
      if (previousValue == null) {
        delete process.env[key]
      } else {
        process.env[key] = previousValue
      }
    }
    restoreEnv.clear()

    for (const key of restoreScopedEnv) {
      const previousValue = restoreScopedValues.get(key)
      if (previousValue == null) {
        delete process.env[key]
      } else {
        process.env[key] = previousValue
      }
    }
    restoreScopedValues.clear()
  })

  it('falls back to the primary workspace env file when the current worktree has none', async () => {
    const primaryDir = await mkdtemp(path.join(os.tmpdir(), 'ow-dotenv-primary-'))
    const worktreeDir = await mkdtemp(path.join(os.tmpdir(), 'ow-dotenv-worktree-'))

    for (const key of restoreKeys) {
      restoreEnv.set(key, process.env[key])
      delete process.env[key]
    }
    for (const key of restoreScopedEnv) {
      restoreScopedValues.set(key, process.env[key])
    }

    try {
      await writeFile(
        path.join(primaryDir, '.env'),
        'TEST_PRIMARY_ONLY=primary-value\nTEST_SHARED_VALUE=primary-shared\n'
      )
      await writeFile(
        path.join(worktreeDir, '.env'),
        'TEST_SHARED_VALUE=worktree-shared\n'
      )

      process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = worktreeDir
      process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ = primaryDir
      delete process.env.__ONEWORKS_PROJECT_PACKAGE_DIR__

      const modulePath = require.resolve('../dotenv.js')
      delete require.cache[modulePath]
      const { loadDotenv } = require(modulePath) as {
        loadDotenv: (options?: { workspaceFolder?: string; files?: string[] }) => void
      }

      delete process.env.TEST_PRIMARY_ONLY
      delete process.env.TEST_SHARED_VALUE
      loadDotenv({ workspaceFolder: worktreeDir })

      expect(process.env.TEST_PRIMARY_ONLY).toBe('primary-value')
      expect(process.env.TEST_SHARED_VALUE).toBe('worktree-shared')
    } finally {
      await rm(primaryDir, { force: true, recursive: true })
      await rm(worktreeDir, { force: true, recursive: true })
    }
  })

  it('loads config-dir env files after launch-dir env sets workspace and config overrides', async () => {
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ow-dotenv-workspace-'))
    const launchDir = path.join(workspaceDir, 'c', 'd', 'e')
    const configDir = path.join(launchDir, '.iac', 'ai')
    const previousCwd = process.cwd()

    for (const key of restoreKeys) {
      restoreEnv.set(key, process.env[key])
      delete process.env[key]
    }
    for (const key of restoreScopedEnv) {
      restoreScopedValues.set(key, process.env[key])
    }

    try {
      await mkdir(configDir, { recursive: true })
      await writeFile(
        path.join(launchDir, '.env'),
        [
          '__ONEWORKS_PROJECT_WORKSPACE_FOLDER__=../../..',
          '__ONEWORKS_PROJECT_CONFIG_DIR__=.iac/ai'
        ].join('\n')
      )
      await writeFile(
        path.join(configDir, '.env.dev'),
        'TEST_CONFIG_ONLY=config-value\n'
      )

      process.chdir(launchDir)

      const modulePath = require.resolve('../dotenv.js')
      delete require.cache[modulePath]
      const {
        loadDotenv,
        resolveProjectWorkspaceFolder,
        resolveProjectConfigDir
      } = require(modulePath) as {
        loadDotenv: (options?: { workspaceFolder?: string; files?: string[] }) => void
        resolveProjectWorkspaceFolder: (cwd?: string, env?: NodeJS.ProcessEnv) => string
        resolveProjectConfigDir: (cwd?: string, env?: NodeJS.ProcessEnv) => string | undefined
      }

      delete process.env.TEST_CONFIG_ONLY
      loadDotenv()

      const realWorkspaceDir = await realpath(workspaceDir)
      const realConfigDir = await realpath(configDir)
      expect(process.env.TEST_CONFIG_ONLY).toBe('config-value')
      expect(resolveProjectWorkspaceFolder(process.cwd(), process.env)).toBe(realWorkspaceDir)
      expect(resolveProjectConfigDir(process.cwd(), process.env)).toBe(realConfigDir)
    } finally {
      process.chdir(previousCwd)
      await rm(workspaceDir, { force: true, recursive: true })
    }
  })

  it('loads env files from the detected workspace root when given a nested startup directory', async () => {
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ow-dotenv-root-'))
    const nestedDir = path.join(workspaceDir, 'packages', 'demo', 'src')

    for (const key of restoreKeys) {
      restoreEnv.set(key, process.env[key])
      delete process.env[key]
    }
    for (const key of restoreScopedEnv) {
      restoreScopedValues.set(key, process.env[key])
      delete process.env[key]
    }

    try {
      await mkdir(nestedDir, { recursive: true })
      await writeFile(path.join(workspaceDir, '.oo.config.json'), '{}\n')
      await writeFile(path.join(workspaceDir, '.env'), 'TEST_PRIMARY_ONLY=nested-root\nTEST_SHARED_VALUE=root\n')

      const modulePath = require.resolve('../dotenv.js')
      delete require.cache[modulePath]
      const {
        loadDotenv,
        resolveProjectWorkspaceFolder
      } = require(modulePath) as {
        loadDotenv: (options?: { workspaceFolder?: string; files?: string[] }) => void
        resolveProjectWorkspaceFolder: (cwd?: string, env?: NodeJS.ProcessEnv) => string
      }

      delete process.env.TEST_PRIMARY_ONLY
      delete process.env.TEST_SHARED_VALUE
      loadDotenv({ workspaceFolder: nestedDir })

      expect(process.env.TEST_PRIMARY_ONLY).toBe('nested-root')
      expect(process.env.TEST_SHARED_VALUE).toBe('root')
      expect(resolveProjectWorkspaceFolder(nestedDir, process.env)).toBe(await realpath(workspaceDir))
    } finally {
      await rm(workspaceDir, { force: true, recursive: true })
    }
  })

  it('resolves ai base dir relative to the env file that defines it', async () => {
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ow-dotenv-ai-base-'))
    const targetDir = path.join(workspaceDir, 'business_modules', 'Miniapp')
    const previousCwd = process.cwd()

    for (const key of restoreScopedEnv) {
      restoreScopedValues.set(key, process.env[key])
      delete process.env[key]
    }

    try {
      await mkdir(targetDir, { recursive: true })
      await writeFile(path.join(workspaceDir, '.oo.config.json'), '{}\n')
      await writeFile(
        path.join(targetDir, '.env'),
        [
          '__ONEWORKS_PROJECT_WORKSPACE_FOLDER__=../..',
          '__ONEWORKS_PROJECT_CONFIG_DIR__=.',
          '__ONEWORKS_PROJECT_BASE_DIR__=.iac/ai'
        ].join('\n')
      )
      const realWorkspaceDir = await realpath(workspaceDir)
      const realTargetDir = await realpath(targetDir)

      process.env.__ONEWORKS_PROJECT_CONFIG_DIR__ = 'business_modules/Miniapp'
      process.chdir(workspaceDir)

      const modulePath = require.resolve('../dotenv.js')
      delete require.cache[modulePath]
      const {
        loadDotenv,
        resolveProjectOoBaseDir,
        resolveProjectWorkspaceFolder
      } = require(modulePath) as {
        loadDotenv: (options?: { workspaceFolder?: string; files?: string[] }) => void
        resolveProjectOoBaseDir: (cwd?: string, env?: NodeJS.ProcessEnv) => string
        resolveProjectWorkspaceFolder: (cwd?: string, env?: NodeJS.ProcessEnv) => string
      }

      loadDotenv()

      expect(resolveProjectWorkspaceFolder(workspaceDir, process.env)).toBe(realWorkspaceDir)
      expect(resolveProjectOoBaseDir(workspaceDir, process.env)).toBe(path.join(realTargetDir, '.iac', 'ai'))
      expect(process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__).toBe(realTargetDir)
      expect(process.env.__ONEWORKS_PROJECT_BASE_DIR_RESOLVE_CWD__).toBe(realTargetDir)
    } finally {
      process.chdir(previousCwd)
      await rm(workspaceDir, { force: true, recursive: true })
    }
  })

  it('does not backfill legacy project-home segments from the bootstrap helper', async () => {
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ow-dotenv-migration-'))
    const realHome = await mkdtemp(path.join(os.tmpdir(), 'ow-dotenv-migration-home-'))

    try {
      const modulePath = require.resolve('../dotenv.js')
      delete require.cache[modulePath]
      const {
        migrateProjectHomeSegmentsSync,
        resolveProjectHomePath
      } = require(modulePath) as {
        migrateProjectHomeSegmentsSync: (
          cwd?: string,
          env?: NodeJS.ProcessEnv,
          segments?: readonly string[]
        ) => Array<{ migratedSources: string[]; targetDir: string }>
        resolveProjectHomePath: (cwd: string, env: NodeJS.ProcessEnv, ...segments: string[]) => string
      }

      const env = {
        ...process.env,
        HOME: realHome,
        __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: path.join(workspaceDir, '.oneworks-projects'),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      }
      const legacyMockHome = path.join(workspaceDir, '.oo', '.mock')
      const legacyCodexDir = path.join(legacyMockHome, '.codex')
      const homeMockHome = resolveProjectHomePath(workspaceDir, env, '.mock')

      await mkdir(legacyCodexDir, { recursive: true })
      await writeFile(path.join(legacyCodexDir, 'config.toml'), 'model = "legacy"\n')

      expect(migrateProjectHomeSegmentsSync(workspaceDir, env, ['.mock'])).toEqual([{
        migratedSources: [],
        targetDir: homeMockHome
      }])

      await expect(readFile(path.join(homeMockHome, '.codex', 'config.toml'), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT'
      })
    } finally {
      await rm(workspaceDir, { force: true, recursive: true })
      await rm(realHome, { force: true, recursive: true })
    }
  })

  it('does not backfill legacy default .oo segments when the project asset dir is reconfigured', async () => {
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ow-dotenv-migration-base-'))
    const realHome = await mkdtemp(path.join(os.tmpdir(), 'ow-dotenv-migration-base-home-'))

    try {
      const modulePath = require.resolve('../dotenv.js')
      delete require.cache[modulePath]
      const {
        migrateProjectHomeSegmentsSync,
        resolveProjectHomePath
      } = require(modulePath) as {
        migrateProjectHomeSegmentsSync: (
          cwd?: string,
          env?: NodeJS.ProcessEnv,
          segments?: readonly string[]
        ) => Array<{ migratedSources: string[]; targetDir: string }>
        resolveProjectHomePath: (cwd: string, env: NodeJS.ProcessEnv, ...segments: string[]) => string
      }

      const env = {
        HOME: realHome,
        __ONEWORKS_PROJECT_BASE_DIR__: '.oneworks',
        __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: path.join(workspaceDir, '.oneworks-projects'),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome,
        __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceDir
      } as NodeJS.ProcessEnv
      const legacyDefaultCacheRoot = path.join(workspaceDir, '.oo', 'caches')
      const configuredCacheRoot = path.join(workspaceDir, '.oneworks', 'caches')
      const homeCacheRoot = resolveProjectHomePath(workspaceDir, env, 'caches')

      await mkdir(legacyDefaultCacheRoot, { recursive: true })
      await mkdir(configuredCacheRoot, { recursive: true })
      await writeFile(path.join(legacyDefaultCacheRoot, 'default-ai.json'), '{"legacy":true}\n')
      await writeFile(path.join(configuredCacheRoot, 'configured-ai.json'), '{"configured":true}\n')

      expect(migrateProjectHomeSegmentsSync(workspaceDir, env, ['caches'])).toEqual([{
        migratedSources: [],
        targetDir: homeCacheRoot
      }])

      await expect(readFile(path.join(homeCacheRoot, 'default-ai.json'), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT'
      })
      await expect(readFile(path.join(homeCacheRoot, 'configured-ai.json'), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT'
      })
    } finally {
      await rm(workspaceDir, { force: true, recursive: true })
      await rm(realHome, { force: true, recursive: true })
    }
  })

  it('clears inherited exact project-home env when loading another workspace', async () => {
    const workspaceA = await mkdtemp(path.join(os.tmpdir(), 'ow-dotenv-workspace-a-'))
    const workspaceB = await mkdtemp(path.join(os.tmpdir(), 'ow-dotenv-workspace-b-'))
    const projectsDir = await mkdtemp(path.join(os.tmpdir(), 'ow-dotenv-home-projects-'))

    for (const key of restoreScopedEnv) {
      restoreScopedValues.set(key, process.env[key])
    }

    try {
      await mkdir(path.join(workspaceB, '.oo'), { recursive: true })

      const modulePath = require.resolve('../dotenv.js')
      delete require.cache[modulePath]
      const {
        loadDotenv,
        resolveProjectHomePath
      } = require(modulePath) as {
        loadDotenv: (options?: { workspaceFolder?: string; files?: string[] }) => void
        resolveProjectHomePath: (cwd: string, env: NodeJS.ProcessEnv, ...segments: string[]) => string
      }

      process.env.__ONEWORKS_PROJECT_LAUNCH_CWD__ = workspaceA
      process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspaceA
      process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__ = workspaceA
      process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__ = workspaceA
      process.env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__ = projectsDir
      process.env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__ = 'workspace-a-home'

      loadDotenv({ workspaceFolder: workspaceB, files: [] })

      expect(process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__).toBe(await realpath(workspaceB))
      expect(process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__).toBeUndefined()
      expect(process.env.__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__).toBeUndefined()
      expect(process.env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__).toBeUndefined()
      expect(resolveProjectHomePath(workspaceB, process.env)).not.toContain('workspace-a-home')
    } finally {
      await rm(workspaceA, { force: true, recursive: true })
      await rm(workspaceB, { force: true, recursive: true })
      await rm(projectsDir, { force: true, recursive: true })
    }
  })

  it('resolves relative primary workspace overrides from the launch cwd', async () => {
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ow-dotenv-primary-launch-'))
    const launchDir = path.join(workspaceDir, 'worktrees', 'feature')
    const primaryDir = path.join(workspaceDir, 'worktrees', 'main')
    const previousCwd = process.cwd()

    for (const key of restoreScopedEnv) {
      restoreScopedValues.set(key, process.env[key])
      delete process.env[key]
    }

    try {
      await mkdir(launchDir, { recursive: true })
      await mkdir(primaryDir, { recursive: true })
      await writeFile(
        path.join(launchDir, '.env'),
        '__ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__=../main\n'
      )
      process.chdir(launchDir)

      const modulePath = require.resolve('../dotenv.js')
      delete require.cache[modulePath]
      const {
        loadDotenv,
        resolvePrimaryWorkspaceFolder
      } = require(modulePath) as {
        loadDotenv: (options?: { workspaceFolder?: string; files?: string[] }) => void
        resolvePrimaryWorkspaceFolder: (workspaceFolder: string, env?: NodeJS.ProcessEnv) => string | undefined
      }

      loadDotenv({ workspaceFolder: launchDir })

      expect(resolvePrimaryWorkspaceFolder(launchDir, process.env)).toBe(primaryDir)
    } finally {
      process.chdir(previousCwd)
      await rm(workspaceDir, { force: true, recursive: true })
    }
  })

  it('keeps dot-dot-prefixed child paths classified inside the workspace', async () => {
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ow-dotenv-inside-'))
    const realHome = await mkdtemp(path.join(os.tmpdir(), 'ow-dotenv-inside-home-'))

    try {
      const modulePath = require.resolve('../dotenv.js')
      delete require.cache[modulePath]
      const {
        resolveProjectHomePath,
        resolveProjectMockHome
      } = require(modulePath) as {
        resolveProjectHomePath: (cwd: string, env: NodeJS.ProcessEnv, ...segments: string[]) => string
        resolveProjectMockHome: (cwd: string, env: NodeJS.ProcessEnv) => string
      }
      const env = {
        HOME: path.join(workspaceDir, '..cache-home'),
        __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: path.join(workspaceDir, '.oneworks-projects'),
        __ONEWORKS_PROJECT_REAL_HOME__: realHome
      } as NodeJS.ProcessEnv

      expect(resolveProjectMockHome(workspaceDir, env)).toBe(resolveProjectHomePath(workspaceDir, env, '.mock'))
    } finally {
      await rm(workspaceDir, { force: true, recursive: true })
      await rm(realHome, { force: true, recursive: true })
    }
  })
})
