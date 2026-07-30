import { Buffer } from 'node:buffer'

import type Koa from 'koa'

import { ASSET_PRE_COMMIT_DETAILS, markAssetPreCommitFailure } from '#~/services/ai/asset-create-error.js'
import { HttpError, badRequest } from '#~/utils/http.js'

export const ASSET_CREATE_BODY_LIMIT_BYTES = 16 * 1024

const isAssetCreateRequest = (ctx: Koa.Context) => (
  ctx.method === 'POST' && ctx.path === '/api/ai/assets'
)

export const assetCreateBodyMiddleware = (): Koa.Middleware => async (ctx, next) => {
  if (!isAssetCreateRequest(ctx)) return next()
  // This endpoint never accepts pipelined trailing bytes; closing also prevents
  // an understated Content-Length from turning the remainder into a request.
  ctx.set('Connection', 'close')
  if (!ctx.is('application/json')) {
    throw new HttpError(
      415,
      'asset_content_type_required',
      'Asset requests must use application/json',
      ASSET_PRE_COMMIT_DETAILS
    )
  }
  const declaredLength = ctx.get('content-length').trim()
  if (declaredLength !== '') {
    const parsedLength = Number(declaredLength)
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw badRequest('Invalid Content-Length', ASSET_PRE_COMMIT_DETAILS, 'invalid_content_length')
    }
    if (parsedLength > ASSET_CREATE_BODY_LIMIT_BYTES) {
      throw new HttpError(
        413,
        'asset_request_too_large',
        'Asset request is too large',
        ASSET_PRE_COMMIT_DETAILS
      )
    }
  }

  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const value of ctx.req) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      size += chunk.length
      if (size > ASSET_CREATE_BODY_LIMIT_BYTES) {
        throw new HttpError(
          413,
          'asset_request_too_large',
          'Asset request is too large',
          ASSET_PRE_COMMIT_DETAILS
        )
      }
      chunks.push(chunk)
    }
  } catch (error) {
    throw markAssetPreCommitFailure(
      error,
      'Failed to read asset request',
      'asset_request_read_failed'
    )
  }
  try {
    ctx.request.body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw badRequest('Invalid asset JSON body', ASSET_PRE_COMMIT_DETAILS, 'invalid_asset_json')
  }
  return next()
}
