import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import process from 'node:process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'

import { createLogger } from '@oneworks/utils/create-logger'
import type { Logger } from '@oneworks/utils/create-logger'

export const CODEX_PROXY_META_HEADER_NAME = 'X-OneWorks-Proxy-Meta'
type CodexProxyLogger = Logger

interface CodexProxyLogContext {
  cwd: string
  ctxId: string
  env?: Record<string, string | null | undefined>
  sessionId: string
}

export interface CodexProxyDiagnostics {
  routedServiceKey?: string
  requestedModel?: string
  resolvedModel?: string
  runtime?: string
  sessionType?: string
  permissionMode?: string
  approvalPolicy?: string
  sandboxPolicy?: string
  useYolo?: boolean
  requestedEffort?: string
  effectiveEffort?: string
  wireApi?: string
}

export interface CodexProxyMeta {
  upstreamBaseUrl: string
  queryParams?: Record<string, string>
  headers?: Record<string, string>
  maxOutputTokens?: number
  logContext?: CodexProxyLogContext
  diagnostics?: CodexProxyDiagnostics
}

const REQUEST_HEADERS_TO_DROP = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
])

const RESPONSE_HEADERS_TO_DROP = new Set([
  'connection',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
])

let proxyServerPromise: Promise<{ baseUrl: string }> | undefined
let proxyServerLogger: CodexProxyLogger | undefined
const requestLoggerCache = new Map<string, CodexProxyLogger>()
let proxyRequestCounter = 0

const REDACTED_VALUE = '[REDACTED]'
const SENSITIVE_LOG_KEY_PATTERNS = [
  /^authorization$/i,
  /^proxy-authorization$/i,
  /^cookie$/i,
  /^set-cookie$/i,
  /^encrypted_content$/i,
  /^x-api-key$/i,
  /^api[-_]?key$/i,
  /^key$/i,
  /token$/i,
  /secret$/i,
  /password$/i,
  /signature$/i
]

export const encodeCodexProxyMeta = (meta: CodexProxyMeta) =>
  Buffer.from(JSON.stringify(meta), 'utf8').toString('base64url')

const decodeCodexProxyMeta = (rawValue: string): CodexProxyMeta => {
  const decoded = Buffer.from(rawValue, 'base64url').toString('utf8')
  return JSON.parse(decoded) as CodexProxyMeta
}

const readRequestBody = async (req: IncomingMessage) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value)

const normalizeContentType = (value: string | string[] | undefined) => {
  const normalizedValue = Array.isArray(value) ? value[0] : value
  return normalizedValue?.split(';', 1)[0]?.trim().toLowerCase()
}

const looksLikeJsonPayload = (buffer: Buffer) => {
  const text = buffer.toString('utf8').trimStart()
  return text.startsWith('{') || text.startsWith('[')
}

interface PreparedUpstreamBody {
  body: string | Buffer | undefined
  injectedMaxOutputTokens?: number
  strippedEncryptedReasoningItems?: number
  strippedEncryptedReasoningIncludes?: number
}

interface EncryptedReasoningStripStats {
  items: number
  includes: number
}

const ENCRYPTED_REASONING_INCLUDE = 'reasoning.encrypted_content'

const shouldInspectJsonBody = (
  requestBodyBuffer: Buffer,
  contentType: string | undefined
) => (
  contentType === 'application/json' ||
  contentType?.endsWith('+json') === true ||
  looksLikeJsonPayload(requestBodyBuffer)
)

const stripEncryptedReasoningInputItems = (
  value: unknown,
  stats: EncryptedReasoningStripStats
): unknown => {
  if (Array.isArray(value)) {
    const strippedItems: unknown[] = []
    for (const item of value) {
      if (
        isPlainObject(item) &&
        item.type === 'reasoning' &&
        typeof item.encrypted_content === 'string'
      ) {
        stats.items += 1
        continue
      }
      strippedItems.push(stripEncryptedReasoningInputItems(item, stats))
    }
    return strippedItems
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        stripEncryptedReasoningInputItems(item, stats)
      ])
    )
  }

  return value
}

