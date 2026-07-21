import http from 'node:http'

import Router from '@koa/router'
import type { Context, Next } from 'koa'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { worktreeEnvironmentsRouter } from '#~/routes/worktree-environments.js'
import { WorktreeEnvironmentImportError } from '#~/services/worktree-environment-import.js'
import { HttpError } from '#~/utils/http.js'

const mocks = vi.hoisted(() => ({
  deleteWorktreeEnvironment: vi.fn(),
  getWorktreeEnvironment: vi.fn(),
  importWorktreeEnvironmentsFromAdapter: vi.fn(),
  listWorktreeEnvironmentImporters: vi.fn(),
  listWorktreeEnvironments: vi.fn(),
  saveWorktreeEnvironment: vi.fn()
}))

vi.mock('#~/services/worktree-environment-import.js', async importOriginal => ({
  ...await importOriginal<typeof import('#~/services/worktree-environment-import.js')>(),
  importWorktreeEnvironmentsFromAdapter: mocks.importWorktreeEnvironmentsFromAdapter,
  listWorktreeEnvironmentImporters: mocks.listWorktreeEnvironmentImporters
}))

vi.mock('#~/services/worktree-environments.js', () => ({
  deleteWorktreeEnvironment: mocks.deleteWorktreeEnvironment,
  getWorktreeEnvironment: mocks.getWorktreeEnvironment,
  listWorktreeEnvironments: mocks.listWorktreeEnvironments,
  saveWorktreeEnvironment: mocks.saveWorktreeEnvironment
}))

const closeServer = async (server: http.Server | undefined) => {
  await new Promise<void>((resolve, reject) => {
    if (server == null) return resolve()
    server.close(error => error ? reject(error) : resolve())
  })
}

describe('worktree environment routes', () => {
  let server: http.Server | undefined
  let baseUrl = ''

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.listWorktreeEnvironmentImporters.mockResolvedValue({ importers: [] })
    mocks.getWorktreeEnvironment.mockResolvedValue({
      id: 'importers',
      isLocal: false,
      path: '/workspace/.oo/env/importers',
      scripts: [],
      source: 'project'
    })

    const app = new Koa()
    const rootRouter = new Router({ prefix: '/api/worktree-environments' })
    const routes = worktreeEnvironmentsRouter()
    rootRouter.use(routes.routes())
    rootRouter.use(routes.allowedMethods())
    app.use(async (ctx: Context, next: Next) => {
      try {
        await next()
      } catch (error) {
        const httpError = error instanceof HttpError ? error : undefined
        ctx.status = httpError?.status ?? 500
        ctx.body = {
          error: {
            code: httpError?.code ?? 'internal_error',
            message: httpError?.message ?? 'Internal server error',
            ...(httpError?.details == null ? {} : { details: httpError.details })
          }
        }
      }
    })
    app.use(bodyParser())
    app.use(rootRouter.routes())
    app.use(rootRouter.allowedMethods())

    server = http.createServer(app.callback())
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address == null || typeof address === 'string') throw new Error('Failed to start test server')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    await closeServer(server)
    server = undefined
    baseUrl = ''
  })

  it('keeps the historical environment id "importers" addressable', async () => {
    const response = await fetch(`${baseUrl}/api/worktree-environments/importers`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      environment: { id: 'importers', source: 'project' }
    })
    expect(mocks.getWorktreeEnvironment).toHaveBeenCalledWith('importers', undefined, undefined)
    expect(mocks.listWorktreeEnvironmentImporters).not.toHaveBeenCalled()
  })

  it('lists import adapters under a non-overlapping route namespace', async () => {
    mocks.listWorktreeEnvironmentImporters.mockResolvedValue({
      importers: [{
        adapterKey: 'codex',
        runtimeAdapter: 'codex',
        supportedSources: ['project', 'user'],
        title: 'Codex environments'
      }]
    })

    const response = await fetch(`${baseUrl}/api/worktree-environments/imports/adapters`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      importers: [{ adapterKey: 'codex' }]
    })
    expect(mocks.getWorktreeEnvironment).not.toHaveBeenCalled()
  })

  it('forwards adapter and source through the import route', async () => {
    const result = {
      adapterKey: 'codex',
      environmentCount: 1,
      existingEnvironmentIds: [],
      found: true,
      importedEnvironmentIds: ['node'],
      skippedActionCount: 0,
      skippedEnvironmentCount: 0,
      source: 'project',
      warningCount: 1
    }
    mocks.importWorktreeEnvironmentsFromAdapter.mockResolvedValue(result)

    const response = await fetch(`${baseUrl}/api/worktree-environments/imports/codex`, {
      body: JSON.stringify({ source: 'project' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(result)
    expect(mocks.importWorktreeEnvironmentsFromAdapter).toHaveBeenCalledWith({
      adapterKey: 'codex',
      source: 'project'
    })
  })

  it.each(
    [
      ['worktree_environment_importer_not_found', 404],
      ['invalid_import_source', 400],
      ['invalid_worktree_environment_import_result', 500]
    ] as const
  )('maps %s import errors to HTTP %i', async (code, expectedStatus) => {
    mocks.importWorktreeEnvironmentsFromAdapter.mockRejectedValue(
      new WorktreeEnvironmentImportError(
        code,
        'Mapped import failure',
        { adapterKey: 'codex' }
      )
    )

    const response = await fetch(`${baseUrl}/api/worktree-environments/imports/codex`, {
      body: JSON.stringify({ source: 'project' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })

    expect(response.status).toBe(expectedStatus)
    await expect(response.json()).resolves.toMatchObject({
      error: { code, message: 'Mapped import failure' }
    })
  })

  it('does not expose unknown import errors', async () => {
    mocks.importWorktreeEnvironmentsFromAdapter.mockRejectedValue(new Error('secret failure'))

    const response = await fetch(`${baseUrl}/api/worktree-environments/imports/codex`, {
      body: JSON.stringify({ source: 'project' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    })
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload).toMatchObject({
      error: {
        code: 'worktree_environment_import_failed',
        message: 'Failed to import worktree environments'
      }
    })
    expect(JSON.stringify(payload)).not.toContain('secret failure')
  })
})
