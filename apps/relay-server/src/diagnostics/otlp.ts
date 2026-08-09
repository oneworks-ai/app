import { createHash, randomUUID } from 'node:crypto'

import type { RelayDiagnosticCategory, RelayDiagnosticEvent, RelayDiagnosticSource } from '../types.js'
import { isRecord } from '../utils.js'

type SafeScalar = boolean | number | string

export interface NormalizeOtlpLogsOptions {
  deviceId?: string
  now?: Date
  userId: string
}

const SAFE_IDENTIFIER = /^\w[\w.-]{0,159}$/u
const SAFE_EVENT_NAME = /^(?:codex|oneworks)(?:\.[\w-]+)+$/u

const correlationId = (value: string | undefined) =>
  value == null
    ? undefined
    : createHash('sha256').update(value).digest('hex').slice(0, 24)

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

const safeIdentifier = (value: SafeScalar | undefined) => {
  const string = typeof value === 'string' ? value.trim() : value == null ? '' : String(value)
  return SAFE_IDENTIFIER.test(string) ? string : undefined
}

const finiteDuration = (...values: Array<SafeScalar | undefined>) => {
  for (const value of values) {
    const number = Number(value)
    if (Number.isFinite(number) && number >= 0 && number <= 86_400_000) return number
  }
  return undefined
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

const eventNameFrom = (record: Record<string, unknown>, attributes: Map<string, SafeScalar>) => {
  const attributeName = safeIdentifier(attributes.get('event.name'))
  if (attributeName != null) return attributeName
  const body = readAnyValue(record.body)
  return typeof body === 'string' && SAFE_EVENT_NAME.test(body) ? body : 'diagnostic.event'
}

const sourceFrom = (serviceName: string, eventName: string): RelayDiagnosticSource => {
  if (serviceName.toLowerCase().includes('codex') || eventName.startsWith('codex.')) return 'codex'
  if (serviceName.toLowerCase().includes('oneworks') || eventName.startsWith('oneworks.')) return 'oneworks'
  return 'other'
}

const categoryFrom = (eventName: string, operationName: string | undefined): RelayDiagnosticCategory => {
  const value = `${eventName}.${operationName ?? ''}`.toLowerCase()
  if (value.includes('javascript.error') || value.includes('exception')) return 'error'
  if (value.includes('startup') || value.includes('launch')) return 'startup'
  if (value.includes('auth') || value.includes('login')) return 'auth'
  if (value.includes('tool')) return 'tool'
  if (value.includes('api') || value.includes('http') || value.includes('sse') || value.includes('websocket')) {
    return 'network'
  }
  if (value.includes('command') || value.includes('cli')) return 'command'
  if (value.includes('conversation') || value.includes('agent')) return 'agent'
  return 'other'
}

const severityFrom = (record: Record<string, unknown>) => {
  const text = safeIdentifier(record.severityText as SafeScalar | undefined)
  if (text != null) return text.toUpperCase()
  const number = Number(record.severityNumber)
  if (number >= 17) return 'ERROR'
  if (number >= 13) return 'WARN'
  if (number >= 9) return 'INFO'
  return 'UNSPECIFIED'
}

const eventFromRecord = (params: {
  options: Required<Pick<NormalizeOtlpLogsOptions, 'userId'>> & Omit<NormalizeOtlpLogsOptions, 'userId'>
  record: Record<string, unknown>
  resource: Map<string, SafeScalar>
  receivedAt: string
}): RelayDiagnosticEvent => {
  const attributes = attributesFrom(params.record.attributes)
  const eventName = eventNameFrom(params.record, attributes)
  const serviceName = safeIdentifier(params.resource.get('service.name')) ?? 'unknown'
  const operationName = safeIdentifier(attributes.get('oneworks.operation.name'))
  const outcome = safeIdentifier(attributes.get('oneworks.operation.outcome')) ??
    safeIdentifier(attributes.get('status'))
  const category = categoryFrom(eventName, operationName)
  const success = booleanAttribute(attributes.get('success')) ??
    booleanAttribute(attributes.get('oneworks.success')) ??
    (outcome == null ? undefined : outcome === 'success' || outcome === 'succeeded' || outcome === 'ok')
  const errorCode = safeIdentifier(attributes.get('oneworks.operation.failure.code')) ??
    safeIdentifier(attributes.get('error.type')) ?? safeIdentifier(attributes.get('error.code'))
  const errorFingerprint = safeIdentifier(attributes.get('oneworks.operation.failure.fingerprint'))
  const session = safeIdentifier(attributes.get('oneworks.context.agent_session_id')) ??
    safeIdentifier(attributes.get('oneworks.context.app_session_id')) ??
    safeIdentifier(attributes.get('conversation.id')) ?? safeIdentifier(attributes.get('session.id'))
  const trace = safeIdentifier(attributes.get('oneworks.context.trace_id')) ??
    safeIdentifier(params.record.traceId as SafeScalar | undefined)

  return {
    architecture: safeIdentifier(params.resource.get('host.arch')),
    category,
    deviceId: params.options.deviceId,
    durationMs: finiteDuration(
      attributes.get('oneworks.operation.duration_ms'),
      attributes.get('duration_ms'),
      attributes.get('request.duration_ms')
    ),
    errorCode,
    errorFingerprint,
    environment: safeIdentifier(params.resource.get('deployment.environment.name')),
    eventName,
    failureDomain: safeIdentifier(attributes.get('oneworks.operation.failure.domain')) ??
      (errorCode == null ? undefined : category),
    id: randomUUID(),
    operationId: correlationId(safeIdentifier(attributes.get('oneworks.operation.id'))),
    operationName,
    outcome,
    platform: safeIdentifier(params.resource.get('os.type')),
    occurredAt: fromUnixNano(params.record.timeUnixNano, params.receivedAt),
    receivedAt: params.receivedAt,
    releaseChannel: safeIdentifier(params.resource.get('oneworks.release.channel')),
    serviceName,
    serviceVersion: safeIdentifier(params.resource.get('service.version')) ??
      safeIdentifier(attributes.get('app.version')),
    sessionId: correlationId(session),
    severity: severityFrom(params.record),
    source: sourceFrom(serviceName, eventName),
    stage: safeIdentifier(attributes.get('oneworks.operation.stage')),
    success,
    surface: safeIdentifier(params.resource.get('oneworks.surface')),
    traceId: correlationId(trace),
    userId: params.options.userId
  }
}

export const normalizeOtlpLogs = (body: unknown, options: NormalizeOtlpLogsOptions) => {
  if (!isRecord(body) || !Array.isArray(body.resourceLogs)) return []
  const receivedAt = (options.now ?? new Date()).toISOString()
  const events: RelayDiagnosticEvent[] = []
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
        events.push(eventFromRecord({ options, receivedAt, record: logRecord, resource }))
      }
    }
  }
  return events
}
