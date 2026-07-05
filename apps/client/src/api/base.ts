import { handleHomepagePreviewFetchIfEnabled } from '#~/homepage-preview/runtime-loader'
import { createServerUrl, getServerBaseUrl } from '#~/runtime-config.js'

import { applyAuthHeader } from './auth-token'

export const jsonHeaders = { 'Content-Type': 'application/json' } as const
const DEFAULT_API_REQUEST_TIMEOUT_MS = 15_000

export type ApiRequestInit = RequestInit & {
  timeoutMs?: number
}

interface ApiEtagCacheEntry {
  data: unknown
  etag: string
}

const apiEtagCache = new Map<string, ApiEtagCacheEntry>()

export const getServerHost = () => {
  return new URL(getServerUrl()).hostname
}

export const getServerPort = () => {
  const { port, protocol } = new URL(getServerUrl())
  if (port !== '') return port
  return protocol === 'https:' ? '443' : '80'
}

export const getServerUrl = () => getServerBaseUrl()

export const buildApiUrl = (path: string) => {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path
  }
  return createServerUrl(path)
}

export const createApiUrl = (path: string) => new URL(buildApiUrl(path))

export interface ApiSuccessEnvelope<T> {
  success: true
  data: T
}

export interface ApiErrorPayload {
  code: string
  message: string
  details?: unknown
}

export interface ApiErrorEnvelope {
  success: false
  error: ApiErrorPayload
}

export class ApiError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message)
    this.name = 'ApiError'
    this.status = status
    this.code = payload.code
    this.details = payload.details
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

const isApiSuccessEnvelope = <T>(value: unknown): value is ApiSuccessEnvelope<T> => {
  return isRecord(value) && value.success === true && 'data' in value
}

const isApiErrorEnvelope = (value: unknown): value is ApiErrorEnvelope => {
  return isRecord(value) &&
    value.success === false &&
    isRecord(value.error) &&
    typeof value.error.message === 'string' &&
    typeof value.error.code === 'string'
}

const parseResponseBody = async (res: Response): Promise<unknown> => {
  const text = await res.text()
  if (text.trim() === '') {
    return null
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

const toApiError = (status: number, body: unknown, fallbackMessage: string) => {
  if (isApiErrorEnvelope(body)) {
    return new ApiError(status, body.error)
  }

  if (isRecord(body)) {
    const message = typeof body.error === 'string'
      ? body.error
      : typeof body.message === 'string'
      ? body.message
      : fallbackMessage
    const code = typeof body.code === 'string' ? body.code : 'request_failed'
    return new ApiError(status, {
      code,
      message,
      ...(body.details !== undefined ? { details: body.details } : {})
    })
  }

  if (typeof body === 'string' && body.trim() !== '') {
    return new ApiError(status, { code: 'request_failed', message: body })
  }

  return new ApiError(status, { code: 'request_failed', message: fallbackMessage })
}

const unwrapApiResponse = async <T>(res: Response, errorLabel?: string): Promise<T> => {
  const body = await parseResponseBody(res)
  if (!res.ok) {
    const fallbackMessage = errorLabel ?? `Request failed with status ${res.status}`
    const apiError = toApiError(res.status, body, fallbackMessage)
    console.error(errorLabel ?? '[api] request failed', res.status, apiError.message, apiError.details)
    throw apiError
  }

  if (isApiErrorEnvelope(body)) {
    throw new ApiError(res.status, body.error)
  }

  if (isApiSuccessEnvelope<T>(body)) {
    return body.data
  }

  return body as T
}

const getRequestMethod = (init?: ApiRequestInit) => (init?.method ?? 'GET').toUpperCase()

const createConditionalRequestInit = (url: string, init?: ApiRequestInit): ApiRequestInit | undefined => {
  if (getRequestMethod(init) !== 'GET') {
    return init
  }

  const entry = apiEtagCache.get(url)
  if (entry == null) {
    return init
  }

  const headers = new Headers(init?.headers)
  if (!headers.has('If-None-Match')) {
    headers.set('If-None-Match', entry.etag)
  }
  return {
    ...init,
    headers
  }
}

export const getApiErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof ApiError && error.message.trim() !== '') {
    return error.message
  }
  if (isAbortLikeError(error)) {
    return fallback
  }
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message
  }
  return fallback
}

export const isApiRequestTimeoutError = (error: unknown) => {
  return error instanceof ApiError && error.code === 'request_timeout'
}

