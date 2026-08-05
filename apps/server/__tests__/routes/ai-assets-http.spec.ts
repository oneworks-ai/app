import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import Router from '@koa/router'
import Koa from 'koa'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resetConfigCache } from '@oneworks/config'
import type { ServerEnv } from '@oneworks/core'

import { initMiddlewares } from '#~/middlewares/index.js'
import { aiRouter } from '#~/routes/ai.js'
import { createSessionToken } from '#~/services/auth/index.js'

const serverEnv = {
  __ONEWORKS_PROJECT_SERVER_HOST__: '127.0.0.1',
  __ONEWORKS_PROJECT_SERVER_PORT__: 0,
  __ONEWORKS_PROJECT_SERVER_WS_PATH__: '/ws',
  __ONEWORKS_PROJECT_SERVER_DATA_DIR__: '.data',
  __ONEWORKS_PROJECT_SERVER_LOG_DIR__: '.logs',
  __ONEWORKS_PROJECT_SERVER_LOG_LEVEL__: 'silent',
  __ONEWORKS_PROJECT_SERVER_DEBUG__: false,
  __ONEWORKS_PROJECT_SERVER_ALLOW_CORS__: false,
  __ONEWORKS_PROJECT_SERVER_ACTION_SECRET__: 'asset-http-test-secret'
} as ServerEnv

describe('asset create HTTP lifecycle', () => {
  let baseUrl = ''
  let server: http.Server | undefined
  let token = ''
  let workspace = ''
  const originalAuthority = process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
  const originalRole = process.env.__ONEWORKS_PROJECT_SERVER_ROLE__
  const originalAuthEnabled = process.env.__ONEWORKS_PROJECT_WEB_AUTH_ENABLED__

  const start = async (router = aiRouter()) => {
    const app = new Koa()
    await initMiddlewares(app, serverEnv)
    const mounted = new Router()
    mounted.use('/api/ai', router.routes(), router.allowedMethods())
    app.use(mounted.routes()).use(mounted.allowedMethods())
    server = http.createServer(app.callback())
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address == null || typeof address === 'string') throw new Error('Missing test server address')
    baseUrl = `http://127.0.0.1:${address.port}`
  }

  const rawPost = async (
    chunks: string[],
    headers: Record<string, string> = {},
    authenticated = true
  ) => (
    await new Promise<{ body: unknown; status: number }>((resolve, reject) => {
      const request = http.request(`${baseUrl}/api/ai/assets`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
          ...headers
        }
      }, response => {
        const body: Buffer[] = []
        response.on('data', chunk => body.push(chunk))
        response.on('end', () => {
          const text = Buffer.concat(body).toString('utf8')
          let parsed: unknown
          try {
            parsed = JSON.parse(text)
          } catch {
            parsed = undefined
          }
          resolve({ body: parsed, status: response.statusCode ?? 0 })
        })
      })
      request.once('error', reject)
      chunks.forEach(chunk => request.write(chunk))
      request.end()
    })
  )

  beforeEach(async () => {
    workspace = await mkdtemp(path.join(os.tmpdir(), 'ow-ai-http-'))
    await mkdir(path.join(workspace, '.oo'), { recursive: true })
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspace
    process.env.__ONEWORKS_PROJECT_SERVER_ROLE__ = 'workspace'
    process.env.__ONEWORKS_PROJECT_WEB_AUTH_ENABLED__ = 'true'
    resetConfigCache()
    token = await createSessionToken(serverEnv, 'asset-test', 60_000)
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (server == null) return resolve()
      server.close(error => error == null ? resolve() : reject(error))
    })
    server = undefined
    await rm(workspace, { recursive: true, force: true })
    if (originalAuthority == null) delete process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
    else process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = originalAuthority
    if (originalRole == null) delete process.env.__ONEWORKS_PROJECT_SERVER_ROLE__
    else process.env.__ONEWORKS_PROJECT_SERVER_ROLE__ = originalRole
    if (originalAuthEnabled == null) delete process.env.__ONEWORKS_PROJECT_WEB_AUTH_ENABLED__
    else process.env.__ONEWORKS_PROJECT_WEB_AUTH_ENABLED__ = originalAuthEnabled
    resetConfigCache()
  })

  it('mounts body parsing, loader, route, auth, and success envelope for a committed create', async () => {
    await start()
    const response = await rawPost([JSON.stringify({ kind: 'rule', name: 'HTTP Review' })])

    expect(response.status).toBe(201)
    expect(response.body).toEqual({
      success: true,
      data: {
        asset: {
          commitState: 'committed-degraded',
          kind: 'rule',
          path: '.oo/rules/http-review.md',
          warnings: ['asset_private_staging_retained']
        }
      }
    })
  })

  it('bounds omitted-length chunked bodies before the general 32 MiB parser', async () => {
    await start()
    const response = await rawPost(
      ['{"kind":"rule","name":"', 'x'.repeat(17 * 1024), '"}'],
      {},
      false
    )

    expect(response.status).toBe(413)
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'asset_request_too_large',
        details: { committed: false }
      }
    })
  })

  it('rejects a declared oversized body without collecting it', async () => {
    await start()
    const response = await rawPost([], { 'content-length': String(17 * 1024) }, false)

    expect(response.status).toBe(413)
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'asset_request_too_large',
        details: { committed: false }
      }
    })
  })

  it('authenticates only after the bounded endpoint reader has consumed a valid body', async () => {
    await start()
    const response = await rawPost(
      [JSON.stringify({ kind: 'rule', name: 'Unauthenticated Review' })],
      {},
      false
    )

    expect(response.status).toBe(401)
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'auth_required',
        details: { committed: false }
      }
    })
  })

  it('rejects an understated Content-Length and closes before trailing bytes can be pipelined', async () => {
    await start()
    const response = await rawPost([
      JSON.stringify({ kind: 'rule', name: 'Smuggled Review' })
    ], { 'content-length': '1' })

    expect(response.status).toBe(400)
    expect(response.body).toBeUndefined()
  })

  it('preserves a lost real publisher response as a 202 indeterminate success envelope', async () => {
    await start(aiRouter({ publishOperations: { fault: 'response-after-visible' } }))
    const response = await rawPost([JSON.stringify({ kind: 'entity', name: 'Indeterminate' })])

    expect(response.status).toBe(202)
    expect(response.body).toMatchObject({
      success: true,
      data: {
        asset: {
          commitState: 'committed-indeterminate',
          kind: 'entity',
          path: '.oo/entities/indeterminate.md',
          warnings: ['asset_publisher_response_lost', 'asset_private_staging_retained']
        }
      }
    })
  })
})
