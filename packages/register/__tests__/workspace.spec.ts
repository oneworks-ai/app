import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

describe('workspace root resolver', () => {
  const restoreKeys = [
    'GIT_DIR',
    'GIT_WORK_TREE',
    '__ONEWORKS_PROJECT_BASE_DIR__',
    '__ONEWORKS_PROJECT_WORKSPACE_FOLDER__'
  ] as const
  const restoreValues = new Map<string, string | undefined>()

  afterEach(() => {
    for (const key of restoreKeys) {
      const previousValue = restoreValues.get(key)
      if (previousValue == null) {
        delete process.env[key]
      } else {
        process.env[key] = previousValue
      }
    }
    restoreValues.clear()
  })

  it('finds the nearest configured workspace root instead of stopping at a nested package', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-workspace-root-'))
    const nestedDir = path.join(workspaceRoot, 'packages', 'demo', 'src')
    const realWorkspaceRoot = await realpath(workspaceRoot)

    for (const key of restoreKeys) {
      restoreValues.set(key, process.env[key])
    }

    try {
      await mkdir(path.join(workspaceRoot, '.oo'), { recursive: true })
      await mkdir(nestedDir, { recursive: true })
      await writeFile(path.join(workspaceRoot, 'package.json'), '{"name":"root"}\n')
      await writeFile(path.join(workspaceRoot, 'packages', 'demo', 'package.json'), '{"name":"demo"}\n')

      const modulePath = require.resolve('../workspace.js')
      delete require.cache[modulePath]
      const { findWorkspaceRoot } = require(modulePath) as {
        findWorkspaceRoot: (startDir?: string) => string
      }

      expect(findWorkspaceRoot(nestedDir)).toBe(realWorkspaceRoot)
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true })
    }
  })

  it('falls back to the git root when no workspace markers are present', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-workspace-git-'))
    const nestedDir = path.join(workspaceRoot, 'packages', 'demo', 'src')
    const realWorkspaceRoot = await realpath(workspaceRoot)

    for (const key of restoreKeys) {
      restoreValues.set(key, process.env[key])
    }

    try {
      await mkdir(nestedDir, { recursive: true })
      await writeFile(path.join(workspaceRoot, 'package.json'), '{"name":"root"}\n')
      await writeFile(path.join(workspaceRoot, 'packages', 'demo', 'package.json'), '{"name":"demo"}\n')

      const initResult = spawnSync('git', ['init'], {
        cwd: workspaceRoot,
        encoding: 'utf8'
      })
      expect(initResult.status).toBe(0)

      const modulePath = require.resolve('../workspace.js')
      delete require.cache[modulePath]
      const { findWorkspaceRoot } = require(modulePath) as {
        findWorkspaceRoot: (startDir?: string) => string
      }

      expect(findWorkspaceRoot(nestedDir)).toBe(realWorkspaceRoot)
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true })
    }
  })

  it('preserves a whitespace-ending root returned by real Git discovery', async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-workspace-git-raw-'))
    const workspaceRoot = path.join(fixtureRoot, 'repository ')
    const adjacentRoot = path.join(fixtureRoot, 'repository')
    const nestedDir = path.join(workspaceRoot, 'src')
    const gitDir = path.join(fixtureRoot, 'repository.git')
    for (const key of restoreKeys) restoreValues.set(key, process.env[key])

    try {
      await mkdir(nestedDir, { recursive: true })
      await mkdir(adjacentRoot)
      expect(spawnSync('git', ['init', '--bare', gitDir], { encoding: 'utf8' }).status).toBe(0)
      process.env.GIT_DIR = gitDir
      process.env.GIT_WORK_TREE = workspaceRoot
      const gitRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: nestedDir,
        encoding: 'utf8'
      })
      expect(gitRoot.stdout).toBe(`${await realpath(workspaceRoot)}\n`)

      const modulePath = require.resolve('../workspace.js')
      delete require.cache[modulePath]
      const { findWorkspaceRoot } = require(modulePath) as {
        findWorkspaceRoot: (startDir?: string) => string
      }

      expect(findWorkspaceRoot(nestedDir)).toBe(await realpath(workspaceRoot))
      expect(findWorkspaceRoot(nestedDir)).not.toBe(await realpath(adjacentRoot))
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true })
    }
  })

  it.runIf(process.platform !== 'win32')(
    'preserves a terminal carriage return before the Git line delimiter',
    async () => {
      const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-workspace-git-eol-'))
      const workspaceRoot = path.join(fixtureRoot, 'repository\r')
      const adjacentRoot = path.join(fixtureRoot, 'repository')
      const nestedDir = path.join(workspaceRoot, 'src')
      const gitDir = path.join(fixtureRoot, 'repository.git')
      for (const key of restoreKeys) restoreValues.set(key, process.env[key])

      try {
        await mkdir(nestedDir, { recursive: true })
        await mkdir(adjacentRoot)
        expect(spawnSync('git', ['init', '--bare', gitDir], { encoding: 'utf8' }).status).toBe(0)
        process.env.GIT_DIR = gitDir
        process.env.GIT_WORK_TREE = workspaceRoot

        const modulePath = require.resolve('../workspace.js')
        delete require.cache[modulePath]
        const { findWorkspaceRoot } = require(modulePath) as {
          findWorkspaceRoot: (startDir?: string) => string
        }

        expect(findWorkspaceRoot(nestedDir)).toBe(await realpath(workspaceRoot))
        expect(findWorkspaceRoot(nestedDir)).not.toBe(await realpath(adjacentRoot))
      } finally {
        await rm(fixtureRoot, { force: true, recursive: true })
      }
    }
  )

  it('respects an explicit workspace folder override', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-workspace-explicit-'))
    const nestedDir = path.join(workspaceRoot, 'src', 'nested')
    const realNestedDir = await realpath(path.join(workspaceRoot))

    for (const key of restoreKeys) {
      restoreValues.set(key, process.env[key])
    }

    try {
      await mkdir(nestedDir, { recursive: true })
      process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = nestedDir

      const modulePath = require.resolve('../workspace.js')
      delete require.cache[modulePath]
      const { resolveWorkspaceFolder } = require(modulePath) as {
        resolveWorkspaceFolder: (startDir?: string) => string
      }

      expect(resolveWorkspaceFolder(workspaceRoot)).toBe(path.join(realNestedDir, 'src', 'nested'))
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true })
    }
  })

  it('preserves leading and trailing whitespace in an explicit workspace folder override', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-workspace-explicit-raw-'))
    const explicitWorkspaceFolder = path.join(workspaceRoot, ' workspace ')

    for (const key of restoreKeys) {
      restoreValues.set(key, process.env[key])
    }

    try {
      await mkdir(explicitWorkspaceFolder)
      process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = explicitWorkspaceFolder

      const modulePath = require.resolve('../workspace.js')
      delete require.cache[modulePath]
      const { resolveWorkspaceFolder } = require(modulePath) as {
        resolveWorkspaceFolder: (startDir?: string) => string
      }

      expect(resolveWorkspaceFolder(workspaceRoot)).toBe(await realpath(explicitWorkspaceFolder))
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true })
    }
  })

  it('uses a whitespace-bearing base-dir marker consistently during mandatory preload', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'ow-workspace-base-marker-'))
    const nestedDir = path.join(workspaceRoot, 'packages', 'demo')
    const baseDirName = ' .oo '
    const baseDir = path.join(workspaceRoot, baseDirName)

    for (const key of restoreKeys) {
      restoreValues.set(key, process.env[key])
      delete process.env[key]
    }

    try {
      await mkdir(baseDir)
      await mkdir(nestedDir, { recursive: true })
      process.env.__ONEWORKS_PROJECT_BASE_DIR__ = baseDirName

      const workspaceModulePath = require.resolve('../workspace.js')
      const dotenvModulePath = require.resolve('../dotenv.js')
      delete require.cache[workspaceModulePath]
      delete require.cache[dotenvModulePath]
      const { findWorkspaceRoot } = require(workspaceModulePath) as {
        findWorkspaceRoot: (startDir?: string) => string
      }
      const {
        loadDotenv,
        resolveProjectOoBaseDir
      } = require(dotenvModulePath) as {
        loadDotenv: (options?: { workspaceFolder?: string; files?: string[] }) => void
        resolveProjectOoBaseDir: (cwd?: string, env?: NodeJS.ProcessEnv) => string
      }

      expect(findWorkspaceRoot(nestedDir)).toBe(await realpath(workspaceRoot))

      loadDotenv({ workspaceFolder: workspaceRoot, files: [] })

      expect(process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__).toBe(await realpath(workspaceRoot))
      expect(resolveProjectOoBaseDir(workspaceRoot, process.env)).toBe(path.resolve(baseDir))
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true })
    }
  })

  it('discovers the exact whitespace-bearing primary workspace from Git common-dir output', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ow-dotenv-git-common-'))
    const primaryDir = path.join(root, 'primary ')
    const adjacentPrimaryDir = path.join(root, 'primary')
    const worktreeDir = path.join(root, 'worktree')

    try {
      await mkdir(adjacentPrimaryDir)
      expect(spawnSync('git', ['init', primaryDir], { encoding: 'utf8' }).status).toBe(0)
      expect(
        spawnSync('git', ['config', 'user.email', 'ow@example.com'], {
          cwd: primaryDir,
          encoding: 'utf8'
        }).status
      ).toBe(0)
      expect(
        spawnSync('git', ['config', 'user.name', 'One Works'], {
          cwd: primaryDir,
          encoding: 'utf8'
        }).status
      ).toBe(0)
      await writeFile(path.join(primaryDir, 'README.md'), '# primary\n')
      expect(spawnSync('git', ['add', 'README.md'], { cwd: primaryDir, encoding: 'utf8' }).status).toBe(0)
      expect(spawnSync('git', ['commit', '-m', 'init'], { cwd: primaryDir, encoding: 'utf8' }).status).toBe(0)
      expect(
        spawnSync('git', ['worktree', 'add', '-b', 'feature', worktreeDir], {
          cwd: primaryDir,
          encoding: 'utf8'
        }).status
      ).toBe(0)

      const modulePath = require.resolve('../dotenv.js')
      delete require.cache[modulePath]
      const { resolvePrimaryWorkspaceFolder } = require(modulePath) as {
        resolvePrimaryWorkspaceFolder: (workspaceFolder: string, env?: NodeJS.ProcessEnv) => string | undefined
      }
      expect(resolvePrimaryWorkspaceFolder(worktreeDir, {})).toBe(await realpath(primaryDir))
      expect(resolvePrimaryWorkspaceFolder(worktreeDir, {})).not.toBe(await realpath(adjacentPrimaryDir))
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  it('preserves filesystem roots while removing only optional trailing separators', () => {
    const helperModulePath = require.resolve('../filesystem-path.js')
    delete require.cache[helperModulePath]
    const { normalizeFilesystemDirPath, readFilesystemPathOutput } = require(helperModulePath) as {
      normalizeFilesystemDirPath: (value?: string) => string | undefined
      readFilesystemPathOutput: (value?: string) => string | undefined
    }

    expect(normalizeFilesystemDirPath('/')).toBe('/')
    expect(normalizeFilesystemDirPath('\\')).toBe('\\')
    expect(normalizeFilesystemDirPath('C:\\')).toBe('C:\\')
    expect(normalizeFilesystemDirPath('C:\\workspace\\\\')).toBe('C:\\workspace')
    expect(normalizeFilesystemDirPath('\\\\server\\share\\')).toBe('\\\\server\\share\\')
    expect(normalizeFilesystemDirPath('\\\\foo\\\\')).toBe(process.platform === 'win32' ? '\\\\foo' : '\\\\foo\\\\')
    expect(readFilesystemPathOutput('/repository\n\n')).toBe('/repository\n')
    expect(readFilesystemPathOutput('/repository\r\n')).toBe(
      process.platform === 'win32' ? '/repository' : '/repository\r'
    )
    expect(readFilesystemPathOutput('/repository\r')).toBe('/repository\r')
  })

  it('keeps the native root absolute through the mandatory dotenv workspace resolver', () => {
    const nativeRoot = path.parse(process.cwd()).root
    const modulePath = require.resolve('../dotenv.js')
    delete require.cache[modulePath]
    const { resolveProjectWorkspaceFolder } = require(modulePath) as {
      resolveProjectWorkspaceFolder: (cwd?: string, env?: NodeJS.ProcessEnv) => string
    }

    expect(resolveProjectWorkspaceFolder(process.cwd(), {
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: nativeRoot
    })).toBe(path.resolve(nativeRoot))
  })
})
