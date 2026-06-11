import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ensureWorkspaceFolderExists } from '../src/main/workspace-folder-create'

const createdDirectories: string[] = []

const createTempRoot = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'oneworks-desktop-workspace-create-'))
  createdDirectories.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0, createdDirectories.length)
      .map(directory => rm(directory, { force: true, recursive: true }))
  )
})

describe('workspace folder creation', () => {
  it('creates a missing workspace folder and returns its normalized path', async () => {
    const root = await createTempRoot()
    const workspaceFolder = path.join(root, 'new-project')

    const normalizedWorkspaceFolder = await ensureWorkspaceFolderExists(workspaceFolder)
    expect(normalizedWorkspaceFolder).toBe(await realpath(workspaceFolder))
  })

  it('accepts an existing directory', async () => {
    const root = await createTempRoot()
    const workspaceFolder = path.join(root, 'existing-project')
    await mkdir(workspaceFolder)

    await expect(ensureWorkspaceFolderExists(workspaceFolder)).resolves.toBe(await realpath(workspaceFolder))
  })

  it('rejects an existing file path', async () => {
    const root = await createTempRoot()
    const workspaceFile = path.join(root, 'not-a-folder')
    await writeFile(workspaceFile, '')

    await expect(ensureWorkspaceFolderExists(workspaceFile)).rejects.toThrow('not a folder')
  })
})
