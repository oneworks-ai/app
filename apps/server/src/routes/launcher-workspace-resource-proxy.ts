import { Buffer } from 'node:buffer'
import { Readable } from 'node:stream'

import type { Context } from 'koa'

import { internalServerError } from '#~/utils/http.js'

const FORWARDED_RESPONSE_HEADERS = [
  'accept-ranges',
  'cache-control',
  'content-disposition',
  'content-length',
  'content-range',
  'content-security-policy',
  'content-type',
  'etag',
  'last-modified',
  'x-content-type-options'
] as const

export const proxyLauncherWorkspaceResource = async (
  ctx: Context,
  serverBaseUrl: string
) => {
  const { path, sessionId } = ctx.query as { path?: string; sessionId?: string }
  const upstreamPath = sessionId == null || sessionId.trim() === ''
    ? '/api/workspace/resource'
    : `/api/sessions/${encodeURIComponent(sessionId)}/workspace/resource`
  const upstreamUrl = new URL(upstreamPath, serverBaseUrl)
  if (path != null) upstreamUrl.searchParams.set('path', path)

  const headers = new Headers()
  for (const name of ['If-Modified-Since', 'If-None-Match', 'Range']) {
    const value = ctx.get(name)
    if (value !== '') headers.set(name, value)
  }

  const response = await fetch(upstreamUrl, {
    headers,
    method: ctx.method,
    redirect: 'error'
  }).catch((cause) => {
    throw internalServerError('Workspace media proxy request failed.', {
      cause,
      code: 'workspace_media_proxy_failed'
    })
  })

  ctx.state.skipApiEnvelope = true
  ctx.status = response.status
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = response.headers.get(name)
    if (value != null) ctx.set(name, value)
  }

  if (ctx.method === 'HEAD' || response.body == null) {
    ctx.body = Buffer.alloc(0)
    const contentLength = response.headers.get('content-length')
    if (contentLength != null) {
      const parsedContentLength = Number.parseInt(contentLength, 10)
      if (Number.isSafeInteger(parsedContentLength) && parsedContentLength >= 0) {
        ctx.length = parsedContentLength
      }
    }
    return
  }
  ctx.body = Readable.fromWeb(response.body as never)
}
