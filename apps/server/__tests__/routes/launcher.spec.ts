import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

import Koa from 'koa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { launcherRouter } from '#~/routes/launcher.js'
import { resolveLauncherProjectWorkspaceFolder } from '#~/services/launcher/manager.js'

const createServerEnv = (role: 'manager' | 'workspace') => ({
  __ONEWORKS_PROJECT_SERVER_HOST__: '127.0.0.1',
  __ONEWORKS_PROJECT_SERVER_PORT__: 8787,
  __ONEWORKS_PROJECT_SERVER_WS_PATH__: '/ws',
  __ONEWORKS_PROJECT_SERVER_DATA_DIR__: '/tmp/ow-data',
  __ONEWORKS_PROJECT_SERVER_LOG_DIR__: '/tmp/ow-logs',
  __ONEWORKS_PROJECT_SERVER_LOG_LEVEL__: 'info',
  __ONEWORKS_PROJECT_SERVER_DEBUG__: false,
  __ONEWORKS_PROJECT_SERVER_ALLOW_CORS__: false,
  __ONEWORKS_PROJECT_SERVER_ROLE__: role,
  __ONEWORKS_PROJECT_CLIENT_MODE__: 'none'
} as const)

const hasGit = () => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const itWithGit = hasGit() ? it : it.skip

describe('launcher routes', () => {
  let tempHome = ''
  let server: http.Server | undefined
  let baseUrl = ''

  beforeEach(async () => {
    tempHome = await mkdtemp(path.join(tmpdir(), 'ow-launcher-route-home-'))
    vi.stubEnv('HOME', tempHome)
    vi.stubEnv('__ONEWORKS_PROJECT_HOME_PROJECT_DIR__', 'manager')
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve()
        return
      }
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
    server = undefined
    baseUrl = ''
    if (tempHome !== '') {
      await rm(tempHome, { recursive: true, force: true })
      tempHome = ''
    }
  })

  const startApp = async (role: 'manager' | 'workspace') => {
    const app = new Koa()
    app.use(async (ctx, next) => {
      try {
        await next()
      } catch (error) {
        const status = typeof (error as { status?: unknown }).status === 'number'
          ? (error as { status: number }).status
          : 500
        ctx.status = status
        ctx.body = { status }
      }
    })
    app.use(launcherRouter(createServerEnv(role)).routes())
    server = http.createServer(app.callback())
    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (address == null || typeof address === 'string') {
      throw new Error('Failed to start test server')
    }
    baseUrl = `http://127.0.0.1:${address.port}`
  }

  it('serves workspace selector state in manager role', async () => {
    await startApp('manager')

    const response = await fetch(`${baseUrl}/workspaces`)
    const body = await response.json() as {
      recentProjects?: unknown
      runningProjects?: unknown
    }

    expect(response.status).toBe(200)
    expect(Array.isArray(body.recentProjects)).toBe(true)
    expect(Array.isArray(body.runningProjects)).toBe(true)
  })

  it('does not expose launcher routes from workspace role', async () => {
    await startApp('workspace')

    const response = await fetch(`${baseUrl}/workspaces`)

    expect(response.status).toBe(404)
  })

  itWithGit('resolves linked git worktrees to the common project folder', async () => {
    const projectFolder = await mkdtemp(path.join(tempHome, 'git-project-'))
    fs.writeFileSync(path.join(projectFolder, 'README.md'), 'test\n')
    execFileSync('git', ['-C', projectFolder, 'init'], { stdio: 'ignore' })
    execFileSync('git', ['-C', projectFolder, 'add', 'README.md'], { stdio: 'ignore' })
    execFileSync(
      'git',
      [
        '-C',
        projectFolder,
        '-c',
        'user.name=One Works',
        '-c',
        'user.email=oneworks@example.test',
        'commit',
        '-m',
        'init'
      ],
      { stdio: 'ignore' }
    )
    const linkedWorktree = path.join(tempHome, 'linked-worktree')
    execFileSync(
      'git',
      ['-C', projectFolder, 'worktree', 'add', linkedWorktree, '-b', `linked-${Date.now()}`],
      { stdio: 'ignore' }
    )

    expect(resolveLauncherProjectWorkspaceFolder(linkedWorktree)).toBe(fs.realpathSync.native(projectFolder))
  })
})
