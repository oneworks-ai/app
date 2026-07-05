import { Buffer } from 'node:buffer'
import process from 'node:process'

import type { RelayForwardingJob, RelayForwardingJobStatusUpdate } from './session-types.js'
import { isRecord, toString } from './utils.js'
import { RELAY_WORKSPACE_HTTP_MODE } from './workspace-forwarding-modes.js'

export { RELAY_WORKSPACE_HTTP_MODE }

const forwardedResponseHeaders = new Set([
  'cache-control',
  'content-type',
  'etag',
  'last-modified'
])

const DEFAULT_WORKSPACE_HTTP_FORWARD_TIMEOUT_MS = 30_000

const isLocalHost = (host: string) => {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase()
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1' || normalized === '0.0.0.0'
}

const normalizeLoopbackHost = (host: string) => {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (normalized === '' || normalized === '0.0.0.0' || normalized === '::') return '127.0.0.1'
  return host
}

const normalizeWorkspaceServerBaseUrl = (rawBaseUrl?: string) => {
  if (rawBaseUrl != null && rawBaseUrl.trim() !== '') {
    const url = new URL(rawBaseUrl)
    if (url.protocol !== 'http:' || !isLocalHost(url.hostname) || url.port === '') {
      throw new Error('workspace_server_url_invalid')
    }
    url.hostname = normalizeLoopbackHost(url.hostname)
    url.pathname = '/'
    url.search = ''
    url.hash = ''
    return url.toString()
  }

  const host = process.env.__ONEWORKS_PROJECT_SERVER_HOST__?.trim() || '127.0.0.1'
  const port = process.env.__ONEWORKS_PROJECT_SERVER_PORT__?.trim()
  if (port == null || port === '') {
    throw new Error('workspace_server_missing')
  }
  return `http://${normalizeLoopbackHost(host)}:${port}`
}

const readRequest = (job: RelayForwardingJob) => {
  const parsed = JSON.parse(job.payload?.message ?? '{}') as unknown
  if (!isRecord(parsed)) throw new Error('workspace_request_invalid')
  const method = toString(parsed.method).toUpperCase() || 'GET'
  const path = toString(parsed.path)
  if (path === '' || !path.startsWith('/')) throw new Error('workspace_request_path_invalid')
  const headers = isRecord(parsed.headers)
    ? Object.fromEntries(
      Object.entries(parsed.headers)
        .flatMap(([key, value]) => {
          if (typeof value !== 'string') return []
          const normalizedKey = key.trim().toLowerCase()
          return normalizedKey === '' ? [] : [[normalizedKey, value]]
        })
    )
    : undefined
  return {
    bodyBase64: typeof parsed.bodyBase64 === 'string' ? parsed.bodyBase64 : undefined,
    headers,
    method,
    path,
    serverBaseUrl: typeof parsed.serverBaseUrl === 'string' ? parsed.serverBaseUrl : undefined,
    timeoutMs: typeof parsed.timeoutMs === 'number' && Number.isFinite(parsed.timeoutMs)
      ? Math.max(1_000, Math.min(120_000, Math.floor(parsed.timeoutMs)))
      : DEFAULT_WORKSPACE_HTTP_FORWARD_TIMEOUT_MS
  }
}

const filterRequestHeaders = (headers: Record<string, string> | undefined) => {
  if (headers == null) return undefined
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = key.toLowerCase()
    if (
      normalizedKey === 'accept' ||
      normalizedKey === 'content-type' ||
      normalizedKey === 'x-oneworks-client-origin'
    ) {
      result[normalizedKey] = value
    }
  }
  return result
}

const filterResponseHeaders = (headers: Headers) => {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    if (forwardedResponseHeaders.has(key.toLowerCase())) {
      result[key.toLowerCase()] = value
    }
  })
  return result
}

const normalizeErrorCode = (error: unknown) => {
  if (error instanceof Error && error.name === 'AbortError') {
    return 'workspace_http_forward_timeout'
  }
  const raw = error instanceof Error && error.message.trim() !== ''
    ? error.message
    : 'workspace_http_forward_failed'
  return raw.trim().replace(/[^\w.:-]/g, '_').slice(0, 80) || 'workspace_http_forward_failed'
}

export const forwardLocalRelayWorkspaceHttpRequest = async (
  job: RelayForwardingJob
): Promise<RelayForwardingJobStatusUpdate> => {
  try {
    const request = readRequest(job)
    const url = new URL(request.path, normalizeWorkspaceServerBaseUrl(request.serverBaseUrl))
    const body = request.bodyBase64 == null || request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : Buffer.from(request.bodyBase64, 'base64')
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
    }, request.timeoutMs)
    let response: Response
    let responseBody: Buffer
    try {
      response = await fetch(url, {
        body,
        headers: filterRequestHeaders(request.headers),
        method: request.method,
        signal: controller.signal
      })
      responseBody = Buffer.from(await response.arrayBuffer())
    } finally {
      clearTimeout(timeout)
    }
    return {
      result: {
        bodyBase64: responseBody.toString('base64'),
        headers: filterResponseHeaders(response.headers),
        status: response.status,
        statusText: response.statusText
      },
      status: 'succeeded'
    }
  } catch (error) {
    return {
      errorCode: normalizeErrorCode(error),
      status: 'failed'
    }
  }
}
