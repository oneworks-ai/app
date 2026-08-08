import http from 'node:http'

import Router from '@koa/router'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiEnvelopeMiddleware } from '#~/middlewares/api-envelope.js'
import { moduleUpdatesRouter } from '#~/routes/module-updates.js'

const mocks = vi.hoisted(() => ({
  installModuleUpdate: vi.fn()
}))

vi.mock('#~/services/module-updates.js', async importOriginal => ({
  ...await importOriginal<typeof import('#~/services/module-updates.js')>(),
  installModuleUpdate: mocks.installModuleUpdate
}))

const closeServer = async (server: http.Server | undefined) => {
  await new Promise<void>((resolve, reject) => {
    if (server == null) return resolve()
    server.close(error => error ? reject(error) : resolve())
  })
}

describe('module update routes', () => {
  let baseUrl = ''
  let server: http.Server | undefined

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.installModuleUpdate.mockImplementation(async (id: string) => ({ installedId: id }))

    const app = new Koa()
    const rootRouter = new Router({ prefix: '/api/module-updates' })
    const routes = moduleUpdatesRouter()
    rootRouter.use(routes.routes())
    rootRouter.use(routes.allowedMethods())
    app.use(apiEnvelopeMiddleware())
    app.use(bodyParser())
    app.use(rootRouter.routes())
    app.use(rootRouter.allowedMethods())

    server = http.createServer(app.callback())
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address == null || typeof address === 'string') throw new Error('Failed to start test server')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    await closeServer(server)
    server = undefined
    baseUrl = ''
  })

  it('forwards the model provider catalog install request to the service', async () => {
    const response = await fetch(`${baseUrl}/api/module-updates/catalog%3Amodel-providers/install`, {
      body: JSON.stringify({ version: '1.0.0-rc.2' }),
      headers: {
        'Accept-Language': 'en',
        'Content-Type': 'application/json'
      },
      method: 'POST'
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: { installedId: 'catalog:model-providers' },
      success: true
    })
    expect(mocks.installModuleUpdate).toHaveBeenCalledWith(
      'catalog:model-providers',
      { language: 'en', version: '1.0.0-rc.2' }
    )
  })

  it.each([
    'web',
    'client',
    'server',
    'adapter:codex',
    'plugin:logger'
  ])('continues forwarding the existing %s target', async (id) => {
    const response = await fetch(`${baseUrl}/api/module-updates/${encodeURIComponent(id)}/install`, {
      headers: { 'Accept-Language': 'en' },
      method: 'POST'
    })

    expect(response.status).toBe(200)
    expect(mocks.installModuleUpdate).toHaveBeenCalledWith(id, { language: 'en', version: undefined })
  })

  it.each([
    ['adapter:not-registered', 'module_update_id_invalid'],
    ['not a module id', 'module_update_id_invalid'],
    [' ', 'module_update_id_required']
  ])('rejects the invalid target %j with a stable client error', async (id, code) => {
    const response = await fetch(`${baseUrl}/api/module-updates/${encodeURIComponent(id)}/install`, {
      method: 'POST'
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code },
      success: false
    })
    expect(mocks.installModuleUpdate).not.toHaveBeenCalled()
  })
})
