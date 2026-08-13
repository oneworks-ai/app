import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  getRepositoryBranches,
  getRepositoryWorktrees,
  getWorkspaceGitStateInternal
} from '#~/services/git/repository.js'
import { runGit, runGitPath } from '#~/services/git/runner.js'

const tempDirectories: string[] = []

const createRepository = async (directory: string, branch: string, content: string) => {
  await mkdir(directory, { recursive: true })
  execFileSync('git', ['init'], { cwd: directory, stdio: 'pipe' })
  execFileSync('git', ['config', 'user.email', 'ow@example.com'], { cwd: directory, stdio: 'pipe' })
  execFileSync('git', ['config', 'user.name', 'One Works'], { cwd: directory, stdio: 'pipe' })
  await writeFile(path.join(directory, 'README.md'), content, 'utf8')
  execFileSync('git', ['add', 'README.md'], { cwd: directory, stdio: 'pipe' })
  execFileSync('git', ['commit', '-m', 'init'], { cwd: directory, stdio: 'pipe' })
  execFileSync('git', ['branch', '-M', branch], { cwd: directory, stdio: 'pipe' })
}

describe('git repository path identity', () => {
  afterEach(async () => {
    await Promise.all(tempDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  })

  it('uses the exact repository root returned by Git when the directory ends in whitespace', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-git-path-identity-'))
    tempDirectories.push(root)
    const adjacentRepository = path.join(root, 'repository')
    const repository = path.join(root, 'repository ')
    await createRepository(adjacentRepository, 'adjacent-branch', '# adjacent\n')
    await createRepository(repository, 'raw-branch', '# raw repository\n')

    const state = await getWorkspaceGitStateInternal(repository)

    expect(state).toEqual(expect.objectContaining({
      available: true,
      currentBranch: 'raw-branch',
      cwd: repository,
      repositoryRoot: await realpath(repository)
    }))

    execFileSync('git', ['config', 'oneworks.test-value', '  status text  '], { cwd: repository, stdio: 'pipe' })
    await expect(runGit(['config', '--get', 'oneworks.test-value'], repository)).resolves.toEqual({
      stderr: '',
      stdout: 'status text'
    })
    await expect(runGitPath(['rev-parse', '--show-toplevel'], repository)).resolves.toEqual({
      stderr: '',
      stdout: await realpath(repository)
    })
  })

  it.runIf(process.platform !== 'win32')(
    'preserves a terminal carriage return before the Git line delimiter',
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'ow-git-path-eol-'))
      tempDirectories.push(root)
      const adjacentRepository = path.join(root, 'repository')
      const repository = path.join(root, 'repository\r')
      await createRepository(adjacentRepository, 'adjacent-branch', '# adjacent\n')
      await createRepository(repository, 'raw-branch', '# raw repository\n')

      const state = await getWorkspaceGitStateInternal(repository)

      expect(state).toEqual(expect.objectContaining({
        available: true,
        currentBranch: 'raw-branch',
        repositoryRoot: await realpath(repository)
      }))
      expect(state.repositoryRoot).not.toBe(await realpath(adjacentRepository))
    }
  )

  it('keeps whitespace-distinct file and worktree records through the real Git service', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ow-git-record-identity-'))
    tempDirectories.push(root)
    const repository = path.join(root, 'repository ')
    const adjacentWorktree = path.join(root, 'worktree')
    const exactWorktree = path.join(root, 'worktree ')
    await createRepository(repository, 'main', '# repository\n')
    await Promise.all([
      writeFile(path.join(repository, 'report.txt'), 'adjacent\n', 'utf8'),
      writeFile(path.join(repository, 'report.txt '), 'exact\n', 'utf8')
    ])
    execFileSync('git', ['add', '--', 'report.txt', 'report.txt '], { cwd: repository, stdio: 'pipe' })
    execFileSync('git', ['commit', '-m', 'add reports'], { cwd: repository, stdio: 'pipe' })
    await Promise.all([
      writeFile(path.join(repository, 'report.txt'), 'adjacent changed\n', 'utf8'),
      writeFile(path.join(repository, 'report.txt '), 'exact changed\n', 'utf8')
    ])
    execFileSync('git', ['worktree', 'add', '-b', 'adjacent-worktree', adjacentWorktree], {
      cwd: repository,
      stdio: 'pipe'
    })
    execFileSync('git', ['worktree', 'add', '-b', 'exact-worktree', exactWorktree], {
      cwd: repository,
      stdio: 'pipe'
    })

    const state = await getWorkspaceGitStateInternal(repository)
    const branches = await getRepositoryBranches(repository, 'main')
    const worktrees = await getRepositoryWorktrees(repository)

    expect(state.changedFiles).toBeDefined()
    expect(state.workingTreeSummary).toBeDefined()
    expect(new Set(state.changedFiles!.map(file => file.path))).toEqual(new Set(['report.txt', 'report.txt ']))
    expect(state.workingTreeSummary!.changedFiles).toBe(2)
    expect(branches.find(branch => branch.name === 'exact-worktree')?.worktreePath).toBe(await realpath(exactWorktree))
    expect(worktrees.find(worktree => worktree.branchName === 'exact-worktree')?.path).toBe(
      await realpath(exactWorktree)
    )
  })
})
