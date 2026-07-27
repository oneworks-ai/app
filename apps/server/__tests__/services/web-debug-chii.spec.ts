import { createServer } from 'node:http'

import Koa from 'koa'
import { afterEach, describe, expect, it } from 'vitest'

import { installWebDebugChii } from '../../src/services/web-debug/chii'

const originalTlsOverride = process.env.NODE_TLS_REJECT_UNAUTHORIZED

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
})
