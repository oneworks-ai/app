import { createServer } from 'node:http'

import Router from '@koa/router'
import Koa from 'koa'
import { describe, expect, it, vi } from 'vitest'

import { mountRoutes } from '../../src/routes'
import { mountLazyRouter } from '../../src/routes/lazy-router'

const mocks = vi.hoisted(() => ({ authModuleLoads: 0 }))

vi.mock('../../src/routes/auth', async () => {
  const { default: Router } = await vi.importActual<{
    default: typeof import('@koa/router')
  }>('@koa/router')
  mocks.authModuleLoads += 1
  return {
    authRouter: () => {
      const router = new Router()
      router.get('/status', (ctx) => {
        ctx.body = { authenticated: true }
      })
      return router
    }
  }
})

describe('route startup loading', () => {
  it('loads a route module on its first matching request instead of during server startup', async () => {
    const app = new Koa()
    await mountRoutes(app, {
      __ONEWORKS_PROJECT_CLIENT_BASE__: '/ui/',
      __ONEWORKS_PROJECT_CLIENT_MODE__: 'none'
    } as never)

    expect(mocks.authModuleLoads).toBe(0)

    const server = createServer(app.callback())
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    try {
      const address = server.address()
      if (address == null || typeof address === 'string') throw new Error('Missing test server port')
      const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/status`)

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({ authenticated: true })
      expect(mocks.authModuleLoads).toBe(1)

      const unsupportedMethodResponse = await fetch(
        `http://127.0.0.1:${address.port}/api/auth/status`,
        { method: 'POST' }
      )
      expect(unsupportedMethodResponse.status).toBe(405)
      expect(unsupportedMethodResponse.headers.get('allow')).toContain('GET')
      expect(mocks.authModuleLoads).toBe(1)
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error == null ? resolve() : reject(error))
      })
    }
  })

  it('deduplicates concurrent first requests and keeps child 404 semantics', async () => {
    const app = new Koa()
    const parentRouter = new Router()
    let announceLoaderStarted!: () => void
    let resolveRouter!: (router: Router) => void
    const loaderStarted = new Promise<void>((resolve) => {
      announceLoaderStarted = resolve
    })
    const routerPromise = new Promise<Router>((resolve) => {
      resolveRouter = resolve
    })
    const load = vi.fn(async () => {
      announceLoaderStarted()
      return await routerPromise
    })
    mountLazyRouter(parentRouter, '/api/lazy', load)
    app.use(parentRouter.routes()).use(parentRouter.allowedMethods())

    const server = createServer(app.callback())
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    try {
      const address = server.address()
      if (address == null || typeof address === 'string') throw new Error('Missing test server port')
      const requestUrl = `http://127.0.0.1:${address.port}/api/lazy/ready`
      const firstResponsePromise = fetch(requestUrl)
      const secondResponsePromise = fetch(requestUrl)
      await loaderStarted

      expect(load).toHaveBeenCalledTimes(1)

      const childRouter = new Router()
      childRouter.get('/ready', (ctx) => {
        ctx.body = { ready: true }
      })
      resolveRouter(childRouter)

      const responses = await Promise.all([firstResponsePromise, secondResponsePromise])
      expect(responses.map(response => response.status)).toEqual([200, 200])
      expect(load).toHaveBeenCalledTimes(1)

      const missingResponse = await fetch(`http://127.0.0.1:${address.port}/api/lazy/missing`)
      expect(missingResponse.status).toBe(404)
      expect(load).toHaveBeenCalledTimes(1)
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error == null ? resolve() : reject(error))
      })
    }
  })

  it('keeps a more specific lazy namespace from loading its broader sibling', async () => {
    const app = new Koa()
    const parentRouter = new Router()
    const gitLoader = vi.fn(async () => {
      const router = new Router()
      router.get('/known', (ctx) => {
        ctx.body = { route: 'git' }
      })
      return router
    })
    const sessionsLoader = vi.fn(async () => {
      const router = new Router()
      router.get('/:id', (ctx) => {
        ctx.body = { route: 'session' }
      })
      return router
    })
    mountLazyRouter(parentRouter, '/api/sessions/:sessionId/git', gitLoader)
    mountLazyRouter(parentRouter, '/api/sessions', sessionsLoader)
    app.use(parentRouter.routes()).use(parentRouter.allowedMethods())

    const server = createServer(app.callback())
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    try {
      const address = server.address()
      if (address == null || typeof address === 'string') throw new Error('Missing test server port')
      const baseUrl = `http://127.0.0.1:${address.port}`

      const missingResponse = await fetch(`${baseUrl}/api/sessions/example/git/unknown`)
      expect(missingResponse.status).toBe(404)
      expect(gitLoader).toHaveBeenCalledTimes(1)
      expect(sessionsLoader).not.toHaveBeenCalled()

      const unsupportedMethodResponse = await fetch(
        `${baseUrl}/api/sessions/example/git/known`,
        { method: 'POST' }
      )
      expect(unsupportedMethodResponse.status).toBe(405)
      expect(unsupportedMethodResponse.headers.get('allow')).toContain('GET')
      expect(sessionsLoader).not.toHaveBeenCalled()

      const broadResponse = await fetch(`${baseUrl}/api/sessions/example`)
      expect(broadResponse.status).toBe(200)
      await expect(broadResponse.json()).resolves.toEqual({ route: 'session' })
      expect(sessionsLoader).toHaveBeenCalledTimes(1)
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error == null ? resolve() : reject(error))
      })
    }
  })
})