const stripEncryptedReasoningFromBody = (
  body: string | Buffer | undefined,
  contentType: string | undefined
): PreparedUpstreamBody => {
  if (body == null) {
    return { body }
  }

  const bodyBuffer = toBodyBuffer(body)
  if (bodyBuffer == null || !shouldInspectJsonBody(bodyBuffer, contentType)) {
    return { body }
  }

  const bodyText = bodyBuffer.toString('utf8')

  try {
    const parsedBody = JSON.parse(bodyText) as unknown
    if (!isPlainObject(parsedBody)) {
      return { body: bodyText }
    }

    const stats: EncryptedReasoningStripStats = {
      items: 0,
      includes: 0
    }
    const nextBody: Record<string, unknown> = { ...parsedBody }

    if (Array.isArray(nextBody.include)) {
      nextBody.include = nextBody.include.filter((item) => {
        const shouldKeep = item !== ENCRYPTED_REASONING_INCLUDE
        if (!shouldKeep) stats.includes += 1
        return shouldKeep
      })
    }

    if (nextBody.input != null) {
      nextBody.input = stripEncryptedReasoningInputItems(nextBody.input, stats)
    }

    if (stats.items === 0 && stats.includes === 0) {
      return { body: bodyText }
    }

    return {
      body: JSON.stringify(nextBody),
      strippedEncryptedReasoningItems: stats.items,
      strippedEncryptedReasoningIncludes: stats.includes
    }
  } catch {
    return { body: bodyText }
  }
}

const maybeInjectMaxOutputTokens = (
  requestBodyBuffer: Buffer,
  req: IncomingMessage,
  proxyMeta: CodexProxyMeta
): PreparedUpstreamBody => {
  if (requestBodyBuffer.length === 0) {
    return { body: undefined }
  }

  const normalizedMaxOutputTokens = (
      typeof proxyMeta.maxOutputTokens === 'number' &&
      Number.isFinite(proxyMeta.maxOutputTokens) &&
      proxyMeta.maxOutputTokens > 0
    )
    ? Math.floor(proxyMeta.maxOutputTokens)
    : undefined

  if (normalizedMaxOutputTokens == null) {
    return { body: requestBodyBuffer }
  }

  const contentType = normalizeContentType(req.headers['content-type'])
  if (!shouldInspectJsonBody(requestBodyBuffer, contentType)) {
    return { body: requestBodyBuffer }
  }

  const requestBodyText = requestBodyBuffer.toString('utf8')

  try {
    const parsedBody = JSON.parse(requestBodyText) as unknown
    if (!isPlainObject(parsedBody) || parsedBody.max_output_tokens != null) {
      return { body: requestBodyText }
    }
    parsedBody.max_output_tokens = normalizedMaxOutputTokens
    return {
      body: JSON.stringify(parsedBody),
      injectedMaxOutputTokens: normalizedMaxOutputTokens
    }
  } catch {
    return { body: requestBodyText }
  }
}

const prepareUpstreamBody = (
  requestBodyBuffer: Buffer,
  req: IncomingMessage,
  proxyMeta: CodexProxyMeta
): PreparedUpstreamBody => {
  const maxTokensBody = maybeInjectMaxOutputTokens(requestBodyBuffer, req, proxyMeta)
  const strippedBody = stripEncryptedReasoningFromBody(
    maxTokensBody.body,
    normalizeContentType(req.headers['content-type'])
  )
  return {
    body: strippedBody.body,
    injectedMaxOutputTokens: maxTokensBody.injectedMaxOutputTokens,
    strippedEncryptedReasoningItems: strippedBody.strippedEncryptedReasoningItems,
    strippedEncryptedReasoningIncludes: strippedBody.strippedEncryptedReasoningIncludes
  }
}

const toFetchBody = (body: string | Buffer | undefined): BodyInit | undefined => {
  if (body == null) return undefined
  if (typeof body === 'string') return body
  return new Uint8Array(body)
}

