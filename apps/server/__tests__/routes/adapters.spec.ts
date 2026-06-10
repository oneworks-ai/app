import { mkdtemp, readFile, rm } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import Router from '@koa/router'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import { adaptersRouter } from '#~/routes/adapters.js'

const mocks = vi.hoisted(() => ({
  loadConfigState: vi.fn(),
  loadAdapter: vi.fn()
}))

vi.mock('#~/services/config/index.js', () => ({
  loadConfigState: mocks.loadConfigState
}))

vi.mock('@oneworks/types', () => ({
  loadAdapter: mocks.loadAdapter,
  resolveAdapterPackageName: (type: string) => `@oneworks/adapter-${type}`,
  sanitizePackageName: (packageName: string) => packageName.replace(/^@/, '').replace(/[\\/]/g, '__')
}))

describe('adapter routes', () => {
  let workspaceFolder = ''
  let homeFolder = ''
  let server: http.Server | undefined
  let baseUrl = ''
  const originalHome = process.env.HOME

  beforeEach(async () => {
    workspaceFolder = await mkdtemp(path.join(os.tmpdir(), 'oneworks-adapter-routes-'))
    homeFolder = await mkdtemp(path.join(os.tmpdir(), 'oneworks-adapter-routes-home-'))
    process.env.HOME = homeFolder

    const app = new Koa()
    const rootRouter = new Router({ prefix: '/api/adapters' })
    const router = adaptersRouter()
    rootRouter.use(router.routes())
    rootRouter.use(router.allowedMethods())
    app.use(bodyParser())
    app.use(rootRouter.routes())
    app.use(rootRouter.allowedMethods())

    server = http.createServer(app.callback())
    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (address == null || typeof address === 'string') {
      throw new Error('Failed to start test server')
    }
    baseUrl = `http://127.0.0.1:${address.port}`

    mocks.loadConfigState.mockResolvedValue({
      workspaceFolder,
      projectConfig: {},
      userConfig: {}
    })
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (server == null) {
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
    await rm(workspaceFolder, { recursive: true, force: true })
    await rm(homeFolder, { recursive: true, force: true })
    workspaceFolder = ''
    homeFolder = ''
    if (originalHome == null) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
    vi.clearAllMocks()
  })

  it('persists returned adapter account artifacts after the manage action succeeds', async () => {
    mocks.loadAdapter.mockResolvedValue({
      manageAccount: vi.fn().mockResolvedValue({
        accountKey: 'work',
        artifacts: [
          { path: 'auth.json', content: '{"token":"demo"}\n' },
          { path: 'meta.json', content: '{"title":"Work"}\n' }
        ],
        message: 'Connected account.'
      }),
      getAccountDetail: vi.fn().mockResolvedValue({
        account: {
          key: 'work',
          title: 'Work',
          status: 'ready'
        }
      })
    })

    const response = await fetch(`${baseUrl}/api/adapters/codex/accounts/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'add',
        account: 'work'
      })
    })

    const payload = await response.json() as { account?: { key: string } }
    expect(response.status).toBe(200)
    expect(payload.account?.key).toBe('work')
    await expect(
      readFile(
        resolveProjectHomePath(
          workspaceFolder,
          process.env,
          '.local',
          'adapters',
          'codex',
          'accounts',
          'work',
          'auth.json'
        ),
        'utf8'
      )
    ).resolves.toBe('{"token":"demo"}\n')
  })

  it('returns adapter account detail through the dedicated detail route', async () => {
    mocks.loadAdapter.mockResolvedValue({
      getAccountDetail: vi.fn().mockResolvedValue({
        account: {
          key: 'work',
          title: 'Work',
          status: 'ready',
          quota: {
            summary: 'Plan: Pro'
          }
        }
      })
    })

    const response = await fetch(`${baseUrl}/api/adapters/codex/accounts/work`)
    const payload = await response.json() as { account?: { key: string; quota?: { summary?: string } } }

    expect(response.status).toBe(200)
    expect(payload.account?.key).toBe('work')
    expect(payload.account?.quota?.summary).toBe('Plan: Pro')
  })

  it('returns empty accounts when the adapter package has not been cached yet', async () => {
    const error = new Error(
      "Cannot find module '@oneworks/adapter-codex'\nRequire stack:\n- /workspace/__oneworks_adapter_loader__.cjs"
    ) as NodeJS.ErrnoException
    error.code = 'MODULE_NOT_FOUND'
    mocks.loadAdapter.mockRejectedValue(error)

    const response = await fetch(`${baseUrl}/api/adapters/codex/accounts`)
    const payload = await response.json() as { accounts?: unknown[] }

    expect(response.status).toBe(200)
    expect(payload.accounts).toEqual([])
  })
})
