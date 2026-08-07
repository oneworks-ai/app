import { mkdtemp, readFile, rm } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import Router from '@koa/router'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdapterCtx } from '@oneworks/types'
import { resolveProjectHomePath } from '@oneworks/utils/ai-path'

import { adaptersRouter } from '#~/routes/adapters.js'

declare module '@oneworks/types' {
  interface Cache {
    'test.adapter-account-request-count': number
  }
}

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
  resolveAdapterRuntimeTarget: (type: string) => ({
    instanceKey: type,
    loadSpecifier: type,
    runtimeAdapter: type
  }),
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

  it('forwards account reauthentication to the adapter', async () => {
    const manageAccount = vi.fn().mockResolvedValue({
      accountKey: 'work',
      account: {
        key: 'work',
        title: 'Work',
        status: 'ready'
      }
    })
    mocks.loadAdapter.mockResolvedValue({ manageAccount })

    const response = await fetch(`${baseUrl}/api/adapters/codex/accounts/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'reauthenticate',
        account: 'work'
      })
    })

    expect(response.status).toBe(200)
    expect(manageAccount).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'reauthenticate',
        account: 'work'
      })
    )
  })

  it('keeps the reauthentication request pending until the adapter finishes', async () => {
    let completeManageAccount: (() => void) | undefined
    let manageSignal: AbortSignal | undefined
    const manageAccount = vi.fn().mockImplementation(async (
      _adapterCtx: AdapterCtx,
      options: { signal?: AbortSignal }
    ) =>
      await new Promise(resolve => {
        manageSignal = options.signal
        completeManageAccount = () =>
          resolve({
            accountKey: 'work',
            account: { key: 'work', title: 'Work', status: 'ready' }
          })
      })
    )
    mocks.loadAdapter.mockResolvedValue({ manageAccount })

    let responseSettled = false
    const responsePromise = fetch(`${baseUrl}/api/adapters/codex/accounts/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reauthenticate', account: 'work' })
    }).then((response) => {
      responseSettled = true
      return response
    })

    await vi.waitFor(() => expect(manageAccount).toHaveBeenCalledOnce())
    expect(responseSettled).toBe(false)
    expect(manageSignal?.aborted).toBe(false)

    completeManageAccount?.()
    const response = await responsePromise
    expect(response.status).toBe(200)
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

  it('shares adapter account cache across HTTP request contexts for the same workspace', async () => {
    mocks.loadAdapter.mockResolvedValue({
      getAccountDetail: vi.fn().mockImplementation(async (adapterCtx: AdapterCtx) => {
        const previous = await adapterCtx.cache.get('test.adapter-account-request-count') ?? 0
        await adapterCtx.cache.set('test.adapter-account-request-count', previous + 1)
        return {
          account: {
            key: 'work',
            title: `Request ${previous + 1}`,
            status: 'ready'
          }
        }
      })
    })

    const firstResponse = await fetch(`${baseUrl}/api/adapters/codex/accounts/work`)
    const secondResponse = await fetch(`${baseUrl}/api/adapters/codex/accounts/work`)
    const firstPayload = await firstResponse.json() as { account?: { title?: string } }
    const secondPayload = await secondResponse.json() as { account?: { title?: string } }

    expect(firstPayload.account?.title).toBe('Request 1')
    expect(secondPayload.account?.title).toBe('Request 2')
  })

  it('forwards reset credit consumption to the adapter account manager', async () => {
    const manageAccount = vi.fn().mockResolvedValue({
      accountKey: 'work',
      outcome: 'reset',
      message: 'Reset credit used.'
    })
    mocks.loadAdapter.mockResolvedValue({
      manageAccount,
      getAccountDetail: vi.fn().mockResolvedValue({
        account: {
          key: 'work',
          title: 'Work',
          status: 'ready',
          quota: {
            rateLimitResetCredits: {
              availableCount: 1,
              canConsume: true
            }
          }
        }
      })
    })

    const response = await fetch(`${baseUrl}/api/adapters/codex/accounts/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'consume-reset-credit',
        account: 'work',
        creditId: 'credit-a',
        operationId: 'reset-credit-operation-a'
      })
    })
    const payload = await response.json() as {
      outcome?: string
      account?: { quota?: { rateLimitResetCredits?: { availableCount?: number } } }
    }

    expect(response.status).toBe(200)
    expect(payload.outcome).toBe('reset')
    expect(payload.account?.quota?.rateLimitResetCredits?.availableCount).toBe(1)
    expect(manageAccount).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'consume-reset-credit',
        account: 'work',
        creditId: 'credit-a',
        operationId: 'reset-credit-operation-a'
      })
    )
  })

  it('rejects reset credit consumption without a caller operation ID', async () => {
    const manageAccount = vi.fn()
    mocks.loadAdapter.mockResolvedValue({ manageAccount })

    const response = await fetch(`${baseUrl}/api/adapters/codex/accounts/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'consume-reset-credit',
        account: 'work',
        creditId: 'credit-a'
      })
    })
    expect(response.status).toBe(400)
    expect(manageAccount).not.toHaveBeenCalled()
  })

  it('returns account detail from the manage result without probing the account again', async () => {
    const getAccountDetail = vi.fn()
    mocks.loadAdapter.mockResolvedValue({
      manageAccount: vi.fn().mockResolvedValue({
        accountKey: 'work',
        account: {
          key: 'work',
          title: 'Work',
          status: 'ready',
          quota: {
            rateLimitResetCredits: {
              availableCount: 2,
              canConsume: true,
              credits: [
                { id: 'credit-a', status: 'available' },
                { id: 'credit-b', status: 'available' }
              ]
            }
          }
        },
        message: 'Quota refreshed.'
      }),
      getAccountDetail
    })

    const response = await fetch(`${baseUrl}/api/adapters/codex/accounts/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'refresh',
        account: 'work'
      })
    })
    const payload = await response.json() as {
      account?: {
        quota?: {
          rateLimitResetCredits?: {
            credits?: Array<{ id: string }>
          }
        }
      }
    }

    expect(response.status).toBe(200)
    expect(payload.account?.quota?.rateLimitResetCredits?.credits).toHaveLength(2)
    expect(getAccountDetail).not.toHaveBeenCalled()
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
