import { createServer } from 'node:http'
import { createRequire } from 'node:module'

import Koa from 'koa'
import { afterEach, describe, expect, it } from 'vitest'

import { installWebDebugChii } from '../../src/services/web-debug/chii'

const originalTlsOverride = process.env.NODE_TLS_REJECT_UNAUTHORIZED
const nodeRequire = createRequire(__filename)

describe('web debug chii', () => {
  afterEach(() => {
    if (originalTlsOverride == null) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTlsOverride
    }
  })

  it('does not disable TLS certificate verification for the server process', () => {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
    const app = new Koa()
    const server = createServer(app.callback())

    installWebDebugChii({ app, server })

    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined()
  })

  it('keeps the optional chii runtime out of the server startup critical path', () => {
    const routerPath = nodeRequire.resolve('chii/server/middle/router')
    const websocketPath = nodeRequire.resolve('chii/server/lib/WebSocketServer')
    delete nodeRequire.cache[routerPath]
    delete nodeRequire.cache[websocketPath]
    const app = new Koa()
    const server = createServer(app.callback())

    installWebDebugChii({ app, server })

    expect(nodeRequire.cache[routerPath]).toBeUndefined()
    expect(nodeRequire.cache[websocketPath]).toBeUndefined()
  })

  it('initializes the deferred runtime on the first chii request', async () => {
    const routerPath = nodeRequire.resolve('chii/server/middle/router')
    delete nodeRequire.cache[routerPath]
    const app = new Koa()
    const server = createServer(app.callback())
    installWebDebugChii({ app, server })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })

    try {
      const address = server.address()
      if (address == null || typeof address === 'string') throw new Error('Missing test server port')
      const response = await fetch(`http://127.0.0.1:${address.port}/__oneworks_chii__/targets`)

      expect(response.status).toBe(200)
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
      expect(nodeRequire.cache[routerPath]).toBeDefined()
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error == null ? resolve() : reject(error))
      })
    }
  })
})
