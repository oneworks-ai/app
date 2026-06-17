import http from 'node:http'

import Koa from 'koa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handleChannelWebhook = vi.fn()

vi.mock('#~/channels/webhook.js', () => ({
  handleChannelWebhook
}))

describe('channel webhook routes', () => {
  let server: http.Server | undefined
  let baseUrl = ''

  beforeEach(async () => {
    vi.resetModules()
    handleChannelWebhook.mockReset()

    const app = new Koa()
    const { initMiddlewares } = await import('#~/middlewares/index.js')
    const { mountRoutes } = await import('#~/routes/index.js')
    await initMiddlewares(app)
    await mountRoutes(
      app,
      {
        __ONEWORKS_PROJECT_SERVER_HOST__: '127.0.0.1',
        __ONEWORKS_PROJECT_SERVER_PORT__: 0,
        __ONEWORKS_PROJECT_SERVER_WS_PATH__: '/ws'
      } as Parameters<typeof mountRoutes>[1]
    )

    server = http.createServer(app.callback())
    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (address == null || typeof address === 'string') {
      throw new Error('Failed to start test server')
    }
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
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
  })

  it('passes public webhook requests to the channel manager', async () => {
    handleChannelWebhook.mockResolvedValue({
      statusCode: 202,
      headers: {
        'x-channel-webhook': 'ok'
      },
      body: 'accepted'
    })

    const response = await fetch(`${baseUrl}/channels/wechat/default/webhook?secret=s1`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        TypeName: 'AddMsg'
      })
    })

    expect(response.status).toBe(202)
    expect(response.headers.get('x-channel-webhook')).toBe('ok')
    expect(await response.text()).toBe('accepted')
    expect(handleChannelWebhook).toHaveBeenCalledWith({
      channelType: 'wechat',
      channelKey: 'default',
      method: 'POST',
      headers: expect.objectContaining({
        'content-type': 'application/json'
      }),
      query: {
        secret: 's1'
      },
      body: {
        TypeName: 'AddMsg'
      },
      rawBody: JSON.stringify({
        TypeName: 'AddMsg'
      })
    })
  })

  it('passes GET webhook verification requests to the channel manager', async () => {
    handleChannelWebhook.mockResolvedValue({
      statusCode: 200,
      headers: {
        'content-type': 'text/plain'
      },
      body: 'challenge-ok'
    })

    const response = await fetch(`${baseUrl}/channels/qq/default/webhook?signature=sig&echostr=hello`, {
      method: 'GET'
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('challenge-ok')
    expect(handleChannelWebhook).toHaveBeenCalledWith({
      channelType: 'qq',
      channelKey: 'default',
      method: 'GET',
      headers: expect.any(Object),
      query: {
        signature: 'sig',
        echostr: 'hello'
      },
      body: undefined,
      rawBody: undefined
    })
  })
})
