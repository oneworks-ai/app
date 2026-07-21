import Router from '@koa/router'

import type { WorktreeEnvironmentSavePayload, WorktreeEnvironmentSource } from '@oneworks/types'

import {
  WorktreeEnvironmentImportError,
  importWorktreeEnvironmentsFromAdapter,
  listWorktreeEnvironmentImporters
} from '#~/services/worktree-environment-import.js'
import {
  deleteWorktreeEnvironment,
  getWorktreeEnvironment,
  listWorktreeEnvironments,
  saveWorktreeEnvironment
} from '#~/services/worktree-environments.js'
import { badRequest, internalServerError, notFound } from '#~/utils/http.js'

const ENVIRONMENT_ID_PATTERN = /^\w[\w.-]{0,127}$/

const assertEnvironmentIdParam = (id: string | undefined) => {
  if (typeof id !== 'string' || id.trim() === '') {
    throw badRequest('Worktree environment id is required', { id }, 'worktree_environment_id_required')
  }
  const normalized = id.trim()
  if (!ENVIRONMENT_ID_PATTERN.test(normalized)) {
    throw badRequest('Invalid worktree environment id', { id }, 'worktree_environment_id_invalid')
  }
  return normalized
}

const getSourceQuery = (value: unknown): WorktreeEnvironmentSource | undefined => {
  if (value === 'project' || value === 'user') {
    return value
  }
  return undefined
}

const asBodyRecord = (body: unknown): Record<string, unknown> => (
  body != null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
)

const handleImportError = (error: unknown): never => {
  if (error instanceof WorktreeEnvironmentImportError) {
    if (error.code === 'worktree_environment_importer_not_found') {
      throw notFound(error.message, error.details, error.code)
    }
    if (error.code === 'invalid_worktree_environment_import_result') {
      throw internalServerError(error.message, { code: error.code, details: error.details })
    }
    throw badRequest(error.message, error.details, error.code)
  }
  throw internalServerError('Failed to import worktree environments', {
    code: 'worktree_environment_import_failed'
  })
}

export function worktreeEnvironmentsRouter(): Router {
  const router = new Router()

  router.get(['/', ''], async (ctx) => {
    ctx.body = await listWorktreeEnvironments()
  })

  router.get('/imports/adapters', async (ctx) => {
    try {
      ctx.body = await listWorktreeEnvironmentImporters()
    } catch (error) {
      handleImportError(error)
    }
  })

  router.post('/imports/:adapterKey', async (ctx) => {
    try {
      ctx.body = await importWorktreeEnvironmentsFromAdapter({
        adapterKey: ctx.params.adapterKey,
        source: asBodyRecord(ctx.request.body).source
      })
    } catch (error) {
      handleImportError(error)
    }
  })

  router.get('/:id', async (ctx) => {
    const { id } = ctx.params as { id?: string }
    const environmentId = assertEnvironmentIdParam(id)
    const source = getSourceQuery(ctx.query.source)
    try {
      ctx.body = {
        environment: await getWorktreeEnvironment(environmentId, undefined, source)
      }
    } catch (error) {
      throw notFound(
        error instanceof Error ? error.message : 'Worktree environment not found',
        { id },
        'worktree_environment_not_found'
      )
    }
  })

  router.put('/:id', async (ctx) => {
    const { id } = ctx.params as { id?: string }
    const payload = (ctx.request.body ?? {}) as WorktreeEnvironmentSavePayload
    const source = getSourceQuery(ctx.query.source)
    ctx.body = {
      environment: await saveWorktreeEnvironment(assertEnvironmentIdParam(id), payload, undefined, source)
    }
  })

  router.delete('/:id', async (ctx) => {
    const { id } = ctx.params as { id?: string }
    const source = getSourceQuery(ctx.query.source)
    const removed = await deleteWorktreeEnvironment(assertEnvironmentIdParam(id), undefined, source)
    ctx.body = { ok: true, removed }
  })

  return router
}
