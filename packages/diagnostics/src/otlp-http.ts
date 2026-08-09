/* eslint-disable max-lines -- OTLP JSON mapping, batching, retry, and env configuration form one exporter. */
import process from 'node:process'

import type {
  DiagnosticEvent,
  DiagnosticExporter,
  DiagnosticResource,
  ModelUsageEvent,
  ModelUsageExporter
} from './types.js'

const DEFAULT_BATCH_SIZE = 32
const DEFAULT_FLUSH_INTERVAL_MS = 5_000
const DEFAULT_TIMEOUT_MS = 10_000
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504])

class OtlpHttpStatusError extends Error {
  constructor(readonly status: number, readonly retryable: boolean) {
    super(`OTLP log export failed with status ${status}.`)
    this.name = 'OtlpHttpStatusError'
  }
}

type OtlpScalar = boolean | number | string

interface OtlpAnyValue {
  boolValue?: boolean
  doubleValue?: number
  intValue?: string
  stringValue?: string
}

interface OtlpKeyValue {
  key: string
  value: OtlpAnyValue
}

export interface OtlpHttpDiagnosticExporterOptions {
  batchSize?: number
  delay?: (milliseconds: number) => Promise<void>
  endpoint: string
  fetch?: typeof globalThis.fetch
  flushIntervalMs?: number
  headers?: Record<string, string>
  onError?: (error: unknown) => void
  timeoutMs?: number
}

export interface OtlpHttpDiagnosticExporterEnvOptions {
  env?: NodeJS.ProcessEnv
  fetch?: typeof globalThis.fetch
  headerOverrides?: Record<string, string | undefined>
  onError?: (error: unknown) => void
}

const toAnyValue = (value: OtlpScalar): OtlpAnyValue => {
  if (typeof value === 'boolean') return { boolValue: value }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value }
  }
  return { stringValue: value }
}

const toAttributes = (attributes: Record<string, OtlpScalar | undefined>) => (
  Object.entries(attributes)
    .filter((entry): entry is [string, OtlpScalar] => entry[1] != null)
    .map(([key, value]): OtlpKeyValue => ({ key, value: toAnyValue(value) }))
)

const eventSeverity = (event: DiagnosticEvent) => {
  if (event.operation.outcome === 'error' || event.operation.outcome === 'timeout') {
    return { severityNumber: 17, severityText: 'ERROR' }
  }
  if (event.operation.outcome === 'abandoned' || event.operation.outcome === 'degraded') {
    return { severityNumber: 13, severityText: 'WARN' }
  }
  return { severityNumber: 9, severityText: 'INFO' }
}

const resourceAttributes = (resource: DiagnosticResource) =>
  toAttributes({
    'deployment.environment.name': resource.environment,
    'host.arch': resource.architecture,
    'oneworks.release.channel': resource.releaseChannel,
    'oneworks.surface': resource.surface,
    'os.type': resource.platform,
    'service.name': resource.serviceName,
    'service.version': resource.serviceVersion
  })

const eventAttributes = (event: DiagnosticEvent) =>
  toAttributes({
    'event.name': `oneworks.diagnostic.${event.kind}`,
    'oneworks.context.agent_session_id': event.context.agentSessionId,
    'oneworks.context.app_session_id': event.context.appSessionId,
    'oneworks.context.device_id': event.context.deviceId,
    'oneworks.context.installation_id': event.context.installationId,
    'oneworks.context.native_session_id': event.context.nativeSessionId,
    'oneworks.context.startup_id': event.context.startupId,
    'oneworks.context.trace_id': event.context.traceId,
    'oneworks.context.user_id': event.context.userId,
    'oneworks.context.workspace_session_id': event.context.workspaceSessionId,
    'oneworks.data_class': event.dataClass,
    'oneworks.operation.duration_ms': event.operation.durationMs,
    'oneworks.operation.failure.code': event.operation.failure?.code,
    'oneworks.operation.failure.domain': event.operation.failure?.domain,
    'oneworks.operation.failure.fingerprint': event.operation.failure?.fingerprint,
    'oneworks.operation.failure.retryable': event.operation.failure?.retryable,
    'oneworks.operation.failure.type': event.operation.failure?.type,
    'oneworks.operation.id': event.operation.id,
    'oneworks.operation.name': event.operation.name,
    'oneworks.operation.outcome': event.operation.outcome,
    'oneworks.operation.stage': event.operation.stage,
    'oneworks.operation.stage_duration_ms': event.operation.stageDurationMs,
    'oneworks.operation.stage_sequence': event.operation.stageSequence,
    'oneworks.schema.version': event.schemaVersion
  })

