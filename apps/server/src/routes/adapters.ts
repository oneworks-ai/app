/* eslint-disable max-lines -- adapter account routes share request normalization and response mapping. */

import Router from '@koa/router'
import { PassThrough } from 'node:stream'

import type {
  AdapterManageAccountOptions,
  AdapterManageAccountProgressEvent,
  AdapterManageAccountResult
} from '@oneworks/types'
import { persistAdapterAccountArtifacts, removeStoredAdapterAccount } from '@oneworks/utils'

import { createServerAdapterAccountContext, isMissingAdapterPackageError } from '#~/services/adapter-accounts.js'
import { badRequest, internalServerError, isHttpError } from '#~/utils/http.js'
import { safeJsonStringify } from '#~/utils/json.js'

const runAdapterAccountAction = async (
  params: {
    adapterKey: string
    input: AdapterManageAccountOptions & { action: AdapterManageAccountOptions['action'] }
    onProgress?: (event: AdapterManageAccountProgressEvent) => void
    signal: AbortSignal
  }
): Promise<AdapterManageAccountResult> => {
  const { adapterKey, input, onProgress, signal } = params
  const { workspaceFolder, adapter, adapterCtx } = await createServerAdapterAccountContext(adapterKey)
  if (adapter.manageAccount == null) {
    throw badRequest(
      `Adapter "${adapterKey}" does not support account management.`,
      undefined,
      'adapter_account_manage_unsupported'
    )
  }
  const result = await adapter.manageAccount(adapterCtx, { ...input, onProgress, signal })
  if ((result.artifacts ?? []).length > 0) {
    if (result.accountKey == null || result.accountKey.trim() === '') {
      throw badRequest('Adapter account action returned artifacts without an account key.', {
        adapter: adapterKey,
        action: input.action
      }, 'adapter_account_missing_storage_key')
    }
    await persistAdapterAccountArtifacts({
      cwd: workspaceFolder,
      env: adapterCtx.env,
      adapter: adapterKey,
      account: result.accountKey,
      artifacts: result.artifacts ?? []
    })
  }
  if (result.removeStoredAccount === true) {
    if (result.accountKey == null || result.accountKey.trim() === '') {
      throw badRequest('Adapter account remove action requires an account key.', {
        adapter: adapterKey,
        action: input.action
      }, 'adapter_account_missing_remove_key')
    }
    await removeStoredAdapterAccount({
      cwd: workspaceFolder,
      env: adapterCtx.env,
      adapter: adapterKey,
      account: result.accountKey
    })
  }
  const detail = result.account == null && result.accountKey != null && result.accountKey.trim() !== '' &&
      adapter.getAccountDetail != null
    ? await adapter.getAccountDetail(adapterCtx, { account: result.accountKey, model: input.model, refresh: true })
      .catch(() => undefined)
    : undefined
  const { artifacts: _artifacts, ...publicResult } = result
  return { ...publicResult, ...(detail != null ? { account: detail.account } : {}) }
}

const streamAdapterAccountAction = (
  ctx: Router.RouterContext,
  adapterKey: string,
  input: AdapterManageAccountOptions & { action: AdapterManageAccountOptions['action'] }
) => {
  const stream = new PassThrough()
  const abortController = new AbortController()
  let closed = false
  ctx.state.skipApiEnvelope = true
  ctx.status = 200
  ctx.type = 'text/event-stream'
  ctx.set('Cache-Control', 'no-cache, no-transform')
  ctx.set('Connection', 'keep-alive')
  ctx.set('X-Accel-Buffering', 'no')
  ctx.body = stream
  const write = (value: string) => {
    if (!closed) stream.write(value)
  }
  const writeEvent = (value: unknown) => write(`data: ${safeJsonStringify(value)}\n\n`)
  const abort = () => {
    if (!abortController.signal.aborted) abortController.abort(new Error('Adapter account request aborted by client.'))
  }
  const onClose = () => {
    if (!ctx.res.writableEnded) abort()
  }
  const heartbeat = setInterval(() => write(': heartbeat\n\n'), 15_000)
  ctx.req.once('aborted', abort)
  ctx.res.once('close', onClose)
  write(': connected\n\n')
  void runAdapterAccountAction({
    adapterKey,
    input,
    signal: abortController.signal,
    onProgress: event => {
      if (event.phase != null) writeEvent({ type: 'progress', phase: event.phase })
    }
  }).then(result => writeEvent({ type: 'result', result })).catch(error => {
    if (abortController.signal.aborted) return
    const httpError = isHttpError(error)
      ? error
      : internalServerError('Failed to run adapter account action', {
        code: 'adapter_account_action_failed',
        cause: error,
        details: { adapter: adapterKey }
      })
    writeEvent({
      type: 'error',
      error: {
        code: httpError.code,
        message: httpError.expose ? httpError.message : 'Internal Server Error',
        status: httpError.status,
        ...(httpError.details !== undefined ? { details: httpError.details } : {})
      }
    })
  }).finally(() => {
    closed = true
    clearInterval(heartbeat)
    ctx.req.off('aborted', abort)
    ctx.res.off('close', onClose)
    stream.end()
  })
}

const normalizeAdapterKey = (value: unknown) => (
  typeof value === 'string' ? value.trim() : ''
)

