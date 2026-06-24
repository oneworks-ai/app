import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  MAX_RECENT_WORKSPACES,
  getRecentWorkspaceFoldersFromState,
  getWorkspaceDescription,
  getWorkspaceDisplayName,
  getWorkspaceStorageKey,
  normalizeWorkspaceFolder,
  rememberRecentWorkspaceFolder,
  removeRecentWorkspaceFolder,
  resolveProjectWorkspaceFolder,
  resolveDesktopLaunchWorkspaceFolder
} = require('../src/workspace-state.cjs') as typeof import('../src/workspace-state.cjs')

const createdDirectories = []
const hasGit = () => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const itWithGit = hasGit() ? it : it.skip

const createWorkspace = (name) => {
  const workspaceFolder = fs.mkdtempSync(path.join(os.tmpdir(), `oneworks-desktop-${name}-`))
  createdDirectories.push(workspaceFolder)
  return workspaceFolder
}

afterEach(() => {
  for (const workspaceFolder of createdDirectories.splice(0, createdDirectories.length)) {
    fs.rmSync(workspaceFolder, { recursive: true, force: true })
  }
})

describe('workspace-state helpers', () => {
  it('normalizes workspace folders to real paths', () => {
    const workspaceFolder = createWorkspace('realpath')
    const aliasFolder = `${workspaceFolder}-link`
    fs.symlinkSync(workspaceFolder, aliasFolder)
    createdDirectories.push(aliasFolder)

    expect(normalizeWorkspaceFolder(aliasFolder)).toBe(fs.realpathSync.native(workspaceFolder))
  })

  itWithGit('preserves linked git worktrees as distinct workspaces', () => {
    const projectFolder = createWorkspace('git-project')
    fs.writeFileSync(path.join(projectFolder, 'README.md'), 'test\n')
    execFileSync('git', ['-C', projectFolder, 'init'], { stdio: 'ignore' })
    execFileSync('git', ['-C', projectFolder, 'add', 'README.md'], { stdio: 'ignore' })
    execFileSync(
      'git',
      [
        '-C',
        projectFolder,
        '-c',
        'user.name=One Works',
        '-c',
        'user.email=oneworks@example.test',
        'commit',
        '-m',
        'init'
      ],
      { stdio: 'ignore' }
    )
    const worktreeParent = createWorkspace('git-worktree-parent')
    const linkedWorktree = path.join(worktreeParent, 'linked')
    execFileSync(
      'git',
      ['-C', projectFolder, 'worktree', 'add', linkedWorktree, '-b', `linked-${Date.now()}`],
      { stdio: 'ignore' }
    )
    const realProjectFolder = fs.realpathSync.native(projectFolder)
    const realLinkedWorktree = fs.realpathSync.native(linkedWorktree)

    expect(resolveProjectWorkspaceFolder(linkedWorktree)).toBe(realLinkedWorktree)
    expect(rememberRecentWorkspaceFolder([linkedWorktree], projectFolder)).toEqual([
      realProjectFolder,
      realLinkedWorktree
    ])
  })

  it('dedupes recent workspaces and migrates the legacy workspace field', () => {
    const firstWorkspace = createWorkspace('first')
    const secondWorkspace = createWorkspace('second')

    expect(getRecentWorkspaceFoldersFromState({
      recentWorkspaces: [firstWorkspace, secondWorkspace, firstWorkspace],
      workspaceFolder: secondWorkspace
    })).toEqual([
      fs.realpathSync.native(firstWorkspace),
      fs.realpathSync.native(secondWorkspace)
    ])
  })

  it('keeps recent workspaces newest-first with a stable cap', () => {
    const workspaces = Array.from(
      { length: MAX_RECENT_WORKSPACES + 2 },
      (_, index) => createWorkspace(`recent-${index}`)
    )
    const remembered = workspaces.reduce(
      (recentWorkspaces, workspaceFolder) => rememberRecentWorkspaceFolder(recentWorkspaces, workspaceFolder),
      []
    )

    expect(remembered).toHaveLength(MAX_RECENT_WORKSPACES)
    expect(remembered[0]).toBe(fs.realpathSync.native(workspaces.at(-1)))
    expect(remembered.at(-1)).toBe(fs.realpathSync.native(workspaces[2]))
  })

  it('removes recent workspaces without mutating the other entries', () => {
    const firstWorkspace = createWorkspace('remove-first')
    const secondWorkspace = createWorkspace('remove-second')

    expect(removeRecentWorkspaceFolder(
      [firstWorkspace, secondWorkspace],
      firstWorkspace
    )).toEqual([fs.realpathSync.native(secondWorkspace)])
  })

  it('resolves env workspaces before the development fallback', () => {
    const envWorkspace = createWorkspace('env')
    const repoRoot = createWorkspace('repo')

    expect(resolveDesktopLaunchWorkspaceFolder({
      env: {
        ONEWORKS_DESKTOP_WORKSPACE: envWorkspace,
        INIT_CWD: repoRoot
      },
      isDev: true,
      repoRoot
    })).toBe(fs.realpathSync.native(envWorkspace))
  })

  it('supports an explicit empty desktop launch mode', () => {
    const envWorkspace = createWorkspace('env-empty')
    const repoRoot = createWorkspace('repo-empty')

    expect(resolveDesktopLaunchWorkspaceFolder({
      env: {
        ONEWORKS_DESKTOP_LAUNCH_MODE: 'empty',
        ONEWORKS_DESKTOP_WORKSPACE: envWorkspace,
        INIT_CWD: repoRoot
      },
      isDev: true,
      repoRoot
    })).toBeUndefined()
  })

  it('does not infer a desktop launch workspace from project env or development cwd', () => {
    const envWorkspace = createWorkspace('project-env')
    const repoRoot = createWorkspace('dev-root')

    expect(resolveDesktopLaunchWorkspaceFolder({
      env: {
        __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: envWorkspace,
        INIT_CWD: repoRoot
      },
      isDev: false,
      repoRoot
    })).toBeUndefined()
    expect(resolveDesktopLaunchWorkspaceFolder({
      env: {
        __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: envWorkspace,
        INIT_CWD: repoRoot
      },
      isDev: true,
      repoRoot
    })).toBeUndefined()
  })

  it('derives display metadata from the workspace path', () => {
    const workspaceFolder = createWorkspace('display-name')
    const expectedStorageLabel = path.basename(workspaceFolder)
      .replace(/[^a-z0-9]+/gi, '-')
      .toLowerCase()
      .replace(/^-+|-+$/g, '')

    expect(getWorkspaceDisplayName(workspaceFolder)).toBe(path.basename(workspaceFolder))
    expect(getWorkspaceDescription(workspaceFolder)).toBe(workspaceFolder)
    expect(getWorkspaceStorageKey(workspaceFolder)).toContain(expectedStorageLabel)
  })
})