const writeJsonResponse = (
  res: ServerResponse,
  statusCode: number,
  body: unknown
) => {
  if (res.headersSent) {
    res.end()
    return
  }
  res.writeHead(statusCode, {
    'Content-Type': 'application/json'
  })
  res.end(JSON.stringify(body))
}

const writeJsonError = (
  res: ServerResponse,
  statusCode: number,
  message: string
) => {
  writeJsonResponse(res, statusCode, {
    error: {
      message
    }
  })
}

const buildUpstreamUrl = (
  upstreamBaseUrl: string,
  requestUrl: string,
  queryParams: Record<string, string>
) => {
  if (upstreamBaseUrl.includes('\\')) {
    throw new Error('upstreamBaseUrl must be a valid URL')
  }

  const normalizedBaseUrl = upstreamBaseUrl.endsWith('/')
    ? upstreamBaseUrl.slice(0, -1)
    : upstreamBaseUrl
  const upstreamUrl = new URL(`${normalizedBaseUrl}${requestUrl}`)
  for (const [key, value] of Object.entries(queryParams)) {
    upstreamUrl.searchParams.set(key, value)
  }
  return upstreamUrl
}

const normalizeHeaderValue = (value: string | string[] | undefined) => (
  Array.isArray(value) ? value.join(', ') : value
)

const isSensitiveLogKey = (key: string) => (
  SENSITIVE_LOG_KEY_PATTERNS.some(pattern => pattern.test(key))
)

const sanitizeForLog = (value: unknown, keyHint?: string): unknown => {
  if (keyHint != null && isSensitiveLogKey(keyHint)) {
    return REDACTED_VALUE
  }
  if (Array.isArray(value)) {
    return value.map(item => sanitizeForLog(item))
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeForLog(item, key)])
    )
  }
  return value
}

const sanitizeHeaderEntriesForLog = (
  entries: Iterable<[string, string]>
) =>
  Object.fromEntries(
    Array.from(entries, ([key, value]) => [key, isSensitiveLogKey(key) ? REDACTED_VALUE : value])
  )

const sanitizeIncomingHeadersForLog = (
  headers: IncomingMessage['headers'],
  excludedKeys: ReadonlySet<string> = new Set()
) =>
  Object.fromEntries(
    Object.entries(headers)
      .map(([key, value]) => [key, normalizeHeaderValue(value)] as const)
      .filter((entry): entry is [string, string] => entry[1] != null)
      .filter(([key]) => !excludedKeys.has(key.toLowerCase()))
      .map(([key, value]) => [key, isSensitiveLogKey(key) ? REDACTED_VALUE : value] as const)
  )

const appendRecordValue = (
  record: Record<string, string | string[]>,
  key: string,
  value: string
) => {
  const current = record[key]
  if (current == null) {
    record[key] = value
    return
  }
  if (Array.isArray(current)) {
    current.push(value)
    return
  }
  record[key] = [current, value]
}

const sanitizeSearchParamsForLog = (searchParams: URLSearchParams) => {
  const record: Record<string, string | string[]> = {}
  for (const [key, value] of searchParams.entries()) {
    appendRecordValue(
      record,
      key,
      isSensitiveLogKey(key) ? REDACTED_VALUE : value
    )
  }
  return record
}

const sanitizeStringRecordForLog = (record: Record<string, string>) => (
  Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, isSensitiveLogKey(key) ? REDACTED_VALUE : value])
  )
)

const sanitizeUrlForLog = (value: string) => {
  try {
    const url = new URL(value)
    return {
      origin: url.origin,
      path: url.pathname,
      queryParams: sanitizeSearchParamsForLog(url.searchParams)
    }
  } catch {
    return '[INVALID URL]'
  }
}

const toBodyBuffer = (body: string | Buffer | undefined) => {
  if (body == null) return undefined
  if (typeof body === 'string') return Buffer.from(body)
  return body
}

const isTextualContentType = (contentType: string | undefined) => (
  contentType == null ||
  contentType.startsWith('text/') ||
  contentType === 'application/x-www-form-urlencoded' ||
  contentType === 'application/xml' ||
  contentType === 'application/graphql' ||
  contentType === 'application/javascript' ||
  contentType === 'application/x-ndjson' ||
  contentType === 'application/json' ||
  contentType?.endsWith('+json') === true ||
  contentType?.endsWith('+xml') === true
)

