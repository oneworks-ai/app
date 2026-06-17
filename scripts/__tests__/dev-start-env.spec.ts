import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildRuntimeEnv, resolveDevStartHomeProjectsDir, resolveDevStartInstanceId } from '../dev-start/env'
import { repoRoot } from '../dev-start/paths'

describe('dev-start runtime env', () => {
  let tempHome = ''

  afterEach(async () => {
    vi.unstubAllEnvs()
    if (tempHome !== '') {
      await rm(tempHome, { recursive: true, force: true })
      tempHome = ''
    }
  })

  const stubHome = async () => {
    tempHome = await mkdtemp(path.join(tmpdir(), 'ow-dev-start-home-'))
    vi.stubEnv('HOME', tempHome)
    vi.stubEnv('__ONEWORKS_PROJECT_REAL_HOME__', tempHome)
    vi.stubEnv('__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__', '')
    vi.stubEnv('__ONEWORKS_PROJECT_HOME_PROJECT_DIR__', '')
    vi.stubEnv('DB_PATH', undefined)
    return tempHome
  }

  it('uses an isolated project home root per dev-start worktree by default', async () => {
    const home = await stubHome()
    const expectedProjectsDir = path.join(
      home,
      '.oneworks',
      'dev-instances',
      resolveDevStartInstanceId(repoRoot),
      'projects'
    )

    const env = await buildRuntimeEnv({
      clientPort: 5173,
      serverPort: 8787,
      serverRole: 'manager'
    })

    expect(env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__).toBe(expectedProjectsDir)
    expect(env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__).toBe(path.join(expectedProjectsDir, 'manager'))
    expect(env.DB_PATH).toBe(path.join(expectedProjectsDir, 'manager', '.local/server/db.sqlite'))
    expect(env.__ONEWORKS_DEV_START_INSTANCE_ID__).toBe(resolveDevStartInstanceId(repoRoot))
  })

  it('keeps explicit project home roots for shared or custom dev storage', async () => {
    const home = await stubHome()
    const customProjectsDir = path.join(home, 'shared-projects')
    vi.stubEnv('__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__', customProjectsDir)

    const env = await buildRuntimeEnv({
      clientPort: 5173,
      serverPort: 8787,
      serverRole: 'manager'
    })

    expect(env.__ONEWORKS_PROJECT_HOME_PROJECTS_DIR__).toBe(customProjectsDir)
    expect(env.__ONEWORKS_PROJECT_HOME_PROJECT_DIR__).toBe(path.join(customProjectsDir, 'manager'))
  })

  it('derives different instance ids for different worktree roots', () => {
    expect(resolveDevStartInstanceId('/tmp/oneworks-a/app'))
      .not.toBe(resolveDevStartInstanceId('/tmp/oneworks-b/app'))
    expect(resolveDevStartHomeProjectsDir({
      HOME: '/tmp/home',
      __ONEWORKS_PROJECT_REAL_HOME__: '/tmp/home'
    }, '/tmp/oneworks-a/app')).toContain('/tmp/home/.oneworks/dev-instances/app-')
  })
})
