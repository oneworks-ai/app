import http from 'node:http'

import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createJavaScriptErrorReport } from '@oneworks/diagnostics'

import { diagnosticsRouter } from '../../src/routes/diagnostics.js'

const { recordClientJavaScriptError } = vi.hoisted(() => ({
  recordClientJavaScriptError: vi.fn(async (_report: unknown) => ({
    recordedLocally: true,
    reported: false
  }))
}))

vi.mock('#~/services/javascript-diagnostics.js', () => ({
  recordClientJavaScriptError
}))

let server: http.Server | undefined

afterEach(async () => {
  recordClientJavaScriptError.mockClear()
  await new Promise<void>((resolve, reject) => {
    if (server == null) return resolve()
    server.close(error => error == null ? resolve() : reject(error))
  })
  server = undefined
})

const startRoute = async () => {
  const app = new Koa()
  app.use(async (ctx, next) => {
    try {
      await next()
    } catch (error) {
      ctx.status = (error as { status?: number }).status ?? 500
      ctx.body = { code: (error as { code?: string }).code }
    }
  })
  app.use(bodyParser())
  app.use(diagnosticsRouter().routes())
  server = http.createServer(app.callback())
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address == null || typeof address === 'string') throw new Error('Failed to start test server.')
  return `http://127.0.0.1:${address.port}`
}

describe('javascript diagnostics route', () => {
  it('accepts only the bounded safe report contract', async () => {
    const baseUrl = await startRoute()
    const report = createJavaScriptErrorReport(new Error('private prompt'), {
      source: 'client.window_error',
      surface: 'web'
    })
    const accepted = await fetch(`${baseUrl}/javascript-errors`, {
      body: JSON.stringify(report),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    })
    const rejected = await fetch(`${baseUrl}/javascript-errors`, {
      body: JSON.stringify({ ...report, fingerprint: 'raw stack and private path' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    })

    await expect(accepted.json()).resolves.toEqual({ accepted: true })
    expect(accepted.status).toBe(200)
    await expect(rejected.json()).resolves.toEqual({ code: 'invalid_javascript_error_report' })
    expect(rejected.status).toBe(400)
    expect(recordClientJavaScriptError).toHaveBeenCalledOnce()
    expect(JSON.stringify(recordClientJavaScriptError.mock.calls[0]?.[0])).not.toContain('private prompt')
  })
})
