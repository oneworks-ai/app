import { createHash, randomUUID } from 'node:crypto'

import type { RelayDiagnosticSource, RelayModelUsageEvent } from '../types.js'
import { isRecord } from '../utils.js'

type SafeScalar = boolean | number | string

export interface NormalizeOtlpModelUsageOptions {
  deviceId?: string
  now?: Date
  scope: 'personal' | 'team'
  teamId?: string
  userId: string
}

const SAFE_DIMENSION = /^[A-Za-z\d][\w.:/-]{0,159}$/u
const MAX_COUNT = 1_000_000_000_000

const readAnyValue = (value: unknown): SafeScalar | undefined => {
  if (!isRecord(value)) return undefined
  if (typeof value.stringValue === 'string') return value.stringValue
  if (typeof value.boolValue === 'boolean') return value.boolValue
  if (typeof value.intValue === 'string' || typeof value.intValue === 'number') {
    const number = Number(value.intValue)
    return Number.isFinite(number) ? number : undefined
  }
  if (typeof value.doubleValue === 'number' && Number.isFinite(value.doubleValue)) return value.doubleValue
  return undefined
}

const attributesFrom = (value: unknown) => {
  const result = new Map<string, SafeScalar>()
  if (!Array.isArray(value)) return result
  for (const item of value) {
    if (!isRecord(item) || typeof item.key !== 'string') continue
    const attribute = readAnyValue(item.value)
    if (attribute != null) result.set(item.key, attribute)
  }
  return result
}

const safeDimension = (value: SafeScalar | undefined) => {
  const text = typeof value === 'string' ? value.trim() : value == null ? '' : String(value)
  return SAFE_DIMENSION.test(text) && !text.includes('://') && !text.includes('..') ? text : undefined
}

const safeCount = (...values: Array<SafeScalar | undefined>) => {
  for (const value of values) {
    const number = Number(value)
    if (Number.isFinite(number) && number >= 0) return Math.min(MAX_COUNT, Math.trunc(number))
  }
  return 0
}

const safeDuration = (...values: Array<SafeScalar | undefined>) => {
  const value = safeCount(...values)
  return value <= 86_400_000 ? value : undefined
}

