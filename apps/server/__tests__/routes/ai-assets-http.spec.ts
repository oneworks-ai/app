import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import Router from '@koa/router'
import Koa from 'koa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetConfigCache } from '@oneworks/config'
import type { ServerEnv } from '@oneworks/core'
import type { FilesystemAuthority } from '@oneworks/fs-authority-native'
import type { FilesystemAuthorityTestOptions } from '@oneworks/fs-authority-native/testing'

import { initMiddlewares } from '#~/middlewares/index.js'
import { aiRouter } from '#~/routes/ai.js'
import type { AiRouterOptions } from '#~/routes/ai.js'
import { installAssetCreateConnectionGuard } from '#~/services/ai/asset-create-operation.js'
import { createSessionToken } from '#~/services/auth/index.js'

const serverEnv = {
  __ONEWORKS_PROJECT_SERVER_HOST__: '127.0.0.1',
  __ONEWORKS_PROJECT_SERVER_PORT__: 0,
  __ONEWORKS_PROJECT_SERVER_WS_PATH__: '/ws',
  __ONEWORKS_PROJECT_SERVER_DATA_DIR__: '.data',
  __ONEWORKS_PROJECT_SERVER_LOG_DIR__: '.logs',
  __ONEWORKS_PROJECT_SERVER_LOG_LEVEL__: 'error',
  __ONEWORKS_PROJECT_SERVER_DEBUG__: false,
  __ONEWORKS_PROJECT_SERVER_ALLOW_CORS__: false,
  __ONEWORKS_PROJECT_SERVER_ACTION_SECRET__: 'asset-http-test-secret'
} as ServerEnv

