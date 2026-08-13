import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveGitRepositoryRoot, runGitCommand } from '#~/git-worktree.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

describe('git-worktree stdout contracts', () => {
  it('preserves repository-root whitespace while retaining generic text trimming', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oneworks-git-output-'))
    tempDirs.push(root)
    const repository = join(root, 'repository ')
    await mkdir(repository)
    execFileSync('git', ['init'], { cwd: repository, stdio: 'pipe' })
    execFileSync('git', ['config', 'oneworks.test-value', '  ordinary text  '], {
      cwd: repository,
      stdio: 'pipe'
    })

    await expect(resolveGitRepositoryRoot(repository)).resolves.toBe(await realpath(repository))
    await expect(runGitCommand(['config', '--get', 'oneworks.test-value'], repository)).resolves.toEqual({
      stderr: '',
      stdout: 'ordinary text'
    })
  })

  it.runIf(process.platform !== 'win32')(
    'removes one Git line delimiter without erasing repository-root line bytes',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'oneworks-git-output-eol-'))
      tempDirs.push(root)
      const newlineRepository = join(root, 'repository\n')
      const carriageReturnRepository = join(root, 'repository\r')
      const adjacentRepository = join(root, 'repository')
      await Promise.all([mkdir(newlineRepository), mkdir(carriageReturnRepository), mkdir(adjacentRepository)])
      execFileSync('git', ['init'], { cwd: newlineRepository, stdio: 'pipe' })
      execFileSync('git', ['init'], { cwd: carriageReturnRepository, stdio: 'pipe' })
      execFileSync('git', ['init'], { cwd: adjacentRepository, stdio: 'pipe' })

      await expect(resolveGitRepositoryRoot(newlineRepository)).resolves.toBe(await realpath(newlineRepository))
      await expect(resolveGitRepositoryRoot(carriageReturnRepository)).resolves.toBe(
        await realpath(carriageReturnRepository)
      )
      await expect(resolveGitRepositoryRoot(carriageReturnRepository)).resolves.not.toBe(
        await realpath(adjacentRepository)
      )
    }
  )
})
