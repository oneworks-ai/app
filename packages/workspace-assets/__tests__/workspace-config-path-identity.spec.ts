import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { findWorkspaceAsset, resolveConfiguredWorkspaceAssets } from '#~/index.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

describe('workspace config filesystem identity', () => {
  it('keeps whitespace-distinct entry and glob paths through merge, scan, and selection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-assets-paths-'))
    tempDirs.push(root)
    await Promise.all([
      mkdir(join(root, 'project')),
      mkdir(join(root, 'project ')),
      mkdir(join(root, 'team')),
      mkdir(join(root, 'team '))
    ])

    const workspaces = await resolveConfiguredWorkspaceAssets({
      cwd: root,
      configs: [{
        workspaces: {
          entries: {
            exact: {
              name: ' Exact workspace ',
              path: 'project '
            }
          },
          include: ['team '],
          exclude: ['team']
        }
      }, undefined]
    })

    expect(workspaces.map(workspace => workspace.payload.cwd)).toEqual([
      join(root, 'team '),
      join(root, 'project ')
    ])
    expect(workspaces).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ payload: expect.objectContaining({ cwd: join(root, 'project') }) }),
      expect.objectContaining({ payload: expect.objectContaining({ cwd: join(root, 'team') }) })
    ]))
    expect(findWorkspaceAsset(workspaces, 'project ')?.payload.cwd).toBe(join(root, 'project '))
    expect(findWorkspaceAsset(workspaces, 'project')).toBeUndefined()
    expect(workspaces.find(workspace => workspace.name === 'exact')?.payload.name).toBe('Exact workspace')
  })

  it('keeps POSIX literal-backslash directories distinct through discovery and selection', async () => {
    if (process.platform === 'win32') return
    const root = await mkdtemp(join(tmpdir(), 'workspace-assets-backslash-'))
    tempDirs.push(root)
    const literalPath = String.raw`team\secret`
    const nestedPath = 'team/secret'
    await mkdir(join(root, literalPath), { recursive: true })
    await mkdir(join(root, nestedPath), { recursive: true })

    const workspaces = await resolveConfiguredWorkspaceAssets({
      cwd: root,
      configs: [{
        workspaces: {
          entries: {
            literal: { path: literalPath },
            nested: { path: nestedPath }
          }
        }
      }, undefined]
    })

    expect(workspaces.map(workspace => workspace.payload.path)).toEqual([literalPath, nestedPath])
    expect(findWorkspaceAsset(workspaces, literalPath)?.payload.cwd).toBe(join(root, literalPath))
    expect(findWorkspaceAsset(workspaces, nestedPath)?.payload.cwd).toBe(join(root, nestedPath))
  })
})
