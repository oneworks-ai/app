import http from 'node:http'

import Router from '@koa/router'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ManagedPluginSourceTransportError } from '@oneworks/managed-plugins'

import { apiEnvelopeMiddleware } from '#~/middlewares/api-envelope.js'
import { pluginsRouter } from '#~/routes/plugins.js'

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  reload: vi.fn(),
  setPluginMarketplaceSelection: vi.fn()
}))

vi.mock('#~/utils/logger.js', () => ({
  logger: { error: mocks.loggerError }
}))

vi.mock('#~/services/plugins/index.js', () => ({
  getPluginManager: () => ({ reload: mocks.reload })
}))

vi.mock('#~/services/plugins/marketplace-selection.js', () => ({
  setPluginMarketplaceSelection: mocks.setPluginMarketplaceSelection
}))

describe('plugin marketplace selection route', () => {
  let baseUrl = ''
  let server: http.Server | undefined

  beforeEach(async () => {
    vi.clearAllMocks()
    const app = new Koa()
    const router = new Router({ prefix: '/api/plugins' })
    const pluginRouter = pluginsRouter()
    router.use(pluginRouter.routes())
    router.use(pluginRouter.allowedMethods())
    app.use(apiEnvelopeMiddleware())
    app.use(bodyParser())
    app.use(router.routes())
    app.use(router.allowedMethods())
    server = http.createServer(app.callback())
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address == null || typeof address === 'string') throw new Error('Test server did not bind a port.')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (server == null) return resolve()
      server.close(error => error == null ? resolve() : reject(error))
    })
  })

  it('reloads the selected project runtime before returning install success', async () => {
    let releaseReload: (() => void) | undefined
    const reloadPromise = new Promise<void>((resolve) => {
      releaseReload = resolve
    })
    mocks.setPluginMarketplaceSelection.mockResolvedValue([{
      action: 'installed',
      marketplace: 'openai-plugins',
      plugin: 'airtable'
    }])
    mocks.reload.mockReturnValue(reloadPromise)

    let responseSettled = false
    const responsePromise = fetch(`${baseUrl}/api/plugins/marketplace/plugins/openai-plugins/airtable/selection`, {
      body: JSON.stringify({ enabled: true, target: 'project' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })
    responsePromise.then(() => {
      responseSettled = true
    })

    await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalledOnce())
    expect(responseSettled).toBe(false)
    releaseReload?.()
    const response = await responsePromise

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        results: [{ action: 'installed', marketplace: 'openai-plugins', plugin: 'airtable' }]
      }
    })
    expect(mocks.setPluginMarketplaceSelection).toHaveBeenCalledWith({
      enabled: true,
      marketplace: 'openai-plugins',
      plugin: 'airtable',
      target: 'project'
    })
    expect(mocks.reload).toHaveBeenCalledOnce()
    expect(mocks.setPluginMarketplaceSelection.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.reload.mock.invocationCallOrder[0]!)
  })

  it('returns an exposed retryable response when the marketplace Git source cannot be retrieved', async () => {
    const credentialUrl = 'https://user:secret@example.invalid/plugin.git'
    const privatePath = '/private/marketplace/source/credential.txt'
    const transportError = new ManagedPluginSourceTransportError()
    Object.defineProperty(transportError, 'cause', {
      value: new Error(`fatal: ${credentialUrl} at ${privatePath}`)
    })
    mocks.setPluginMarketplaceSelection.mockRejectedValue(transportError)

    const response = await fetch(`${baseUrl}/api/plugins/marketplace/plugins/openai-plugins/airtable/selection`, {
      body: JSON.stringify({ enabled: true, target: 'project' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {
        code: 'plugin_marketplace_source_unavailable',
        message: 'The plugin source is temporarily unavailable. Try again.'
      }
    })
    expect(mocks.reload).not.toHaveBeenCalled()
    expect(mocks.loggerError).toHaveBeenCalledTimes(1)
    const logContext = mocks.loggerError.mock.calls[0]?.[0] as { err?: unknown } | undefined
    expect(logContext?.err).toBeInstanceOf(Error)
    expect(logContext?.err).not.toHaveProperty('cause')
    const loggedError = logContext?.err as Error | undefined
    const loggedText = `${loggedError?.message ?? ''}\n${loggedError?.stack ?? ''}`
    expect(loggedText).not.toContain(credentialUrl)
    expect(loggedText).not.toContain(privatePath)
  })
})
