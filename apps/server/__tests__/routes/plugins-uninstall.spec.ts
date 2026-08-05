import http from 'node:http'

import Router from '@koa/router'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiEnvelopeMiddleware } from '#~/middlewares/api-envelope.js'
import { pluginsRouter } from '#~/routes/plugins.js'

const mocks = vi.hoisted(() => ({
  getPlan: vi.fn(),
  reload: vi.fn(),
  uninstall: vi.fn()
}))

vi.mock('#~/services/plugins/index.js', () => ({
  getPluginManager: () => ({
    reload: mocks.reload
  })
}))

vi.mock('#~/services/plugins/marketplace-uninstall.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#~/services/plugins/marketplace-uninstall.js')>()
  return {
    ...actual,
    getPluginMarketplaceUninstallPlan: mocks.getPlan,
    uninstallPluginMarketplacePlugin: mocks.uninstall
  }
})

describe('plugin uninstall routes', () => {
  let server: http.Server | undefined
  let baseUrl = ''

  beforeEach(async () => {
    vi.clearAllMocks()
    const app = new Koa()
    const rootRouter = new Router({ prefix: '/api/plugins' })
    const router = pluginsRouter()
    rootRouter.use(router.routes())
    rootRouter.use(router.allowedMethods())
    app.use(apiEnvelopeMiddleware())
    app.use(bodyParser())
    app.use(rootRouter.routes())
    app.use(rootRouter.allowedMethods())
    server = http.createServer(app.callback())
    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (address == null || typeof address === 'string') throw new Error('Failed to start route test server')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server?.close(error => error == null ? resolve() : reject(error))
    })
  })

  it('returns stable unavailable reasons without exposing filesystem paths', async () => {
    mocks.getPlan.mockResolvedValue({
      available: false,
      reason: 'local-plugin'
    })
    const response = await fetch(`${baseUrl}/api/plugins/local/uninstall-plan`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: {
        available: false,
        reason: 'local-plugin'
      },
      success: true
    })
    expect(mocks.getPlan).toHaveBeenCalledWith('local')
  })

  it('passes only scope and the opaque plan token to the uninstall service', async () => {
    const token = 'a'.repeat(64)
    mocks.uninstall.mockResolvedValue({
      identity: {
        adapter: 'claude',
        marketplace: 'team',
        plugin: 'reviewer',
        scope: 'review'
      },
      removed: true
    })
    const response = await fetch(`${baseUrl}/api/plugins/review/uninstall`, {
      body: JSON.stringify({ token }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })

    expect(response.status).toBe(200)
    expect(mocks.uninstall).toHaveBeenCalledWith({
      scope: 'review',
      token
    })
    expect(mocks.reload).not.toHaveBeenCalled()
  })

  it('rejects invalid tokens before invoking the service', async () => {
    const response = await fetch(`${baseUrl}/api/plugins/review/uninstall`, {
      body: JSON.stringify({ token: '/tmp/plugin' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'invalid_plugin_uninstall_request',
        message: '"token" must be a valid uninstall plan token.'
      },
      success: false
    })
    expect(mocks.uninstall).not.toHaveBeenCalled()
  })

  it('maps stale plans to a path-free conflict response', async () => {
    const { PluginMarketplaceUninstallStaleError } = await import(
      '#~/services/plugins/marketplace-uninstall.js'
    )
    mocks.uninstall.mockRejectedValue(new PluginMarketplaceUninstallStaleError())
    const response = await fetch(`${baseUrl}/api/plugins/review/uninstall`, {
      body: JSON.stringify({ token: 'b'.repeat(64) }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'plugin_uninstall_plan_stale',
        message: 'The uninstall plan is stale. Request a new plan and retry.'
      },
      success: false
    })
  })

  it('does not expose internal paths from removal failures', async () => {
    mocks.uninstall.mockRejectedValue(new Error('cleanup failed'))
    const response = await fetch(`${baseUrl}/api/plugins/review/uninstall`, {
      body: JSON.stringify({ token: 'c'.repeat(64) }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'internal_server_error',
        message: 'Internal Server Error'
      },
      success: false
    })
  })
})