const modelUsageAttributes = (event: ModelUsageEvent) =>
  toAttributes({
    'event.name': 'oneworks.model.usage',
    'gen_ai.request.model': event.model,
    'gen_ai.usage.input_tokens': event.inputTokens,
    'gen_ai.usage.output_tokens': event.outputTokens,
    'oneworks.context.agent_session_id': event.context.agentSessionId,
    'oneworks.context.app_session_id': event.context.appSessionId,
    'oneworks.context.device_id': event.context.deviceId,
    'oneworks.context.trace_id': event.context.traceId,
    'oneworks.model.adapter': event.adapter,
    'oneworks.model.usage.event_id': event.eventId,
    'oneworks.model.service': event.modelService,
    'oneworks.model.usage.cache_creation_input_tokens': event.cacheCreationInputTokens,
    'oneworks.model.usage.cached_input_tokens': event.cachedInputTokens,
    'oneworks.model.usage.duration_ms': event.durationMs,
    'oneworks.model.usage.request_count': event.requestCount,
    'oneworks.model.usage.success': event.success,
    'oneworks.schema.version': event.schemaVersion
  })

const toUnixNano = (timestamp: string) => {
  const milliseconds = Date.parse(timestamp)
  return String(BigInt(Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0) * 1_000_000n)
}

type ExportableEvent = DiagnosticEvent | ModelUsageEvent

const isModelUsageEvent = (event: ExportableEvent): event is ModelUsageEvent => 'modelService' in event

const toOtlpRequest = (events: ExportableEvent[]) => ({
  resourceLogs: events.map(event => ({
    resource: {
      attributes: resourceAttributes(event.resource)
    },
    scopeLogs: [{
      logRecords: [{
        attributes: isModelUsageEvent(event) ? modelUsageAttributes(event) : eventAttributes(event),
        body: {
          stringValue: isModelUsageEvent(event) ? 'oneworks.model.usage' : `oneworks.diagnostic.${event.kind}`
        },
        observedTimeUnixNano: toUnixNano(new Date().toISOString()),
        ...(isModelUsageEvent(event)
          ? { severityNumber: 9, severityText: 'INFO' }
          : eventSeverity(event)),
        timeUnixNano: toUnixNano(isModelUsageEvent(event) ? event.occurredAt : event.timestamp)
      }],
      scope: {
        name: '@oneworks/diagnostics',
        version: String(event.schemaVersion)
      }
    }]
  }))
})

const parseHeaders = (value: string | undefined) => {
  const headers: Record<string, string> = {}
  for (const item of value?.split(',') ?? []) {
    const separator = item.indexOf('=')
    if (separator <= 0) continue
    try {
      const key = decodeURIComponent(item.slice(0, separator).trim())
      const headerValue = decodeURIComponent(item.slice(separator + 1).trim())
      if (key !== '' && headerValue !== '') headers[key] = headerValue
    } catch {
      // Ignore malformed OTLP header entries instead of exporting raw values in an error.
    }
  }
  return headers
}

const applyHeaderOverrides = (
  headers: Record<string, string>,
  overrides: Record<string, string | undefined> | undefined
) => {
  const result = { ...headers }
  for (const [key, value] of Object.entries(overrides ?? {})) {
    const normalizedKey = key.toLowerCase()
    for (const existingKey of Object.keys(result)) {
      if (existingKey.toLowerCase() === normalizedKey) delete result[existingKey]
    }
    if (value != null && value !== '') result[key] = value
  }
  return result
}

const resolveLogsEndpoint = (env: NodeJS.ProcessEnv) => {
  const logsEndpoint = env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT?.trim()
  if (logsEndpoint != null && logsEndpoint !== '') return logsEndpoint
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()
  if (endpoint == null || endpoint === '') return undefined
  return `${endpoint.replace(/\/+$/u, '')}/v1/logs`
}