interface SerializedBodyForLog {
  byteLength: number
  format: 'empty' | 'json' | 'form' | 'text' | 'binary'
  json?: unknown
  form?: Record<string, string | string[]>
  text?: string
  base64?: string
}

const serializeBodyForLog = (
  body: string | Buffer | undefined,
  contentType: string | undefined
): SerializedBodyForLog => {
  const buffer = toBodyBuffer(body)
  if (buffer == null || buffer.length === 0) {
    return {
      byteLength: 0,
      format: 'empty'
    }
  }

  const bodyText = buffer.toString('utf8')
  const shouldTreatAsJson = contentType === 'application/json' ||
    contentType?.endsWith('+json') === true ||
    looksLikeJsonPayload(buffer)

  if (shouldTreatAsJson) {
    try {
      return {
        byteLength: buffer.length,
        format: 'json',
        json: sanitizeForLog(JSON.parse(bodyText) as unknown)
      }
    } catch {
      return {
        byteLength: buffer.length,
        format: 'text',
        text: bodyText
      }
    }
  }

  if (contentType === 'application/x-www-form-urlencoded') {
    return {
      byteLength: buffer.length,
      format: 'form',
      form: sanitizeSearchParamsForLog(new URLSearchParams(bodyText))
    }
  }

  if (isTextualContentType(contentType)) {
    return {
      byteLength: buffer.length,
      format: 'text',
      text: bodyText
    }
  }

  return {
    byteLength: buffer.length,
    format: 'binary',
    base64: buffer.toString('base64')
  }
}

const summarizeProxyMeta = (proxyMeta: CodexProxyMeta) => ({
  upstreamBaseUrl: sanitizeUrlForLog(proxyMeta.upstreamBaseUrl),
  queryParamKeys: Object.keys(proxyMeta.queryParams ?? {}),
  headerKeys: Object.keys(proxyMeta.headers ?? {}),
  hasMaxOutputTokens: typeof proxyMeta.maxOutputTokens === 'number'
})

const summarizeRequest = (req: IncomingMessage) => ({
  method: req.method,
  requestUrl: req.url,
  contentType: normalizeContentType(req.headers['content-type']),
  hasAuthorizationHeader: normalizeHeaderValue(req.headers.authorization) != null
})

const summarizeUpstreamUrl = (upstreamUrl: URL) => ({
  upstreamOrigin: upstreamUrl.origin,
  upstreamPath: upstreamUrl.pathname,
  upstreamQueryParams: sanitizeSearchParamsForLog(upstreamUrl.searchParams)
})

const summarizeLocalUrl = (requestUrl: string) => {
  const localUrl = new URL(requestUrl, 'http://127.0.0.1')
  return {
    requestPath: localUrl.pathname,
    requestQueryParams: sanitizeSearchParamsForLog(localUrl.searchParams)
  }
}

const normalizeNonEmptyString = (value: string | undefined) => {
  const normalized = value?.trim()
  return normalized == null || normalized === '' ? undefined : normalized
}

const resolveRequestedModelId = (requestedModel: string | undefined) => {
  const normalized = normalizeNonEmptyString(requestedModel)
  if (normalized == null || normalized === 'default') {
    return undefined
  }

  if (!normalized.includes(',')) {
    return normalized
  }

  return normalizeNonEmptyString(normalized.slice(normalized.indexOf(',') + 1))
}

interface CodexModelInfo {
  slug: string
  display_name?: string
  description?: string | null
  default_reasoning_level?: string | null
  supported_reasoning_levels?: Array<{
    effort: string
    description: string
  }>
  shell_type?: string
  visibility?: string
  supported_in_api?: boolean
  priority?: number
  [key: string]: unknown
}

interface CodexModelsResponse {
  models?: CodexModelInfo[]
}

