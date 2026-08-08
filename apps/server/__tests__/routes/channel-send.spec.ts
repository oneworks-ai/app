import http from 'node:http'

import Koa from 'koa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const clearChannelDebugOutboundMessages = vi.fn()
const invokeChannelCommand = vi.fn()
const listChannelCommandToolsForRuntime = vi.fn()
const listChannelDebugOutboundMessages = vi.fn()
const sendChannelMessage = vi.fn()

vi.mock('#~/channels/index.js', () => ({
  clearChannelDebugOutboundMessages,
  invokeChannelCommand,
  listChannelCommandToolsForRuntime,
  listChannelDebugOutboundMessages,
  sendChannelMessage
}))

describe('channel API routes', () => {
  let server: http.Server | undefined
  let baseUrl = ''

  beforeEach(async () => {
    vi.resetModules()
    clearChannelDebugOutboundMessages.mockReset()
    invokeChannelCommand.mockReset()
    listChannelCommandToolsForRuntime.mockReset()
    listChannelDebugOutboundMessages.mockReset()
    sendChannelMessage.mockReset()

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

  it('reads channel debug outbound messages', async () => {
    listChannelDebugOutboundMessages.mockReturnValue({
      ok: true,
      messages: [
        {
          messageId: 'oneworks-out-1',
          receiveId: 'room-1',
          receiveIdType: 'room',
          text: 'hello'
        }
      ]
    })

    const response = await fetch(`${baseUrl}/api/channels/oneworks-main/debug/outbound`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: {
        messages: [
          {
            messageId: 'oneworks-out-1',
            receiveId: 'room-1',
            receiveIdType: 'room',
            text: 'hello'
          }
        ]
      },
      success: true
    })
    expect(listChannelDebugOutboundMessages).toHaveBeenCalledWith({
      channelKey: 'oneworks-main'
    })
  })

  it('clears channel debug outbound messages', async () => {
    clearChannelDebugOutboundMessages.mockResolvedValue({
      ok: true
    })

    const response = await fetch(`${baseUrl}/api/channels/oneworks-main/debug/outbound`, {
      method: 'DELETE'
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      data: { ok: true },
      success: true
    })
    expect(clearChannelDebugOutboundMessages).toHaveBeenCalledWith({
      channelKey: 'oneworks-main'
    })
  })
})
