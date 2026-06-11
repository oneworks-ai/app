import { Buffer } from 'node:buffer'
import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'

import type { PluginProxyRequest, PluginProxyResponse } from './types.js'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

const hasDotSegment = (value: string) =>
  value.split('/').some((segment) => {
    if (segment === '..') return true
    try {
      return decodeURIComponent(segment) === '..'
    } catch {
      return false
    }
  })

export const isLoopbackProxyTarget = (target: string) => {
  try {
    const url = new URL(target)
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

const normalizeHeaders = (headers: http.IncomingHttpHeaders) => {
  const next = { ...headers }
  delete next.authorization
  delete next.cookie
  delete next.host
  delete next.connection
  delete next['content-length']
  delete next['proxy-authorization']
  delete next['proxy-authenticate']
  return next
}

export const proxyToLoopbackTarget = async (
  target: string,
  request: PluginProxyRequest
): Promise<PluginProxyResponse> => {
  if (request.path.includes('\0') || hasDotSegment(request.path)) {
    throw new Error('Plugin proxy path must stay within the registered API scope.')
  }

  const baseUrl = new URL(target)
  const basePath = baseUrl.pathname.endsWith('/') ? baseUrl.pathname : `${baseUrl.pathname}/`
  const requestPath = request.path === '' ? basePath : `${basePath}${request.path.replace(/^\/+/, '')}`
  const url = new URL(requestPath + request.query, baseUrl)
  const transport = url.protocol === 'https:' ? https : http

  return await new Promise<PluginProxyResponse>((resolve, reject) => {
    const proxyRequest = transport.request(url, {
      method: request.method,
      headers: normalizeHeaders(request.headers)
    }, (proxyResponse) => {
      const chunks: Buffer[] = []
      proxyResponse.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      proxyResponse.on('end', () => {
        resolve({
          status: proxyResponse.statusCode ?? 502,
          headers: Object.fromEntries(
            Object.entries(proxyResponse.headers).filter((entry): entry is [string, string | string[]] =>
              entry[1] != null
            )
          ),
          body: Buffer.concat(chunks)
        })
      })
    })
    proxyRequest.on('error', reject)
    if (request.body.length > 0) {
      proxyRequest.write(request.body)
    }
    proxyRequest.end()
  })
}
