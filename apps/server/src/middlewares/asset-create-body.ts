import { Buffer } from 'node:buffer'

import type Koa from 'koa'

import { HttpError, badRequest } from '#~/utils/http.js'

export const ASSET_CREATE_BODY_LIMIT_BYTES = 16 * 1024

const isAssetCreateRequest = (ctx: Koa.Context) => (
  ctx.method === 'POST' && ctx.path === '/api/ai/assets'
)

export const assetCreateBodyMiddleware = (): Koa.Middleware => async (ctx, next) => {
  if (!isAssetCreateRequest(ctx)) return next()
  ctx.set('Connection', 'close')
  if (!ctx.is('application/json')) {
    throw new HttpError(415, 'asset_content_type_required', 'Asset requests must use application/json')
  }
  const declaredLength = ctx.get('content-length').trim()
  if (declaredLength !== '') {
    const parsedLength = Number(declaredLength)
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw badRequest('Invalid Content-Length', undefined, 'invalid_content_length')
    }
    if (parsedLength > ASSET_CREATE_BODY_LIMIT_BYTES) {
      throw new HttpError(413, 'asset_request_too_large', 'Asset request is too large')
    }
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const value of ctx.req) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    size += chunk.length
    if (size > ASSET_CREATE_BODY_LIMIT_BYTES) {
      throw new HttpError(413, 'asset_request_too_large', 'Asset request is too large')
    }
    chunks.push(chunk)
  }
  try {
    ctx.request.body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw badRequest('Invalid asset JSON body', undefined, 'invalid_asset_json')
  }
  return next()
}
