import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { cloneGitRepositoryIntoDirectory, listCloneDestinationDirectories } from '../src/main/workspace-git-clone'

const createdDirectories: string[] = []

const hasGit = () => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const itWithGit = hasGit() ? it : it.skip

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0, createdDirectories.length)
      .map(directory => rm(directory, { force: true, recursive: true }))
  )
})

describe('workspace Git clone paths', () => {
  itWithGit('preserves leading and trailing whitespace in list and clone destination identity', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'oneworks-desktop-workspace-clone-'))
    createdDirectories.push(root)
    const repository = path.join(root, 'source.git')
    const destinationDirectory = path.join(
      root,
      process.platform === 'win32' ? ' destination directory' : ' destination directory '
    )
    execFileSync('git', ['init', '--bare', repository], { stdio: 'ignore' })
    await mkdir(destinationDirectory)

    const directoryList = await listCloneDestinationDirectories(destinationDirectory)
    expect(directoryList.currentDirectory).toBe(await realpath(destinationDirectory))

    const workspaceFolder = await cloneGitRepositoryIntoDirectory({
      destinationDirectory,
      repositoryUrl: repository
    })
    expect(workspaceFolder).toBe(await realpath(path.join(destinationDirectory, 'source')))
  })
})