export function adaptersRouter(): Router {
  const router = new Router()

  router.get('/:adapter/accounts', async (ctx) => {
    const adapterKey = normalizeAdapterKey(ctx.params.adapter)
    if (adapterKey === '') {
      throw badRequest('Invalid adapter', { adapter: ctx.params.adapter }, 'invalid_adapter')
    }

    try {
      const { adapter, adapterCtx } = await createServerAdapterAccountContext(adapterKey)
      if (adapter.getAccounts == null) {
        ctx.body = {
          accounts: []
        }
        return
      }

      const model = typeof ctx.query.model === 'string' ? ctx.query.model : undefined
      const account = typeof ctx.query.account === 'string' ? ctx.query.account : undefined
      const refresh = ctx.query.refresh === '1' || ctx.query.refresh === 'true'

      ctx.body = await adapter.getAccounts(adapterCtx, {
        model,
        account,
        refresh
      })
    } catch (error) {
      if (isHttpError(error)) {
        throw error
      }
      if (isMissingAdapterPackageError(error, adapterKey)) {
        ctx.body = {
          accounts: []
        }
        return
      }
      throw internalServerError(
        'Failed to load adapter accounts',
        {
          code: 'adapter_accounts_load_failed',
          cause: error,
          details: { adapter: adapterKey }
        }
      )
    }
  })

  router.get('/:adapter/accounts/:account', async (ctx) => {
    const adapterKey = normalizeAdapterKey(ctx.params.adapter)
    const accountKey = normalizeAdapterKey(ctx.params.account)
    if (adapterKey === '') {
      throw badRequest('Invalid adapter', { adapter: ctx.params.adapter }, 'invalid_adapter')
    }
    if (accountKey === '') {
      throw badRequest('Invalid account', { account: ctx.params.account }, 'invalid_account')
    }

    try {
      const { adapter, adapterCtx } = await createServerAdapterAccountContext(adapterKey)
      if (adapter.getAccountDetail == null) {
        throw badRequest(
          `Adapter "${adapterKey}" does not support account detail.`,
          undefined,
          'adapter_account_detail_unsupported'
        )
      }

      const model = typeof ctx.query.model === 'string' ? ctx.query.model : undefined
      const refresh = ctx.query.refresh === '1' || ctx.query.refresh === 'true'

      ctx.body = await adapter.getAccountDetail(adapterCtx, {
        account: accountKey,
        model,
        refresh
      })
    } catch (error) {
      if (isHttpError(error)) {
        throw error
      }
      throw internalServerError(
        'Failed to load adapter account detail',
        {
          code: 'adapter_account_detail_load_failed',
          cause: error,
          details: {
            adapter: adapterKey,
            account: accountKey
          }
        }
      )
    }
  })

  router.post('/:adapter/accounts/actions', async (ctx) => {
    const adapterKey = normalizeAdapterKey(ctx.params.adapter)
    if (adapterKey === '') {
      throw badRequest('Invalid adapter', { adapter: ctx.params.adapter }, 'invalid_adapter')
    }

    const body = (ctx.request.body ?? {}) as {
      action?: unknown
      account?: unknown
      creditId?: unknown
      operationId?: unknown
      model?: unknown
      refresh?: unknown
    }
    const action = typeof body.action === 'string' ? body.action.trim() : ''
    const account = typeof body.account === 'string' ? body.account.trim() : undefined
    const creditId = typeof body.creditId === 'string' ? body.creditId.trim() : undefined
    const operationId = typeof body.operationId === 'string' ? body.operationId.trim() : undefined
    const model = typeof body.model === 'string' ? body.model.trim() : undefined
    const refresh = body.refresh === true || body.refresh === 'true' || body.refresh === 1 || body.refresh === '1'

    if (
      action !== 'add' &&
      action !== 'reauthenticate' &&
      action !== 'refresh' &&
      action !== 'remove' &&
      action !== 'consume-reset-credit'
    ) {
      throw badRequest('Invalid account action', { action: body.action }, 'invalid_adapter_account_action')
    }
    if (action === 'consume-reset-credit' && (operationId == null || operationId === '')) {
      throw badRequest(
        'Reset credit consumption requires an operation ID.',
        undefined,
        'adapter_account_operation_id_required'
      )
    }

    const input = {
      action: action as AdapterManageAccountOptions['action'],
      account,
      creditId,
      operationId,
      model,
      refresh
    }
    if (ctx.query.stream === 'true' || ctx.query.stream === '1') {
      streamAdapterAccountAction(ctx, adapterKey, input)
      return
    }

    const abortController = new AbortController()
    const abortOnRequestClose = () => {
      if (!abortController.signal.aborted) {
        abortController.abort(new Error('Adapter account request aborted by client.'))
      }
    }
    ctx.req.once('aborted', abortOnRequestClose)
    ctx.res.once('close', abortOnRequestClose)

    try {
      ctx.body = await runAdapterAccountAction({ adapterKey, input, signal: abortController.signal })
    } catch (error) {
      if (abortController.signal.aborted) {
        return
      }
      if (isHttpError(error)) throw error
      throw internalServerError('Failed to run adapter account action', {
        code: 'adapter_account_action_failed',
        cause: error,
        details: { adapter: adapterKey }
      })
    } finally {
      ctx.req.off('aborted', abortOnRequestClose)
      ctx.res.off('close', abortOnRequestClose)
    }
  })

  return router
}
