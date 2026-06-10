import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HttpError } from '#~/utils/http.js'

import { listWorkspaceTree } from '#~/services/workspace/tree.js'

describe('workspace tree service', () => {
  let workspaceDir: string
  let sessionWorkspaceDir: string

  const treeEntry = (
    root: string,
    path: string,
    name: string,
    type: 'file' | 'directory',
    extra: Record<string, unknown> = {}
  ) => ({
    absolutePath: join(root, path),
    path,
    name,
    type,
    ...extra
  })

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), 'ow-workspace-tree-'))
    sessionWorkspaceDir = await mkdtemp(join(tmpdir(), 'ow-session-workspace-tree-'))
    vi.stubEnv('__ONEWORKS_PROJECT_WORKSPACE_FOLDER__', workspaceDir)

    await mkdir(join(workspaceDir, 'src', 'nested'), { recursive: true })
    await mkdir(join(workspaceDir, '.oo', 'rules'), { recursive: true })
    await mkdir(join(workspaceDir, 'node_modules', 'pkg'), { recursive: true })
    await mkdir(join(sessionWorkspaceDir, 'docs'), { recursive: true })
    await writeFile(join(workspaceDir, 'README.md'), '# demo\n')
    await writeFile(join(workspaceDir, 'src', 'index.ts'), 'export {}\n')
    await writeFile(join(workspaceDir, '.oo', 'rules', 'rule.md'), 'rule\n')
    await writeFile(join(sessionWorkspaceDir, 'docs', 'guide.md'), '# guide\n')
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await rm(workspaceDir, { recursive: true, force: true })
    await rm(sessionWorkspaceDir, { recursive: true, force: true })
  })

  it('lists workspace entries relative to the workspace root and skips ignored directories', async () => {
    await expect(listWorkspaceTree()).resolves.toEqual({
      path: '',
      entries: [
        treeEntry(workspaceDir, '.oo', '.oo', 'directory'),
        treeEntry(workspaceDir, 'src', 'src', 'directory'),
        treeEntry(workspaceDir, 'README.md', 'README.md', 'file')
      ]
    })
  })

  it('lists nested directories using normalized relative paths', async () => {
    await expect(listWorkspaceTree('src')).resolves.toEqual({
      path: 'src',
      entries: [
        treeEntry(workspaceDir, 'src/nested', 'nested', 'directory'),
        treeEntry(workspaceDir, 'src/index.ts', 'index.ts', 'file')
      ]
    })
  })

  it('lists symbolic links with their resolved link type', async () => {
    await symlink('src', join(workspaceDir, 'src-link'), 'dir')
    await symlink('README.md', join(workspaceDir, 'readme-link.md'), 'file')
    await symlink('missing.md', join(workspaceDir, 'broken-link.md'), 'file')
    await symlink(join(sessionWorkspaceDir, 'docs'), join(workspaceDir, 'external-docs'), 'dir')

    const result = await listWorkspaceTree()

    expect(result.entries).toEqual(expect.arrayContaining([
      treeEntry(workspaceDir, 'src-link', 'src-link', 'directory', {
        isSymlink: true,
        linkKind: 'symlink',
        linkTarget: 'src',
        linkType: 'directory',
        isExternal: false
      }),
      treeEntry(workspaceDir, 'external-docs', 'external-docs', 'directory', {
        isSymlink: true,
        linkKind: 'symlink',
        linkTarget: join(sessionWorkspaceDir, 'docs'),
        linkType: 'directory',
        isExternal: true
      }),
      treeEntry(workspaceDir, 'readme-link.md', 'readme-link.md', 'file', {
        isSymlink: true,
        linkKind: 'symlink',
        linkTarget: 'README.md',
        linkType: 'file',
        isExternal: false
      }),
      treeEntry(workspaceDir, 'broken-link.md', 'broken-link.md', 'file', {
        isSymlink: true,
        linkKind: 'symlink',
        linkTarget: 'missing.md',
        linkType: 'missing'
      })
    ]))
  })

  it('lists Git worktree pointer files as special directory links', async () => {
    const gitdirPath = join(sessionWorkspaceDir, '.git', 'worktrees', 'demo')
    await mkdir(gitdirPath, { recursive: true })
    await writeFile(join(workspaceDir, '.git'), `gitdir: ${gitdirPath}\n`)

    const result = await listWorkspaceTree()

    expect(result.entries).toEqual(expect.arrayContaining([
      treeEntry(workspaceDir, '.git', '.git', 'directory', {
        linkKind: 'gitdir',
        linkTarget: gitdirPath,
        linkType: 'directory',
        isExternal: true
      })
    ]))
  })

  it('lists an internal symbolic link directory through its workspace-relative path', async () => {
    await symlink('src', join(workspaceDir, 'src-link'), 'dir')

    await expect(listWorkspaceTree('src-link')).resolves.toEqual({
      path: 'src-link',
      entries: [
        treeEntry(workspaceDir, 'src-link/nested', 'nested', 'directory'),
        treeEntry(workspaceDir, 'src-link/index.ts', 'index.ts', 'file')
      ]
    })
  })

  it('reports missing workspace tree paths as not found', async () => {
    await expect(listWorkspaceTree('missing')).rejects.toMatchObject(
      {
        status: 404,
        code: 'workspace_tree_path_not_found'
      } satisfies Partial<HttpError>
    )
  })

  it('rejects paths outside the workspace root', async () => {
    await expect(listWorkspaceTree('../outside')).rejects.toMatchObject(
      {
        status: 400,
        code: 'invalid_workspace_tree_path'
      } satisfies Partial<HttpError>
    )
  })

  it('supports listing an explicit session workspace folder', async () => {
    await expect(listWorkspaceTree(undefined, { workspaceFolder: sessionWorkspaceDir })).resolves.toEqual({
      path: '',
      entries: [
        treeEntry(sessionWorkspaceDir, 'docs', 'docs', 'directory')
      ]
    })
  })
})