const readPositiveNumber = (value: string | undefined, fallback: number) => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

export class OtlpHttpDiagnosticExporter implements DiagnosticExporter, ModelUsageExporter {
  private readonly batchSize: number
  private readonly delay: (milliseconds: number) => Promise<void>
  private readonly endpoint: string
  private readonly fetch: typeof globalThis.fetch
  private readonly flushIntervalMs: number
  private readonly headers: Record<string, string>
  private readonly onError?: (error: unknown) => void
  private readonly timeoutMs: number
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private inFlight = Promise.resolve()
  private readonly queue: ExportableEvent[] = []

  constructor(options: OtlpHttpDiagnosticExporterOptions) {
    this.batchSize = Math.max(1, Math.trunc(options.batchSize ?? DEFAULT_BATCH_SIZE))
    this.delay = options.delay ??
      (async milliseconds => await new Promise(resolve => setTimeout(resolve, milliseconds)))
    this.endpoint = options.endpoint
    this.fetch = options.fetch ?? globalThis.fetch
    this.flushIntervalMs = Math.max(1, Math.trunc(options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS))
    this.headers = { ...(options.headers ?? {}) }
    this.onError = options.onError
    this.timeoutMs = Math.max(1, Math.trunc(options.timeoutMs ?? DEFAULT_TIMEOUT_MS))
  }

  export(event: DiagnosticEvent) {
    this.enqueue(event)
  }

  exportModelUsage(event: ModelUsageEvent) {
    this.enqueue(event)
  }

  private enqueue(event: ExportableEvent) {
    this.queue.push(event)
    if (this.queue.length >= this.batchSize) {
      this.enqueueFlush()
      return
    }
    this.ensureFlushTimer()
  }

  async flush() {
    this.clearFlushTimer()
    this.enqueueFlush()
    await this.inFlight
  }

  private clearFlushTimer() {
    if (this.flushTimer == null) return
    clearTimeout(this.flushTimer)
    this.flushTimer = undefined
  }

  private enqueueFlush() {
    this.clearFlushTimer()
    if (this.queue.length === 0) return
    const events = this.queue.splice(0, this.queue.length)
    this.inFlight = this.inFlight
      .then(async () => await this.send(events))
      .catch(error => this.onError?.(error))
  }

  private ensureFlushTimer() {
    if (this.flushTimer != null) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      this.enqueueFlush()
    }, this.flushIntervalMs)
    this.flushTimer.unref?.()
  }

  private async send(events: ExportableEvent[]) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
      timeout.unref?.()
      try {
        const response = await this.fetch(this.endpoint, {
          body: JSON.stringify(toOtlpRequest(events)),
          headers: {
            'content-type': 'application/json',
            ...this.headers
          },
          method: 'POST',
          signal: controller.signal
        })
        if (response.ok) return
        throw new OtlpHttpStatusError(response.status, RETRYABLE_STATUS_CODES.has(response.status))
      } catch (error) {
        if (error instanceof OtlpHttpStatusError && !error.retryable) throw error
        if (attempt === 2) throw error
      } finally {
        clearTimeout(timeout)
      }
      await this.delay(100 * 2 ** attempt)
    }
  }
}

export const createOtlpHttpDiagnosticExporterFromEnv = (
  options: OtlpHttpDiagnosticExporterEnvOptions = {}
) => {
  const env = options.env ?? process.env
  const endpoint = resolveLogsEndpoint(env)
  if (endpoint == null) return undefined
  const protocol = (env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL ?? env.OTEL_EXPORTER_OTLP_PROTOCOL ?? 'http/json')
    .trim()
    .toLowerCase()
  if (protocol !== 'http/json' && protocol !== 'json') return undefined

  return new OtlpHttpDiagnosticExporter({
    endpoint,
    ...(options.fetch == null ? {} : { fetch: options.fetch }),
    headers: applyHeaderOverrides({
      ...parseHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
      ...parseHeaders(env.OTEL_EXPORTER_OTLP_LOGS_HEADERS)
    }, options.headerOverrides),
    onError: options.onError,
    timeoutMs: readPositiveNumber(env.OTEL_EXPORTER_OTLP_LOGS_TIMEOUT, DEFAULT_TIMEOUT_MS)
  })
}