const SYNTHETIC_REASONING_LEVELS = [
  {
    effort: 'low',
    description: 'Fast responses with lighter reasoning'
  },
  {
    effort: 'medium',
    description: 'Balances speed and reasoning depth'
  },
  {
    effort: 'high',
    description: 'Greater reasoning depth for complex tasks'
  },
  {
    effort: 'xhigh',
    description: 'Extra high reasoning depth for complex tasks'
  }
]

const resolveCodexModelsCachePath = () => (
  resolve(
    normalizeNonEmptyString(process.env.CODEX_HOME) ??
      resolve(normalizeNonEmptyString(process.env.HOME) ?? homedir(), '.codex'),
    'models_cache.json'
  )
)

const readCodexModelCache = async () => {
  try {
    const parsed = JSON.parse(await readFile(resolveCodexModelsCachePath(), 'utf8')) as CodexModelsResponse
    return Array.isArray(parsed.models) ? parsed.models : []
  } catch {
    return []
  }
}

const toSyntheticDisplayName = (modelId: string) => (
  modelId
    .split(/[-_\s]+/g)
    .filter(part => part !== '')
    .map(part => part.toUpperCase() === part ? part : part[0]?.toUpperCase() + part.slice(1))
    .join(' ') || modelId
)

const buildFallbackModelInfo = (
  modelId: string,
  priority: number,
  template: CodexModelInfo | undefined
): CodexModelInfo => {
  const isExactTemplate = template?.slug === modelId

  return {
    ...(template ?? {}),
    slug: modelId,
    display_name: isExactTemplate
      ? (template?.display_name ?? toSyntheticDisplayName(modelId))
      : toSyntheticDisplayName(modelId),
    description: isExactTemplate ? (template?.description ?? `Routed model ${modelId}`) : `Routed model ${modelId}`,
    default_reasoning_level: template?.default_reasoning_level ?? 'medium',
    supported_reasoning_levels: template?.supported_reasoning_levels ?? SYNTHETIC_REASONING_LEVELS,
    shell_type: template?.shell_type ?? 'shell_command',
    visibility: template?.visibility ?? 'list',
    supported_in_api: template?.supported_in_api ?? true,
    priority: isExactTemplate ? (template?.priority ?? priority) : priority,
    availability_nux: template?.availability_nux ?? null,
    upgrade: template?.upgrade ?? null,
    base_instructions: template?.base_instructions ?? 'You are Codex, a coding agent.',
    supports_reasoning_summaries: template?.supports_reasoning_summaries ?? false,
    default_reasoning_summary: template?.default_reasoning_summary ?? 'none',
    support_verbosity: template?.support_verbosity ?? false,
    default_verbosity: template?.default_verbosity ?? null,
    apply_patch_tool_type: template?.apply_patch_tool_type ?? null,
    web_search_tool_type: template?.web_search_tool_type ?? 'text',
    truncation_policy: template?.truncation_policy ?? {
      mode: 'tokens',
      limit: 10000
    },
    supports_parallel_tool_calls: template?.supports_parallel_tool_calls ?? false,
    supports_image_detail_original: template?.supports_image_detail_original ?? false,
    context_window: template?.context_window ?? 272000,
    max_context_window: template?.max_context_window ?? template?.context_window ?? 272000,
    effective_context_window_percent: template?.effective_context_window_percent ?? 95,
    experimental_supported_tools: template?.experimental_supported_tools ?? [],
    input_modalities: template?.input_modalities ?? ['text', 'image'],
    supports_search_tool: template?.supports_search_tool ?? false
  }
}

const buildSyntheticModelsResponse = async (proxyMeta: CodexProxyMeta) => {
  const modelIds = Array.from(
    new Set(
      [
        normalizeNonEmptyString(proxyMeta.diagnostics?.resolvedModel),
        resolveRequestedModelId(proxyMeta.diagnostics?.requestedModel)
      ].filter((value): value is string => value != null)
    )
  )
  const cachedModels = await readCodexModelCache()
  const fallbackTemplate = cachedModels[0]

  return {
    models: modelIds.map((modelId, index) => {
      const cachedModel = cachedModels.find(model => model.slug === modelId)
      return buildFallbackModelInfo(modelId, index, cachedModel ?? fallbackTemplate)
    })
  }
}

