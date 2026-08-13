import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveDevServerFsAllow } from '../vite-fs-allow'

describe('resolveDevServerFsAllow filesystem identity', () => {
  it('preserves whitespace-distinct workspace, primary, home, and explicit allow roots', () => {
    const root = path.resolve('/tmp/oneworks-vite-fs-allow')
    const workspace = path.join(root, 'workspace ')
    const primaryWorkspace = path.join(root, ' primary-workspace')
    const realHome = path.join(root, 'home ')
    const extraRoot = path.join(root, ' extra ')
    const adjacentPaths = [
      path.join(root, 'workspace'),
      path.join(root, 'primary-workspace'),
      path.join(root, 'home', '.oneworks'),
      path.join(root, 'extra')
    ]

    const result = resolveDevServerFsAllow(root, {
      __ONEWORKS_PROJECT_CLIENT_FS_ALLOW__: JSON.stringify([extraRoot]),
      __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: primaryWorkspace,
      __ONEWORKS_PROJECT_REAL_HOME__: realHome,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspace
    })

    expect(result).toEqual([
      root,
      workspace,
      primaryWorkspace,
      path.join(realHome, '.oneworks'),
      extraRoot
    ])
    for (const adjacentPath of adjacentPaths) expect(result).not.toContain(adjacentPath)
  })

  it('preserves nonblank delimiter-framed filesystem entries', () => {
    const root = path.resolve('/tmp/oneworks-vite-fs-delimited')
    const first = path.join(root, ' first ')
    const second = path.join(root, 'second ')

    expect(resolveDevServerFsAllow(root, {
      __ONEWORKS_PROJECT_CLIENT_FS_ALLOW__: `${first}${path.delimiter}${second}`
    })).toEqual([root, first, second])
  })
})
