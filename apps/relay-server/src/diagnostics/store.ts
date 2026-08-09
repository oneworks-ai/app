import { randomUUID } from 'node:crypto'
import process from 'node:process'

import type { RelayDiagnosticEvent, RelayStore } from '../types.js'
import { isRecord } from '../utils.js'

const DEFAULT_RETENTION_DAYS = 30
const DEFAULT_MAX_EVENTS = 10_000

const optionalString = (value: unknown, maximum = 160) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, maximum) : undefined
)

const requiredString = (value: unknown, fallback: string, maximum = 160) => (
  optionalString(value, maximum) ?? fallback
)

const finiteNumber = (value: unknown) => {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

export const normalizeRelayDiagnosticEvent = (value: Record<string, unknown>): RelayDiagnosticEvent | undefined => {
  const userId = optionalString(value.userId)
  if (userId == null) return undefined
  const category = value.category
  const source = value.source
  return {
    architecture: optionalString(value.architecture),
    category: category === 'agent' || category === 'auth' || category === 'command' || category === 'error' ||
        category === 'network' ||
        category === 'startup' || category === 'tool'
      ? category
      : 'other',
    deviceId: optionalString(value.deviceId),
    durationMs: finiteNumber(value.durationMs),
    errorCode: optionalString(value.errorCode),
    errorFingerprint: optionalString(value.errorFingerprint, 64),
    environment: optionalString(value.environment),
    eventName: requiredString(value.eventName, 'unknown'),
    failureDomain: optionalString(value.failureDomain),
    id: requiredString(value.id, randomUUID()),
    operationId: optionalString(value.operationId),
    operationName: optionalString(value.operationName),
    outcome: optionalString(value.outcome, 32),
    platform: optionalString(value.platform),
    occurredAt: requiredString(value.occurredAt, new Date().toISOString()),
    receivedAt: requiredString(value.receivedAt, new Date().toISOString()),
    releaseChannel: optionalString(value.releaseChannel),
    serviceName: requiredString(value.serviceName, 'unknown'),
    serviceVersion: optionalString(value.serviceVersion),
    sessionId: optionalString(value.sessionId),
    severity: requiredString(value.severity, 'INFO', 24),
    source: source === 'codex' || source === 'oneworks' ? source : 'other',
    stage: optionalString(value.stage),
    success: typeof value.success === 'boolean' ? value.success : undefined,
    surface: optionalString(value.surface),
    traceId: optionalString(value.traceId),
    userId
  }
}

const positiveIntegerFromEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

export const diagnosticRetention = () => ({
  days: positiveIntegerFromEnv('ONEWORKS_RELAY_DIAGNOSTICS_RETENTION_DAYS', DEFAULT_RETENTION_DAYS),
  maxEvents: positiveIntegerFromEnv('ONEWORKS_RELAY_DIAGNOSTICS_MAX_EVENTS', DEFAULT_MAX_EVENTS)
})

export const appendRelayDiagnosticEvents = (store: RelayStore, events: RelayDiagnosticEvent[], now = new Date()) => {
  const retention = diagnosticRetention()
  const cutoff = now.getTime() - retention.days * 24 * 60 * 60 * 1_000
  store.diagnosticEvents = [...(store.diagnosticEvents ?? []), ...events]
    .filter(event => Date.parse(event.receivedAt) >= cutoff)
    .slice(-retention.maxEvents)
}

export const normalizeRelayDiagnosticEvents = (value: unknown, now = new Date()) => {
  const retention = diagnosticRetention()
  const cutoff = now.getTime() - retention.days * 24 * 60 * 60 * 1_000
  const events = Array.isArray(value)
    ? value.filter(isRecord).map(normalizeRelayDiagnosticEvent).filter((event): event is RelayDiagnosticEvent => (
      event != null
    ))
    : []
  return events
    .filter(event => Date.parse(event.receivedAt) >= cutoff)
    .slice(-retention.maxEvents)
}
