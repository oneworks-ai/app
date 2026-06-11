import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import { discoverRuntimeSessionStores, resolveRuntimeRoots } from '#~/services/runtime-store/discovery.js'

const tempDirs: string[] = []
const originalCwd = process.cwd()

const createTempRoot = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ow-runtime-discovery-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  process.chdir(originalCwd)
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

describe('runtime store discovery', () => {
  it('prefers project-home session stores over legacy roots for the same session id', async () => {
    const root = await createTempRoot()
    const projectHomeRoot = path.join(root, 'home-runtime')
    const legacyRoot = path.join(root, 'legacy-runtime')
    const projectStore = path.join(projectHomeRoot, 'sessions', 'sess-shared')
    const legacyStore = path.join(legacyRoot, 'sessions', 'sess-shared')

    await mkdir(projectStore, { recursive: true })
    await mkdir(legacyStore, { recursive: true })

    const stores = await discoverRuntimeSessionStores([projectHomeRoot, legacyRoot])

    expect(stores).toEqual([
      expect.objectContaining({
        sessionId: 'sess-shared',
        root: projectHomeRoot,
        storePath: projectStore
      })
    ])
  })

  it('resolves relative indexed store paths only under the runtime root', async () => {
    const root = await createTempRoot()
    const cwd = await createTempRoot()
    const cwdStorePath = path.join(cwd, 'sessions', 'sess-indexed')

    await mkdir(cwdStorePath, { recursive: true })
    await mkdir(root, { recursive: true })
    await writeFile(
      path.join(root, 'index.json'),
      JSON.stringify({
        protocolVersion: '1.0.0',
        sessions: {
          'sess-indexed': {
            storePath: 'sessions/sess-indexed',
            status: 'running'
          }
        }
      })
    )
    process.chdir(cwd)

    const stores = await discoverRuntimeSessionStores([root])

    expect(stores).toEqual([
      expect.objectContaining({
        sessionId: 'sess-indexed',
        storePath: path.join(root, 'sessions', 'sess-indexed')
      })
    ])
  })

  it('drops inherited exact project-home dirs when resolving roots for another workspace', () => {
    const workspaceA = path.join('/tmp', 'ow-runtime-workspace-a')
    const workspaceB = path.join('/tmp', 'ow-runtime-workspace-b')
    const projectsDir = path.join('/tmp', 'ow-runtime-home-projects')
    const env = {
      __ONEWORKS_PROJECT_LAUNCH_CWD__: workspaceA,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceA,
      __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: projectsDir,
      __ONEWORKS_PROJECT_HOME_PROJECT_DIR__: 'workspace-a-home'
    }

    expect(resolveRuntimeRoots({ cwd: workspaceB, env })[0]).toBe(
      resolveProjectHomePath(workspaceB, {
        __ONEWORKS_PROJECT_LAUNCH_CWD__: workspaceB,
        __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspaceB,
        __ONEWORKS_PROJECT_WORKSPACE_FOLDER_RESOLVE_CWD__: workspaceB,
        __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: projectsDir
      }, 'runtime')
    )
  })
})
