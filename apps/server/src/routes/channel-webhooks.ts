import Router from '@koa/router'

import { handleChannelWebhook } from '#~/channels/webhook.js'

const toHeaderRecord = (headers: Record<string, string | string[] | undefined>) => headers

const toQueryRecord = (query: Record<string, unknown>) => {
  const result: Record<string, string | string[] | undefined> = {}
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string' || Array.isArray(value)) {
      result[key] = value as string | string[]
    }
  }
  return result
}

const getRequestRawBody = (ctx: Parameters<Router.Middleware>[0]) => {
  const request = ctx.request as typeof ctx.request & { rawBody?: string }
  if (typeof request.rawBody === 'string') {
    return request.rawBody
  }
  if (request.body instanceof Uint8Array) {
    return request.body
  }
  return undefined
}

const handleWebhookRoute: Router.Middleware = async (ctx) => {
  const result = await handleChannelWebhook({
    channelType: ctx.params.channelType,
    channelKey: ctx.params.channelKey,
    method: ctx.method,
    headers: toHeaderRecord(ctx.headers),
    query: toQueryRecord(ctx.query),
    body: ctx.method === 'GET' ? undefined : ctx.request.body,
    rawBody: getRequestRawBody(ctx)
  })

  ctx.status = result.statusCode ?? 200
  for (const [key, value] of Object.entries(result.headers ?? {})) {
    ctx.set(key, value)
  }
  ctx.body = result.body ?? ''
}

export function channelWebhooksRouter(): Router {
  const router = new Router()

  router.get('/:channelType/:channelKey/webhook', handleWebhookRoute)
  router.post('/:channelType/:channelKey/webhook', handleWebhookRoute)

  return router
}