describe('asset create HTTP lifecycle with native authority', () => {
  let baseUrl = ''
  let broker: { close: () => Promise<void> } | undefined
  let controlRoot = ''
  let openAuthority: (
    workspaceRoot: string,
    fault?: FilesystemAuthorityTestOptions['fault']
  ) => Promise<FilesystemAuthority>
  let root = ''
  let secret = ''
  let server: http.Server | undefined
  let token = ''
  let workspace = ''
  const originalAuthority = process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
  const originalRole = process.env.__ONEWORKS_PROJECT_SERVER_ROLE__
  const originalAuthEnabled = process.env.__ONEWORKS_PROJECT_WEB_AUTH_ENABLED__

  const start = async (
    fault?: FilesystemAuthorityTestOptions['fault'],
    routerOptions: AiRouterOptions = {}
  ) => {
    const app = new Koa()
    await initMiddlewares(app, serverEnv)
    const mounted = new Router()
    mounted.use(
      '/api/ai',
      aiRouter({
        ...routerOptions,
        openAssetAuthority: workspaceRoot => openAuthority(workspaceRoot, fault)
      }).routes()
    )
    app.use(mounted.routes()).use(mounted.allowedMethods())
    server = http.createServer(app.callback())
    installAssetCreateConnectionGuard(server)
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address == null || typeof address === 'string') throw new Error('Missing test server address')
    baseUrl = `http://127.0.0.1:${address.port}`
  }

  const rawPost = async (chunks: string[], authenticated = true, requestPath = '/api/ai/assets') => (
    await new Promise<{ body: any; connection?: string; status: number }>((resolve, reject) => {
      const request = http.request(`${baseUrl}${requestPath}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authenticated ? { authorization: `Bearer ${token}` } : {})
        }
      }, response => {
        const body: Buffer[] = []
        response.on('data', chunk => body.push(chunk))
        response.on('end', () =>
          resolve({
            body: JSON.parse(Buffer.concat(body).toString('utf8')),
            connection: response.headers.connection,
            status: response.statusCode ?? 0
          }))
      })
      request.once('error', reject)
      chunks.forEach(chunk => request.write(chunk))
      request.end()
    })
  )

  const rawGet = async (requestPath: string, authenticated = true) => (
    await new Promise<{ body: any; status: number }>((resolve, reject) => {
      const request = http.request(`${baseUrl}${requestPath}`, {
        headers: authenticated ? { authorization: `Bearer ${token}` } : {}
      }, response => {
        const body: Buffer[] = []
        response.on('data', chunk => body.push(chunk))
        response.on('end', () =>
          resolve({
            body: JSON.parse(Buffer.concat(body).toString('utf8')),
            status: response.statusCode ?? 0
          }))
      })
      request.once('error', reject)
      request.end()
    })
  )

  const pollOperation = async (operationId: string) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await rawGet(`/api/ai/assets/operations/${operationId}?poll=${attempt}`)
      if (response.body?.data?.operation?.state !== 'pending') return response
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    throw new Error('Asset operation did not settle')
  }

  const createAndPoll = async (chunks: string[]) => {
    const accepted = await rawPost(chunks)
    expect(accepted).toMatchObject({
      status: 202,
      connection: 'close',
      body: { success: true, data: { operation: { state: 'pending' } } }
    })
    return pollOperation(accepted.body.data.operation.id)
  }

  const understatedPost = async (
    body: string,
    extra: string,
    beforeExtra: () => Promise<void>,
    afterExtra: () => void
  ) => {
    const url = new URL(baseUrl)
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = []
      const socket = net.createConnection(Number(url.port), url.hostname)
      socket.once('connect', () => {
        socket.write(`${
          [
            'POST /api/ai/assets HTTP/1.1',
            `Host: ${url.host}`,
            'Content-Type: application/json',
            `Authorization: Bearer ${token}`,
            `Content-Length: ${Buffer.byteLength(body)}`,
            'Connection: close',
            '',
            ''
          ].join('\r\n')
        }${body}`)
        void beforeExtra().then(async () => {
          await new Promise(resolveDelay => setTimeout(resolveDelay, 50))
          socket.write(extra)
          await new Promise(resolveDelay => setTimeout(resolveDelay, 10))
          afterExtra()
        }).catch(reject)
      })
      socket.on('data', chunk => chunks.push(chunk))
      socket.once('error', reject)
      socket.once('close', () => resolve(Buffer.concat(chunks).toString('utf8')))
    })
  }

  beforeEach(async () => {
    const native = await import('@oneworks/fs-authority-native/testing')
    root = await mkdtemp(path.join(os.tmpdir(), 'ow-ai-http-'))
    workspace = path.join(root, 'workspace')
    await mkdir(workspace)
    const prepared = native.prepareFilesystemAuthorityTestControlRoot(path.join(root, 'control'))
    controlRoot = prepared.controlRoot
    secret = prepared.secret
    broker = await native.startFilesystemAuthorityBroker(prepared)
    openAuthority = (workspaceRoot, fault) =>
      native.openFilesystemAuthorityForTest(workspaceRoot, {
        autoStart: false,
        controlRoot,
        secret,
        ...(fault == null ? {} : { fault })
      })
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspace
    process.env.__ONEWORKS_PROJECT_SERVER_ROLE__ = 'workspace'
    process.env.__ONEWORKS_PROJECT_WEB_AUTH_ENABLED__ = 'true'
    serverEnv.__ONEWORKS_PROJECT_SERVER_DATA_DIR__ = path.join(root, 'server-data')
    resetConfigCache()
    token = await createSessionToken(serverEnv, 'asset-test', 60_000)
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      if (server == null) return resolve()
      server.close(error => error == null ? resolve() : reject(error))
    })
    await broker?.close()
    await rm(root, { recursive: true, force: true })
    if (originalAuthority == null) delete process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__
    else process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = originalAuthority
    if (originalRole == null) delete process.env.__ONEWORKS_PROJECT_SERVER_ROLE__
    else process.env.__ONEWORKS_PROJECT_SERVER_ROLE__ = originalRole
    if (originalAuthEnabled == null) delete process.env.__ONEWORKS_PROJECT_WEB_AUTH_ENABLED__
    else process.env.__ONEWORKS_PROJECT_WEB_AUTH_ENABLED__ = originalAuthEnabled
    resetConfigCache()
  })

  it('mounts bounded body, auth, pending operation, loader, native publish, and status envelope', async () => {
    await start()
    const response = await createAndPoll([JSON.stringify({ kind: 'rule', name: 'HTTP Review' })])
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      success: true,
      data: { asset: { kind: 'rule', path: '.oo/rules/http-review.md' } }
    })
    await expect(readFile(path.join(workspace, '.oo/rules/http-review.md'), 'utf8'))
      .resolves.toContain('# HTTP Review')
  })

  it('binds native publication to the exact whitespace-bearing workspace authority', async () => {
    const adjacentWorkspace = workspace
    workspace = path.join(root, 'workspace ')
    await mkdir(workspace)
    process.env.__ONEWORKS_PROJECT_WORKSPACE_FOLDER__ = workspace
    await start()

    const response = await createAndPoll([JSON.stringify({ kind: 'rule', name: 'Raw Authority' })])

    expect(response.status).toBe(200)
    await expect(readFile(path.join(workspace, '.oo/rules/raw-authority.md'), 'utf8'))
      .resolves.toContain('# Raw Authority')
    await expect(readFile(path.join(adjacentWorkspace, '.oo/rules/raw-authority.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('bounds unauthenticated chunked bodies before auth and marks committed false', async () => {
    await start()
    const response = await rawPost(['{"kind":"rule","name":"', 'x'.repeat(17 * 1024), '"}'], false)
    expect(response.status).toBe(413)
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'asset_request_too_large', details: { committed: false } }
    })
  })

  it('protects status polling and classifies missing operations as indeterminate', async () => {
    await start()
    const requestPath = '/api/ai/assets/operations/00000000-0000-0000-0000-000000000000'
    const unauthorized = await rawGet(requestPath, false)
    expect(unauthorized.status).toBe(401)
    const missing = await rawGet(requestPath)
    expect(missing).toMatchObject({
      status: 404,
      body: {
        success: false,
        error: { code: 'asset_operation_unknown', details: { committed: 'indeterminate' } }
      }
    })
  })

  it('does not publish when a raw request understates Content-Length beyond the endpoint limit', async () => {
    const nativeOpen = openAuthority
    const authorityOpen = vi.fn(nativeOpen)
    openAuthority = authorityOpen
    let operationId = ''
    let markQueued!: () => void
    let releaseResponse!: () => void
    const queued = new Promise<void>(resolve => {
      markQueued = resolve
    })
    const responseGate = new Promise<void>(resolve => {
      releaseResponse = resolve
    })
    await start(undefined, {
      assetOperationHooks: {
        beforeResponse: () => responseGate,
        onQueued: (id) => {
          operationId = id
          markQueued()
        }
      }
    })
    const body = JSON.stringify({ kind: 'rule', name: 'Understated Length' })
    await understatedPost(body, 'x'.repeat(17 * 1024), () => queued, releaseResponse)
    const operation = await pollOperation(operationId)
    expect(operation).toMatchObject({
      status: 500,
      body: {
        success: false,
        error: { code: 'asset_request_transport_indeterminate', details: { committed: 'indeterminate' } }
      }
    })
    await expect(readFile(path.join(workspace, '.oo/rules/understated-length.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
    expect(authorityOpen).not.toHaveBeenCalled()
  })

  it('does not open authority after the commit connection is reset', async () => {
    const authorityOpen = vi.fn(openAuthority)
    openAuthority = authorityOpen
    let operationId = ''
    let markQueued!: () => void
    let releaseResponse!: () => void
    const queued = new Promise<void>(resolve => {
      markQueued = resolve
    })
    const responseGate = new Promise<void>(resolve => {
      releaseResponse = resolve
    })
    await start(undefined, {
      assetOperationHooks: {
        beforeResponse: () => responseGate,
        onQueued: (id) => {
          operationId = id
          markQueued()
        }
      }
    })
    const url = new URL(baseUrl)
    const body = JSON.stringify({ kind: 'rule', name: 'Reset Connection' })
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(Number(url.port), url.hostname)
      socket.once('connect', () => {
        socket.write(`${
          [
            'POST /api/ai/assets HTTP/1.1',
            `Host: ${url.host}`,
            'Content-Type: application/json',
            `Authorization: Bearer ${token}`,
            `Content-Length: ${Buffer.byteLength(body)}`,
            'Connection: close',
            '',
            ''
          ].join('\r\n')
        }${body}`)
        void queued.then(() => socket.resetAndDestroy()).catch(reject)
      })
      socket.once('error', () => undefined)
      socket.once('close', resolve)
    })
    releaseResponse()

    const operation = await pollOperation(operationId)
    expect(operation).toMatchObject({
      status: 500,
      body: {
        success: false,
        error: { code: 'asset_request_transport_indeterminate', details: { committed: 'indeterminate' } }
      }
    })
    expect(authorityOpen).not.toHaveBeenCalled()
    await expect(readFile(path.join(workspace, '.oo/rules/reset-connection.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    ['password hunter2', 'asset_secret_rejected'],
    ['Bearer abcdefghijkl', 'asset_secret_rejected'],
    [`ghp_${'a'.repeat(20)}`, 'asset_secret_rejected'],
    [`AKIA${'A'.repeat(16)}`, 'asset_secret_rejected'],
    ['sk-examplecredential', 'asset_secret_rejected']
  ])('rejects credential-like description %s before publication', async (description, code) => {
    await start()
    const response = await createAndPoll([
      JSON.stringify({ kind: 'rule', name: 'Credential Probe', description })
    ])
    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      success: false,
      error: { code, details: { committed: false } }
    })
    await expect(readFile(path.join(workspace, '.oo/rules/credential-probe.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    { kind: 'rule', name: 'Top Extra', unexpected: true },
    { kind: 'rule', name: 'Wrong Params', params: [{ name: 'forbidden' }] },
    { kind: 'spec', name: 'Nested Extra', params: [{ name: 'ok', unexpected: true }] },
    { kind: 'spec', name: 'Duplicate Params', params: [{ name: 'same' }, { name: 'SAME' }] },
    {
      kind: 'spec',
      name: 'Too Many Params',
      params: Array.from({ length: 31 }, (_, index) => ({ name: `param-${index}` }))
    }
  ])('strictly rejects recursive request shape %# before publication', async (input) => {
    await start()
    const response = await createAndPoll([JSON.stringify(input)])
    expect(response.status).toBe(400)
    expect(response.body).toMatchObject({
      success: false,
      error: { details: { committed: false } }
    })
  })

  it.each(['/api/ai/assets/', '/api/AI/ASSETS', '/API/AI/ASSETS/'])(
    'rejects noncanonical router alias %s before body parsing and auth',
    async (requestPath) => {
      await start()
      const response = await rawPost(
        ['{"kind":"rule","name":"', 'x'.repeat(17 * 1024), '"}'],
        false,
        requestPath
      )
      expect(response.status).toBe(404)
      expect(response.body).toMatchObject({
        success: false,
        error: { code: 'asset_route_not_found', details: { committed: false } }
      })
    }
  )

  it('returns 202 for post-visible identity ambiguity without deleting the target', async () => {
    await start('identity-probe')
    const response = await createAndPoll([JSON.stringify({ kind: 'entity', name: 'Indeterminate' })])
    expect(response.status).toBe(202)
    expect(response.body).toMatchObject({
      success: true,
      data: {
        asset: {
          commitState: 'committed-indeterminate',
          kind: 'entity',
          path: '.oo/entities/indeterminate.md',
          warnings: ['asset_target_identity_unconfirmed']
        }
      }
    })
    await expect(readFile(path.join(workspace, '.oo/entities/indeterminate.md'), 'utf8'))
      .resolves.toContain('# Indeterminate')
  })
})
