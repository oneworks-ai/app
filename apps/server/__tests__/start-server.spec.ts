import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import { migrateDefaultServerDataDir } from '../src/project-home-data-migration.js'

vi.mock('#~/services/config/index.js', () => ({
  loadConfigState: vi.fn(async () => ({
    projectConfig: {},
    userConfig: {},
    mergedConfig: {}
  }))
}))

const tempDirs: string[] = []
const originalCwd = process.cwd()

afterEach(async () => {
  process.chdir(originalCwd)
  vi.unstubAllEnvs()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true })))
})

describe('createServerRuntime', () => {
  it('migrates legacy default data when the configured data dir is the project-home default', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'ow-server-start-'))
    tempDirs.push(root)
    const workspace = resolve(root, 'workspace')
    const projectsDir = resolve(root, 'home-projects')

    await mkdir(resolve(workspace, '.data'), { recursive: true })
    await writeFile(resolve(workspace, '.data', 'web-auth-password'), 'legacy-password\n', 'utf8')

    const env = {
      __ONEWORKS_PROJECT_LAUNCH_CWD__: workspace,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: workspace,
      __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: projectsDir
    }
    const dataDir = resolveProjectHomePath(workspace, env, 'server', 'data')

    vi.stubEnv('__ONEWORKS_PROJECT_LAUNCH_CWD__', workspace)
    vi.stubEnv('__ONEWORKS_PROJECT_WORKSPACE_FOLDER__', workspace)
    vi.stubEnv('__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__', projectsDir)
    vi.stubEnv('__ONEWORKS_PROJECT_SERVER_DATA_DIR__', dataDir)
    process.chdir(workspace)

    const { createServerRuntime } = await import('../src/start-server.js')
    const runtime = await createServerRuntime()

    expect(runtime.env.__ONEWORKS_PROJECT_SERVER_DATA_DIR__).toBe(dataDir)
    await expect(readFile(resolve(dataDir, 'web-auth-password'), 'utf8')).resolves.toBe('legacy-password\n')
  })

  it('migrates default server data from the primary workspace into shared project home', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'ow-server-start-'))
    tempDirs.push(root)
    const primary = resolve(root, 'primary')
    const worktree = resolve(root, 'worktree')
    const projectsDir = resolve(root, 'home-projects')

    await mkdir(resolve(primary, '.data'), { recursive: true })
    await mkdir(resolve(primary, '.oo', 'server', 'data'), { recursive: true })
    await writeFile(resolve(primary, '.data', 'web-auth-password'), 'primary-password\n', 'utf8')
    await writeFile(resolve(primary, '.oo', 'server', 'data', 'state.json'), '{"primary":true}\n', 'utf8')

    const env = {
      __ONEWORKS_PROJECT_LAUNCH_CWD__: worktree,
      __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: worktree,
      __ONEWORKS_PROJECT_PRIMARY_WORKSPACE_FOLDER__: primary,
      __ONEWORKS_PROJECT_HOME_PROJECTS_DIR__: projectsDir
    }
    const dataDir = resolveProjectHomePath(worktree, env, 'server', 'data')

    await expect(migrateDefaultServerDataDir(worktree, env)).resolves.toBe(dataDir)
    await expect(readFile(resolve(dataDir, 'web-auth-password'), 'utf8')).resolves.toBe('primary-password\n')
    await expect(readFile(resolve(dataDir, 'state.json'), 'utf8')).resolves.toBe('{"primary":true}\n')
  })
})
