import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  resolveFilesystemDirectoryPath,
  resolveFilesystemFilePath,
  resolveWorkspaceDirectoryPath,
  resolveWorkspaceFilePath,
  searchFilesystemFiles,
  searchWorkspaceFiles
} from '../src/main/workspace-file-search'

const createdPaths: string[] = []

const createWorkspace = async () => {
  const workspaceFolder = await mkdtemp(join(tmpdir(), 'oneworks-desktop-search-'))
  createdPaths.push(workspaceFolder)
  return workspaceFolder
}

afterEach(async () => {
  await Promise.all(createdPaths.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('workspace file search', () => {
  it('finds matching project files and skips ignored directories', async () => {
    const workspaceFolder = await createWorkspace()
    await mkdir(join(workspaceFolder, 'apps', 'client'), { recursive: true })
    await mkdir(join(workspaceFolder, 'node_modules', 'pkg'), { recursive: true })
    await writeFile(join(workspaceFolder, 'apps', 'client', 'LauncherRoute.tsx'), '')
    await writeFile(join(workspaceFolder, 'node_modules', 'pkg', 'LauncherRoute.tsx'), '')

    await expect(searchWorkspaceFiles({ query: 'launcher', workspaceFolder })).resolves.toEqual([
      {
        directory: 'apps/client',
        name: 'LauncherRoute.tsx',
        path: 'apps/client/LauncherRoute.tsx',
        type: 'file'
      }
    ])
  })

  it('finds Chinese file names by full pinyin and initials', async () => {
    const workspaceFolder = await createWorkspace()
    await mkdir(join(workspaceFolder, '资料'), { recursive: true })
    await writeFile(join(workspaceFolder, '资料', '文件搜索.md'), '')

    await expect(searchWorkspaceFiles({ query: 'wenjiansousuo', workspaceFolder })).resolves.toEqual([
      {
        directory: '资料',
        name: '文件搜索.md',
        path: '资料/文件搜索.md',
        type: 'file'
      }
    ])
    await expect(searchWorkspaceFiles({ query: 'wjss', workspaceFolder })).resolves.toEqual([
      {
        directory: '资料',
        name: '文件搜索.md',
        path: '资料/文件搜索.md',
        type: 'file'
      }
    ])
  })

  it('can search filesystem roots with absolute result paths', async () => {
    const rootFolder = await createWorkspace()
    await mkdir(join(rootFolder, 'Users', 'demo'), { recursive: true })
    await writeFile(join(rootFolder, 'Users', 'demo', 'alpha.txt'), '')

    await expect(searchFilesystemFiles({ query: 'alpha', rootFolder })).resolves.toEqual([
      {
        directory: join(rootFolder, 'Users', 'demo'),
        name: 'alpha.txt',
        path: join(rootFolder, 'Users', 'demo', 'alpha.txt'),
        type: 'file'
      }
    ])
  })

  it('rejects file paths that escape the workspace root', async () => {
    const workspaceFolder = await createWorkspace()
    const externalFolder = await createWorkspace()
    await writeFile(join(externalFolder, 'outside.txt'), '')
    await symlink(join(externalFolder, 'outside.txt'), join(workspaceFolder, 'outside.txt'))

    await expect(resolveWorkspaceFilePath(workspaceFolder, 'outside.txt')).rejects.toThrow(
      'Workspace file path escapes the workspace root.'
    )
  })

  it('opens exact whitespace-bearing workspace files and directories', async () => {
    const workspaceFolder = await createWorkspace()
    const rawDirectory = ' project '
    const adjacentDirectory = rawDirectory.trim()
    const rawFile = ' report.txt '
    const rawFilePath = `${rawDirectory}/${rawFile}`
    const adjacentFilePath = rawFilePath.trim()
    await mkdir(join(workspaceFolder, rawDirectory))
    await mkdir(join(workspaceFolder, adjacentDirectory))
    await mkdir(join(workspaceFolder, dirname(adjacentFilePath)), { recursive: true })
    await writeFile(join(workspaceFolder, rawDirectory, rawFile), 'raw\n')
    await writeFile(join(workspaceFolder, adjacentFilePath), 'adjacent\n')

    await expect(resolveWorkspaceDirectoryPath(workspaceFolder, rawDirectory)).resolves.toBe(
      await realpath(join(workspaceFolder, rawDirectory))
    )
    await expect(resolveWorkspaceFilePath(workspaceFolder, rawFilePath)).resolves.toBe(
      await realpath(join(workspaceFolder, rawDirectory, rawFile))
    )
  })

  it('opens POSIX literal-backslash workspace entries without crossing into nested peers', async () => {
    if (process.platform === 'win32') return
    const workspaceFolder = await createWorkspace()
    const literalDirectory = String.raw`dir\child`
    const nestedDirectory = 'dir/child'
    const literalFile = String.raw`dir\file.md`
    const nestedFile = 'dir/file.md'
    await mkdir(join(workspaceFolder, literalDirectory))
    await mkdir(join(workspaceFolder, nestedDirectory), { recursive: true })
    await writeFile(join(workspaceFolder, literalFile), 'literal\n')
    await writeFile(join(workspaceFolder, nestedFile), 'nested\n')

    await expect(resolveWorkspaceDirectoryPath(workspaceFolder, literalDirectory)).resolves.toBe(
      await realpath(join(workspaceFolder, literalDirectory))
    )
    await expect(resolveWorkspaceFilePath(workspaceFolder, literalFile)).resolves.toBe(
      await realpath(join(workspaceFolder, literalFile))
    )
  })

  it('opens exact whitespace-bearing absolute files and directories', async () => {
    const rootFolder = await createWorkspace()
    const rawDirectory = join(rootFolder, ' absolute ')
    const adjacentDirectory = rawDirectory.trim()
    const rawFile = join(rawDirectory, ' file.txt ')
    await mkdir(rawDirectory)
    await mkdir(adjacentDirectory)
    await writeFile(rawFile, 'raw\n')
    await writeFile(rawFile.trim(), 'adjacent\n')

    await expect(resolveFilesystemDirectoryPath(rawDirectory)).resolves.toBe(await realpath(rawDirectory))
    await expect(resolveFilesystemFilePath(rawFile)).resolves.toBe(await realpath(rawFile))
  })

  it('rejects relative filesystem file paths', async () => {
    await expect(resolveFilesystemFilePath('relative.txt')).rejects.toThrow(
      'Filesystem file path must be absolute.'
    )
  })
})
