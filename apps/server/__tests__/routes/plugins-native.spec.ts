import http from 'node:http'

import Router from '@koa/router'
import Koa from 'koa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { pluginsRouter } from '#~/routes/plugins.js'

const mocks = vi.hoisted(() => ({
  listNativeHostPlugins: vi.fn()
}))

vi.mock('#~/services/plugins/native-host.js', () => ({
  listNativeHostPlugins: mocks.listNativeHostPlugins
}))

describe('plugins native Home route', () => {
  let server: http.Server | undefined
  let baseUrl = ''

  beforeEach(async () => {
    const app = new Koa()
    const rootRouter = new Router({ prefix: '/api/plugins' })
    const router = pluginsRouter()
    rootRouter.use(router.routes())
    app.use(rootRouter.routes())
    server = http.createServer(app.callback())
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address == null || typeof address === 'string') throw new Error('Failed to start test server')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server?.close(error => error == null ? resolve() : reject(error)))
    vi.clearAllMocks()
  })

  it('returns native plugins from a sibling endpoint without runtime activation', async () => {
    mocks.listNativeHostPlugins.mockResolvedValue({
      diagnostics: [],
      plugins: [{
        adapter: 'codex',
        capabilities: {
          discover: 'available',
          disable: 'read-only',
          enable: 'read-only',
          import: 'read-only',
          install: 'read-only',
          uninstall: 'unsupported',
          update: 'read-only'
        },
        id: 'opaque-id',
        name: 'browser',
        scope: 'builtin',
        source: { kind: 'managed' },
        state: 'enabled'
      }]
    })

    const response = await fetch(`${baseUrl}/api/plugins/native`)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      plugins: [{ adapter: 'codex', id: 'opaque-id', name: 'browser' }]
    })
    expect(mocks.listNativeHostPlugins).toHaveBeenCalledOnce()
  })
})