const isModelsListRequest = (req: IncomingMessage, requestUrl: string) => {
  if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
    return false
  }

  return new URL(requestUrl, 'http://127.0.0.1').pathname === '/models'
}

const summarizeProxyMetaForLog = (proxyMeta: CodexProxyMeta) => ({
  upstreamBaseUrl: sanitizeUrlForLog(proxyMeta.upstreamBaseUrl),
  queryParams: sanitizeStringRecordForLog(proxyMeta.queryParams ?? {}),
  headers: sanitizeStringRecordForLog(proxyMeta.headers ?? {}),
  maxOutputTokens: proxyMeta.maxOutputTokens,
  diagnostics: sanitizeForLog(proxyMeta.diagnostics),
  logContext: proxyMeta.logContext
})

const getErrorCause = (err: unknown) => (
  err instanceof Error && 'cause' in err ? err.cause : undefined
)

const getRequestLogger = (logContext: CodexProxyLogContext | undefined) => {
  if (logContext == null) return undefined
  const cacheKey = `${logContext.cwd}\n${logContext.ctxId}\n${logContext.sessionId}`
  const cached = requestLoggerCache.get(cacheKey)
  if (cached != null) return cached
  const logger = createLogger(
    logContext.cwd,
    `${logContext.ctxId}/${logContext.sessionId}/adapter-codex`,
    'proxy',
    '',
    'info',
    logContext.env as NodeJS.ProcessEnv | undefined
  )
  requestLoggerCache.set(cacheKey, logger)
  return logger
}

const handleProxyRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
  logger: CodexProxyLogger | undefined
) => {
  const rawMetaHeader = normalizeHeaderValue(req.headers[CODEX_PROXY_META_HEADER_NAME.toLowerCase()])
  if (typeof rawMetaHeader !== 'string' || rawMetaHeader.trim() === '') {
    logger?.warn('[codex proxy] missing proxy metadata header', summarizeRequest(req))
    writeJsonError(res, 400, `Missing required ${CODEX_PROXY_META_HEADER_NAME} header`)
    return
  }

  let proxyMeta: CodexProxyMeta
  try {
    proxyMeta = decodeCodexProxyMeta(rawMetaHeader)
  } catch {
    logger?.warn('[codex proxy] invalid proxy metadata header', summarizeRequest(req))
    writeJsonError(res, 400, `Invalid ${CODEX_PROXY_META_HEADER_NAME} header`)
    return
  }
  const requestLogger = getRequestLogger(proxyMeta.logContext) ?? logger

  if (typeof proxyMeta.upstreamBaseUrl !== 'string' || proxyMeta.upstreamBaseUrl.trim() === '') {
    requestLogger?.warn('[codex proxy] invalid proxy metadata', {
      ...summarizeRequest(req),
      ...summarizeProxyMeta(proxyMeta)
    })
    writeJsonError(res, 400, 'Invalid proxy metadata: upstreamBaseUrl is required')
    return
  }

  let requestBodyBuffer: Buffer
  try {
    requestBodyBuffer = await readRequestBody(req)
  } catch {
    writeJsonError(res, 400, 'Failed to read request body')
    return
  }
  const requestId = `proxy-${++proxyRequestCounter}`
  const requestStartedAt = Date.now()
  const requestUrl = req.url ?? '/responses'
  const requestContentType = normalizeContentType(req.headers['content-type'])
  const preparedUpstreamBody = prepareUpstreamBody(requestBodyBuffer, req, proxyMeta)
  const upstreamBody = preparedUpstreamBody.body

  const upstreamHeaders = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    const normalizedKey = key.toLowerCase()
    const normalizedValue = normalizeHeaderValue(value)
    if (normalizedValue == null) continue
    if (REQUEST_HEADERS_TO_DROP.has(normalizedKey)) continue
    if (normalizedKey === CODEX_PROXY_META_HEADER_NAME.toLowerCase()) continue
    upstreamHeaders.set(key, normalizedValue)
  }
  for (const [key, value] of Object.entries(proxyMeta.headers ?? {})) {
    upstreamHeaders.set(key, value)
  }

  let upstreamUrl: URL
  try {
    upstreamUrl = buildUpstreamUrl(
      proxyMeta.upstreamBaseUrl,
      requestUrl,
      proxyMeta.queryParams ?? {}
    )
  } catch (error) {
    requestLogger?.warn('[codex proxy] invalid upstream URL', {
      ...summarizeRequest(req),
      ...summarizeProxyMeta(proxyMeta),
      error: error instanceof Error ? error.message : String(error)
    })
    writeJsonError(res, 400, 'Invalid proxy metadata: upstreamBaseUrl must be a valid URL')
    return
  }
  requestLogger?.info('[codex proxy] request received', {
    requestId,
    ...summarizeRequest(req),
    ...summarizeLocalUrl(requestUrl),
    proxyMeta: summarizeProxyMetaForLog(proxyMeta),
    incomingHeaders: sanitizeIncomingHeadersForLog(
      req.headers,
      new Set([CODEX_PROXY_META_HEADER_NAME.toLowerCase()])
    ),
    incomingBody: serializeBodyForLog(requestBodyBuffer, requestContentType)
  })

  if (isModelsListRequest(req, requestUrl)) {
    const responseBody = await buildSyntheticModelsResponse(proxyMeta)
    requestLogger?.info('[codex proxy] returning synthetic model list', {
      requestId,
      ...summarizeRequest(req),
      ...summarizeLocalUrl(requestUrl),
      status: 200,
      durationMs: Date.now() - requestStartedAt,
      models: responseBody.models.map(model => model.slug)
    })
    writeJsonResponse(res, 200, responseBody)
    return
  }

  requestLogger?.info('[codex proxy] forwarding request', {
    requestId,
    ...summarizeRequest(req),
    ...summarizeLocalUrl(requestUrl),
    ...summarizeUpstreamUrl(upstreamUrl),
    upstreamHeaders: sanitizeHeaderEntriesForLog(upstreamHeaders.entries()),
    upstreamBody: serializeBodyForLog(upstreamBody, requestContentType),
    proxyMutations: {
      requestBodyChanged: !Buffer.from(requestBodyBuffer).equals(toBodyBuffer(upstreamBody) ?? Buffer.alloc(0)),
      injectedMaxOutputTokens: preparedUpstreamBody.injectedMaxOutputTokens ?? null,
      strippedEncryptedReasoningItems: preparedUpstreamBody.strippedEncryptedReasoningItems ?? 0,
      strippedEncryptedReasoningIncludes: preparedUpstreamBody.strippedEncryptedReasoningIncludes ?? 0
    }
  })
  const abortController = new AbortController()
  const abortRequest = () => abortController.abort()
  const abortOnRequestAborted = () => abortRequest()
  const abortOnResponseClosed = () => {
    if (!res.writableEnded) {
      requestLogger?.warn('[codex proxy] downstream connection closed before response completed', {
        ...summarizeRequest(req),
        ...summarizeProxyMeta(proxyMeta),
        ...summarizeUpstreamUrl(upstreamUrl)
      })
      abortRequest()
    }
  }
  req.once('aborted', abortOnRequestAborted)
  res.once('close', abortOnResponseClosed)

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: req.method ?? 'POST',
      headers: upstreamHeaders,
      body: toFetchBody(upstreamBody),
      signal: abortController.signal
    })
    const responseContentType = normalizeContentType(upstreamResponse.headers.get('content-type') ?? undefined)
    const shouldCaptureResponseBody = upstreamResponse.status >= 400 && responseContentType !== 'text/event-stream'
    const responseBodyForLogPromise = shouldCaptureResponseBody
      ? upstreamResponse.clone().text()
        .then(text => serializeBodyForLog(text, responseContentType))
        .catch(() => undefined)
      : Promise.resolve(undefined)

    const responseHeaders = new Headers()
    upstreamResponse.headers.forEach((value, key) => {
      if (RESPONSE_HEADERS_TO_DROP.has(key.toLowerCase())) return
      responseHeaders.set(key, value)
    })
    requestLogger?.info('[codex proxy] upstream response received', {
      requestId,
      ...summarizeUpstreamUrl(upstreamUrl),
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      durationMs: Date.now() - requestStartedAt,
      responseHeaders: sanitizeHeaderEntriesForLog(responseHeaders.entries())
    })
    res.writeHead(upstreamResponse.status, Object.fromEntries(responseHeaders.entries()))

    if (upstreamResponse.body == null) {
      const responseBodyForLog = await responseBodyForLogPromise
      const completedLog = {
        requestId,
        ...summarizeUpstreamUrl(upstreamUrl),
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        durationMs: Date.now() - requestStartedAt,
        responseBodyBytes: 0,
        ...(responseBodyForLog != null ? { responseBody: responseBodyForLog } : {})
      }
      if (upstreamResponse.ok) {
        requestLogger?.info('[codex proxy] request completed', completedLog)
      } else {
        requestLogger?.warn('[codex proxy] upstream returned error status', completedLog)
      }
      res.end()
      return
    }

    const responseStream = Readable.fromWeb(upstreamResponse.body as NodeReadableStream)
    let responseBodyBytes = 0
    responseStream.on('data', (chunk: unknown) => {
      if (typeof chunk === 'string') {
        responseBodyBytes += Buffer.byteLength(chunk)
        return
      }
      if (chunk instanceof Uint8Array) {
        responseBodyBytes += chunk.byteLength
        return
      }
      responseBodyBytes += Buffer.byteLength(String(chunk))
    })

    await pipeline(responseStream, res)
    const responseBodyForLog = await responseBodyForLogPromise
    const completedLog = {
      requestId,
      ...summarizeUpstreamUrl(upstreamUrl),
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      durationMs: Date.now() - requestStartedAt,
      responseBodyBytes,
      ...(responseBodyForLog != null ? { responseBody: responseBodyForLog } : {})
    }
    if (upstreamResponse.ok) {
      requestLogger?.info('[codex proxy] request completed', completedLog)
    } else {
      requestLogger?.warn('[codex proxy] upstream returned error status', completedLog)
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      res.end()
      return
    }
    requestLogger?.error('[codex proxy] upstream request failed', {
      err,
      cause: getErrorCause(err),
      requestId,
      ...summarizeRequest(req),
      ...summarizeProxyMeta(proxyMeta),
      ...summarizeUpstreamUrl(upstreamUrl)
    })
    writeJsonError(
      res,
      502,
      err instanceof Error ? err.message : String(err)
    )
  } finally {
    req.off('aborted', abortOnRequestAborted)
    res.off('close', abortOnResponseClosed)
  }
}

export const ensureCodexProxyServer = async (logger?: CodexProxyLogger) => {
  if (logger != null) {
    proxyServerLogger = logger
  }

  if (proxyServerPromise == null) {
    proxyServerPromise = new Promise((resolve, reject) => {
      proxyServerLogger?.info('[codex proxy] starting local proxy server')
      const server = createServer((req, res) => {
        void handleProxyRequest(req, res, proxyServerLogger)
      })

      server.once('error', (err) => {
        proxyServerLogger?.error('[codex proxy] local proxy server failed', { err })
        proxyServerPromise = undefined
        reject(err)
      })

      server.once('close', () => {
        proxyServerLogger?.info('[codex proxy] local proxy server closed')
        proxyServerPromise = undefined
      })

      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (address == null || typeof address === 'string') {
          server.close()
          reject(new Error('Failed to resolve local Codex proxy address'))
          return
        }
        server.unref()
        proxyServerLogger?.info('[codex proxy] local proxy server ready', {
          baseUrl: `http://127.0.0.1:${address.port}`
        })
        resolve({
          baseUrl: `http://127.0.0.1:${address.port}`
        })
      })
    })
  }

  return proxyServerPromise
}