const booleanAttribute = (value: SafeScalar | undefined) => {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

const fromUnixNano = (value: unknown, fallback: string) => {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback
  try {
    const milliseconds = Number(BigInt(value) / 1_000_000n)
    const date = new Date(milliseconds)
    return Number.isFinite(date.getTime()) ? date.toISOString() : fallback
  } catch {
    return fallback
  }
}

const correlationId = (value: string | undefined) =>
  value == null
    ? undefined
    : createHash('sha256').update(value).digest('hex').slice(0, 24)

const eventNameFrom = (record: Record<string, unknown>, attributes: Map<string, SafeScalar>) => (
  safeDimension(attributes.get('event.name')) ?? safeDimension(readAnyValue(record.body))
)

const sourceFrom = (serviceName: string, eventName: string): RelayDiagnosticSource => {
  if (serviceName.toLowerCase().includes('codex') || eventName.startsWith('codex.')) return 'codex'
  if (serviceName.toLowerCase().includes('oneworks') || eventName.startsWith('oneworks.')) return 'oneworks'
  return 'other'
}

const modelUsageFromRecord = (params: {
  options: NormalizeOtlpModelUsageOptions
  receivedAt: string
  record: Record<string, unknown>
  resource: Map<string, SafeScalar>
}): RelayModelUsageEvent | undefined => {
  const attributes = attributesFrom(params.record.attributes)
  const eventName = eventNameFrom(params.record, attributes)
  if (eventName == null) return undefined
  const codexEventKind = safeDimension(attributes.get('event.kind'))
  const oneworksUsage = eventName === 'oneworks.model.usage'
  const codexUsage = eventName === 'codex.sse_event' && codexEventKind === 'response.completed'
  if (!oneworksUsage && !codexUsage) return undefined

  const inputTokens = safeCount(
    attributes.get('gen_ai.usage.input_tokens'),
    attributes.get('input_token_count')
  )
  const outputTokens = safeCount(
    attributes.get('gen_ai.usage.output_tokens'),
    attributes.get('output_token_count')
  )
  const cachedInputTokens = safeCount(
    attributes.get('oneworks.model.usage.cached_input_tokens'),
    attributes.get('cached_token_count')
  )
  const cacheCreationInputTokens = safeCount(attributes.get('oneworks.model.usage.cache_creation_input_tokens'))
  if (inputTokens + outputTokens + cachedInputTokens + cacheCreationInputTokens === 0) return undefined

  const serviceName = safeDimension(params.resource.get('service.name')) ?? 'unknown'
  const source = sourceFrom(serviceName, eventName)
  const model = safeDimension(attributes.get('gen_ai.request.model')) ??
    safeDimension(attributes.get('model')) ?? 'unknown'
  const modelService = safeDimension(attributes.get('oneworks.model.service')) ??
    safeDimension(attributes.get('provider_name')) ?? (source === 'codex' ? 'codex' : 'unknown')
  const rawSessionId = safeDimension(attributes.get('oneworks.context.agent_session_id')) ??
    safeDimension(attributes.get('conversation.id')) ?? safeDimension(attributes.get('session.id'))
  const clientEventId = safeDimension(attributes.get('oneworks.model.usage.event_id'))

  return {
    adapter: safeDimension(attributes.get('oneworks.model.adapter')) ?? (source === 'codex' ? 'codex' : undefined),
    cacheCreationInputTokens,
    cachedInputTokens,
    deviceId: params.options.deviceId,
    durationMs: safeDuration(
      attributes.get('oneworks.model.usage.duration_ms'),
      attributes.get('duration_ms')
    ),
    id: clientEventId == null
      ? randomUUID()
      : correlationId(
        `${params.options.scope}:${
          params.options.teamId ?? params.options.userId
        }:${params.options.userId}:${clientEventId}`
      ) ?? randomUUID(),
    inputTokens,
    model,
    modelService,
    occurredAt: fromUnixNano(params.record.timeUnixNano, params.receivedAt),
    outputTokens,
    receivedAt: params.receivedAt,
    requestCount: safeCount(attributes.get('oneworks.model.usage.request_count')) || 1,
    serviceName,
    serviceVersion: safeDimension(params.resource.get('service.version')) ??
      safeDimension(attributes.get('app.version')),
    sessionId: correlationId(rawSessionId),
    scope: params.options.scope,
    source,
    success: booleanAttribute(attributes.get('oneworks.model.usage.success')) ??
      booleanAttribute(attributes.get('success')) ?? true,
    ...(params.options.scope === 'team' && params.options.teamId != null
      ? { teamId: params.options.teamId }
      : {}),
    userId: params.options.userId
  }
}

export const normalizeOtlpModelUsage = (body: unknown, options: NormalizeOtlpModelUsageOptions) => {
  if (!isRecord(body) || !Array.isArray(body.resourceLogs)) return []
  const receivedAt = (options.now ?? new Date()).toISOString()
  const events: RelayModelUsageEvent[] = []
  for (const resourceLog of body.resourceLogs) {
    if (!isRecord(resourceLog)) continue
    const resource = isRecord(resourceLog.resource)
      ? attributesFrom(resourceLog.resource.attributes)
      : new Map<string, SafeScalar>()
    if (!Array.isArray(resourceLog.scopeLogs)) continue
    for (const scopeLog of resourceLog.scopeLogs) {
      if (!isRecord(scopeLog) || !Array.isArray(scopeLog.logRecords)) continue
      for (const logRecord of scopeLog.logRecords) {
        if (!isRecord(logRecord)) continue
        const event = modelUsageFromRecord({ options, receivedAt, record: logRecord, resource })
        if (event != null) events.push(event)
      }
    }
  }
  return events
}
