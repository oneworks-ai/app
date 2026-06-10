import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveProjectHomePath, resolveProjectOoPath } from '#~/ai-path.js'
import {
  resolveProjectSharedCacheDir,
  resolveProjectSharedCachePath,
  resolveProjectSharedWorkspaceFolder
} from '#~/project-cache-path.js'

const tempDirs: string[] = []
const hasGit = spawnSync('git', ['--version']).status === 0

const createTempDir = async (prefix: string) => {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

const runGit = (cwd: string, args: string[]) => {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe'
  })
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('project shared cache path utils', () => {
  it('uses the explicit primary workspace for shared cache paths', async () => {
    const primary = await createTempDir('ow-cache-primary-')
    const worktree = await createTempDir('ow-cache-worktree-')
    const home = await createTempDir('ow-cache-home-')
    const env = {
      HOME: home,
      __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: primary
    }

    expect(resolveProjectSharedWorkspaceFolder(worktree, env)).toBe(primary)
    expect(resolveProjectSharedCacheDir(worktree, env)).toBe(resolveProjectHomePath(primary, env, 'caches'))
    expect(resolveProjectSharedCachePath(worktree, env, 'adapter-kimi', 'cli'))
      .toBe(join(resolveProjectHomePath(primary, env, 'caches'), 'adapter-kimi', 'cli'))
    expect(resolveProjectOoPath(worktree, env, 'caches')).toBe(resolveProjectHomePath(primary, env, 'caches'))
    expect(resolveProjectOoPath(worktree, env, 'skills')).toBe(join(worktree, '.oo', 'skills'))
  })

  it('lets an explicit shared cache dir override primary workspace resolution', async () => {
    const primary = await createTempDir('ow-cache-primary-')
    const worktree = await createTempDir('ow-cache-worktree-')
    const home = await createTempDir('ow-cache-home-')
    const env = {
      HOME: home,
      __ONEWORKS_PROJECT_LAUNCH_CWD__: worktree,
      __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: primary,
      __ONEWORKS_PROJECT_CACHE_DIR__: 'shared-cache'
    }

    expect(resolveProjectSharedCacheDir(worktree, env)).toBe(join(worktree, 'shared-cache'))
  })

  it.skipIf(!hasGit)('detects a git worktree primary workspace without env hints', async () => {
    const primary = await createTempDir('ow-cache-git-primary-')
    const worktreeRoot = await createTempDir('ow-cache-git-worktrees-')
    const home = await createTempDir('ow-cache-home-')
    const worktree = join(worktreeRoot, 'repo-worktree')

    runGit(primary, ['init'])
    await writeFile(join(primary, 'README.md'), 'hello\n', 'utf8')
    runGit(primary, ['add', 'README.md'])
    runGit(primary, [
      '-c',
      'user.email=ow@example.test',
      '-c',
      'user.name=One Works',
      'commit',
      '-m',
      'init'
    ])
    runGit(primary, ['worktree', 'add', '--detach', worktree, 'HEAD'])

    const realPrimary = await realpath(primary)
    const env = { HOME: home }
    expect(resolveProjectSharedWorkspaceFolder(worktree, env)).toBe(realPrimary)
    expect(resolveProjectSharedCacheDir(worktree, env)).toBe(resolveProjectHomePath(realPrimary, env, 'caches'))
  })
})
