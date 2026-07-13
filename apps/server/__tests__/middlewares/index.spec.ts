import http from 'node:http'

import Koa from 'koa'
import { afterEach, describe, expect, it } from 'vitest'

import type { ServerEnv } from '@oneworks/core'

import { initMiddlewares } from '#~/middlewares/index.js'

const createEnv = (allowCors: boolean, corsOrigin?: string): ServerEnv => ({
  __ONEWORKS_PROJECT_SERVER_HOST__: '127.0.0.1',
  __ONEWORKS_PROJECT_SERVER_PORT__: 0,
  __ONEWORKS_PROJECT_SERVER_WS_PATH__: '/ws',
  __ONEWORKS_PROJECT_SERVER_DATA_DIR__: '.data',
  __ONEWORKS_PROJECT_SERVER_LOG_DIR__: '.logs',
  __ONEWORKS_PROJECT_SERVER_LOG_LEVEL__: 'info',
  __ONEWORKS_PROJECT_SERVER_DEBUG__: false,
  __ONEWORKS_PROJECT_SERVER_ALLOW_CORS__: allowCors,
  ...(corsOrigin == null ? {} : { __ONEWORKS_PROJECT_SERVER_CORS_ORIGIN__: corsOrigin })
})

describe('initMiddlewares', () => {
  let server: http.Server | undefined

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
  })

  it('only enables CORS when the env flag is true', async () => {
    const createResponse = async (allowCors: boolean) => {
      const app = new Koa()
      await initMiddlewares(app, createEnv(allowCors))
      app.use(async (ctx) => {
        ctx.body = { ok: true }
      })

      server = http.createServer(app.callback())
      await new Promise<void>((resolve) => {
        server!.listen(0, '127.0.0.1', () => resolve())
      })

      const address = server.address()
      if (address == null || typeof address === 'string') {
        throw new Error('Failed to start middleware test server')
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/api/test`, {
        headers: {
          Origin: 'https://client.example'
        }
      })

      await new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
      server = undefined

      return response
    }

    const disabledResponse = await createResponse(false)
    expect(disabledResponse.headers.get('access-control-allow-origin')).toBeNull()

    const enabledResponse = await createResponse(true)
    expect(enabledResponse.headers.get('access-control-allow-origin')).toBe('https://client.example')
  })

  it('limits CORS to configured origins when an allowlist is provided', async () => {
    const createResponse = async (origin: string) => {
      const app = new Koa()
      await initMiddlewares(app, createEnv(true, 'https://client.example, https://other-client.example'))
      app.use(async (ctx) => {
        ctx.body = { ok: true }
      })

      server = http.createServer(app.callback())
      await new Promise<void>((resolve) => {
        server!.listen(0, '127.0.0.1', () => resolve())
      })

      const address = server.address()
      if (address == null || typeof address === 'string') {
        throw new Error('Failed to start middleware test server')
      }

      const response = await fetch(`http://127.0.0.1:${address.port}/api/test`, {
        headers: { Origin: origin }
      })

      await new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
      server = undefined

      return response
    }

    const allowedResponse = await createResponse('https://client.example')
    expect(allowedResponse.headers.get('access-control-allow-origin')).toBe('https://client.example')

    const blockedResponse = await createResponse('https://blocked.example')
    expect(blockedResponse.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('allows the workspace client-origin header during CORS preflight', async () => {
    const app = new Koa()
    await initMiddlewares(app, createEnv(true, 'https://client.example'))
    app.use(async (ctx) => {
      ctx.body = { ok: true }
    })

    server = http.createServer(app.callback())
    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve())
    })

    const address = server.address()
    if (address == null || typeof address === 'string') {
      throw new Error('Failed to start middleware test server')
    }
    const response = await fetch(`http://127.0.0.1:${address.port}/api/test`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://client.example',
        'Access-Control-Request-Headers': 'x-oneworks-client-origin',
        'Access-Control-Request-Method': 'GET'
      }
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-headers'))
      .toContain('X-OneWorks-Client-Origin')
  })

  it('restricts public host access to channel webhook paths plus configured extra paths', async () => {
    const app = new Koa()
    await initMiddlewares(app, createEnv(false), {
      publicPaths: ['/status/*', 'relative-path-is-ignored']
    })
    app.use(async (ctx) => {
      ctx.body = { path: ctx.path }
    })

    server = http.createServer(app.callback())
    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve())
    })

    const address = server.address()
    if (address == null || typeof address === 'string') {
      throw new Error('Failed to start middleware test server')
    }
    const baseUrl = `http://127.0.0.1:${address.port}`

    const publicAllowed = await fetch(`${baseUrl}/channels/wechat/erjie/webhook`, {
      headers: { 'x-forwarded-host': 'bot.example.com' }
    })
    const configuredAllowed = await fetch(`${baseUrl}/status/health`, {
      headers: { 'x-forwarded-host': 'bot.example.com' }
    })
    const ignoredRelativePath = await fetch(`${baseUrl}/relative-path-is-ignored`, {
      headers: { 'x-forwarded-host': 'bot.example.com' }
    })
    const publicBlocked = await fetch(`${baseUrl}/api/sessions`, {
      headers: { 'x-forwarded-host': 'bot.example.com' }
    })
    const localAllowed = await fetch(`${baseUrl}/api/sessions`)

    expect(publicAllowed.status).toBe(200)
    expect(await publicAllowed.json()).toEqual({ path: '/channels/wechat/erjie/webhook' })
    expect(configuredAllowed.status).toBe(200)
    expect(await configuredAllowed.json()).toEqual({ path: '/status/health' })
    expect(ignoredRelativePath.status).toBe(404)
    expect(publicBlocked.status).toBe(404)
    expect(localAllowed.status).toBe(200)
  })
})