const stringifyApiErrorDetails = (value: unknown): string => {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export const isApiRemoteWorkspaceConnectionError = (error: unknown) => {
  if (error instanceof ApiError) {
    if (
      error.status !== 408 &&
      error.status !== 502 &&
      error.status !== 503 &&
      error.status !== 504
    ) {
      return false
    }

    const searchable = [
      error.code,
      error.message,
      stringifyApiErrorDetails(error.details)
    ].join(' ').toLowerCase()

    return searchable.includes('workspace') ||
      searchable.includes('relay') ||
      searchable.includes('proxy') ||
      searchable.includes('fetch failed') ||
      searchable.includes('timed out') ||
      searchable.includes('timeout')
  }

  if (isAbortLikeError(error)) {
    return true
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return message.includes('fetch failed') ||
      message.includes('timed out') ||
      message.includes('timeout')
  }

  return false
}

const isAbortLikeError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false
  }
  if (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  ) {
    return true
  }
  return error.message === 'signal is aborted without reason' ||
    error.message.toLowerCase().includes('aborted')
}

const createRequestInit = (init?: ApiRequestInit): {
  didTimeout: () => boolean
  init: RequestInit
  cleanup: () => void
} => {
  const { timeoutMs, signal, ...rest } = init ?? {}
  const headers = new Headers(init?.headers)
  applyAuthHeader(headers)
  const resolvedTimeoutMs = timeoutMs ?? (signal == null ? DEFAULT_API_REQUEST_TIMEOUT_MS : undefined)
  let didTimeout = false
  let cleanup = () => {}
  let requestSignal = signal

  if (resolvedTimeoutMs != null && resolvedTimeoutMs > 0) {
    const abortController = new AbortController()
    const abortFromParentSignal = () => abortController.abort(signal?.reason)
    const abortForTimeout = () => {
      didTimeout = true
      abortController.abort(
        new DOMException(`Request timed out after ${resolvedTimeoutMs}ms`, 'TimeoutError')
      )
    }
    if (signal?.aborted === true) {
      abortFromParentSignal()
    } else {
      signal?.addEventListener('abort', abortFromParentSignal, { once: true })
    }
    const timer = setTimeout(abortForTimeout, resolvedTimeoutMs)
    cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abortFromParentSignal)
    }
    requestSignal = abortController.signal
  }

  return {
    didTimeout: () => didTimeout,
    init: {
      ...rest,
      signal: requestSignal,
      credentials: init?.credentials ?? 'include',
      headers
    },
    cleanup
  }
}

const runFetch = async (url: string, init?: ApiRequestInit) => {
  const request = createRequestInit(init)
  try {
    const mockResponse = await handleHomepagePreviewFetchIfEnabled(url, request.init)
    if (mockResponse != null) {
      return mockResponse
    }
    return await fetch(url, request.init)
  } catch (err) {
    if (request.didTimeout()) {
      throw new ApiError(408, {
        code: 'request_timeout',
        message: 'Request timed out. Check that the server is still running and retry.'
      })
    }
    throw err
  } finally {
    request.cleanup()
  }
}

const fetchAndUnwrapApiResponse = async <T>(
  url: string,
  init?: ApiRequestInit,
  errorLabel?: string
): Promise<T> => {
  const isConditionalGet = getRequestMethod(init) === 'GET'
  const res = await runFetch(url, createConditionalRequestInit(url, init))
  const cached = isConditionalGet ? apiEtagCache.get(url) : undefined
  if (res.status === 304 && cached != null) {
    return cached.data as T
  }

  const data = await unwrapApiResponse<T>(res, errorLabel)
  const etag = res.headers.get('ETag')
  if (isConditionalGet && etag != null && etag.trim() !== '') {
    apiEtagCache.set(url, { data, etag })
  }
  return data
}

export async function fetchApiJson<T>(pathOrUrl: string | URL, init?: ApiRequestInit): Promise<T> {
  const url = typeof pathOrUrl === 'string' ? buildApiUrl(pathOrUrl) : pathOrUrl.toString()
  return fetchAndUnwrapApiResponse<T>(url, init)
}

export async function fetchApiJsonOrThrow<T>(
  pathOrUrl: string | URL,
  init: ApiRequestInit,
  errorLabel: string
): Promise<T> {
  const url = typeof pathOrUrl === 'string' ? buildApiUrl(pathOrUrl) : pathOrUrl.toString()
  return fetchAndUnwrapApiResponse<T>(url, init, errorLabel)
}
