/* eslint-disable max-lines -- provider action routes keep related model-service endpoints together. */
import Router from '@koa/router'

import type {
  ModelServiceConfig,
  ProviderManagementTokenCreateInput,
  ProviderManagementTokenUpdateInput
} from '@oneworks/types'

import {
  ModelProvidersServiceError,
  createModelServiceManagementToken,
  createModelServiceSecret,
  deleteModelServiceManagementToken,
  getModelProviderStatus,
  getModelServiceBalance,
  getModelServiceManagementSnapshot,
  getModelServiceManagementTokenProfile,
  getModelServiceStatus,
  listModelServiceModels,
  listProviderCatalog,
  probeModelProvider,
  updateModelServiceManagementToken
} from '#~/services/model-providers/index.js'
import { ProviderActionError } from '#~/services/model-providers/provider-client.js'
import { HttpError, badRequest, internalServerError, notFound } from '#~/utils/http.js'

const asBodyRecord = (body: unknown): Record<string, unknown> => (
  body != null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
)

const mapProviderActionError = (error: ProviderActionError) => {
  if (
    error.code === 'invalid_provider_config' ||
    error.code === 'missing_api_key' ||
    error.code === 'provider_unsupported'
  ) {
    return badRequest(error.message, { code: error.code }, error.code)
  }
  const status = error.code === 'upstream_unauthorized'
    ? 401
    : error.code === 'upstream_forbidden'
    ? 403
    : error.code === 'upstream_rate_limited'
    ? 429
    : error.code === 'upstream_unavailable'
    ? 503
    : error.code === 'upstream_request_rejected'
    ? 502
    : 502
  return new HttpError(status, error.code, error.message, { status: error.status })
}

const mapServiceError = (error: ModelProvidersServiceError) => {
  if (error.code === 'model_service_not_found') return notFound(error.message, error.details, error.code)
  return badRequest(error.message, error.details, error.code)
}

const handleProviderError = (error: unknown) => {
  if (error instanceof ProviderActionError) throw mapProviderActionError(error)
  if (error instanceof ModelProvidersServiceError) throw mapServiceError(error)
  throw internalServerError('Failed to handle model provider request', {
    cause: error,
    code: 'model_provider_request_failed'
  })
}

export function modelProvidersRouter(): Router {
  const router = new Router()

  router.get('/', (ctx) => {
    ctx.body = listProviderCatalog()
  })

  router.post('/probe', (ctx) => {
    const body = asBodyRecord(ctx.request.body)
    const service = asBodyRecord(body.service) as unknown as ModelServiceConfig
    ctx.body = probeModelProvider(service)
  })

  router.get('/:providerId/status', async (ctx) => {
    try {
      ctx.body = await getModelProviderStatus(ctx.params.providerId)
    } catch (error) {
      handleProviderError(error)
    }
  })

  return router
}

export function modelServicesRouter(): Router {
  const router = new Router()

  router.post('/:serviceKey/models/list', async (ctx) => {
    try {
      ctx.body = await listModelServiceModels({
        serviceKey: ctx.params.serviceKey,
        draft: asBodyRecord(ctx.request.body).service,
        source: asBodyRecord(ctx.request.body).source
      })
    } catch (error) {
      handleProviderError(error)
    }
  })

  router.post('/:serviceKey/balance', async (ctx) => {
    try {
      ctx.body = await getModelServiceBalance({
        serviceKey: ctx.params.serviceKey,
        draft: asBodyRecord(ctx.request.body).service,
        source: asBodyRecord(ctx.request.body).source
      })
    } catch (error) {
      handleProviderError(error)
    }
  })

  router.post('/:serviceKey/status', async (ctx) => {
    try {
      ctx.body = await getModelServiceStatus({
        serviceKey: ctx.params.serviceKey,
        draft: asBodyRecord(ctx.request.body).service,
        source: asBodyRecord(ctx.request.body).source
      })
    } catch (error) {
      handleProviderError(error)
    }
  })

  router.post('/:serviceKey/secrets', async (ctx) => {
    try {
      ctx.body = await createModelServiceSecret({
        serviceKey: ctx.params.serviceKey,
        draft: asBodyRecord(ctx.request.body).service,
        source: asBodyRecord(ctx.request.body).source
      })
    } catch (error) {
      handleProviderError(error)
    }
  })

  router.post('/:serviceKey/management', async (ctx) => {
    try {
      ctx.body = await getModelServiceManagementSnapshot({
        serviceKey: ctx.params.serviceKey,
        draft: asBodyRecord(ctx.request.body).service,
        source: asBodyRecord(ctx.request.body).source
      })
    } catch (error) {
      handleProviderError(error)
    }
  })

  router.post('/:serviceKey/management/tokens', async (ctx) => {
    const body = asBodyRecord(ctx.request.body)
    try {
      ctx.body = await createModelServiceManagementToken({
        serviceKey: ctx.params.serviceKey,
        draft: body.service,
        input: asBodyRecord(body.input) as unknown as ProviderManagementTokenCreateInput,
        source: body.source
      })
    } catch (error) {
      handleProviderError(error)
    }
  })

  router.post('/:serviceKey/management/tokens/:tokenId/profile', async (ctx) => {
    const body = asBodyRecord(ctx.request.body)
    try {
      ctx.body = await getModelServiceManagementTokenProfile({
        serviceKey: ctx.params.serviceKey,
        draft: body.service,
        source: body.source,
        tokenId: ctx.params.tokenId
      })
    } catch (error) {
      handleProviderError(error)
    }
  })

  router.put('/:serviceKey/management/tokens/:tokenId', async (ctx) => {
    const body = asBodyRecord(ctx.request.body)
    try {
      ctx.body = await updateModelServiceManagementToken({
        serviceKey: ctx.params.serviceKey,
        draft: body.service,
        input: {
          ...asBodyRecord(body.input),
          id: ctx.params.tokenId
        } as ProviderManagementTokenUpdateInput,
        source: body.source
      })
    } catch (error) {
      handleProviderError(error)
    }
  })

  router.delete('/:serviceKey/management/tokens/:tokenId', async (ctx) => {
    const body = asBodyRecord(ctx.request.body)
    try {
      ctx.body = await deleteModelServiceManagementToken({
        serviceKey: ctx.params.serviceKey,
        draft: body.service,
        source: body.source,
        tokenId: ctx.params.tokenId
      })
    } catch (error) {
      handleProviderError(error)
    }
  })

  return router
}
