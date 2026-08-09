import { randomUUID } from 'node:crypto'
import process from 'node:process'

import type { RelayModelUsageEvent, RelayStore } from '../types.js'
import { isRecord } from '../utils.js'

const DEFAULT_RETENTION_DAYS = 90
const DEFAULT_MAX_EVENTS = 100_000
const MAX_COUNT = 1_000_000_000_000

const optionalString = (value: unknown, maximum = 160) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, maximum) : undefined
)

const requiredString = (value: unknown, fallback: string, maximum = 160) => (
  optionalString(value, maximum) ?? fallback
)

const count = (value: unknown, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.min(MAX_COUNT, Math.trunc(number)) : fallback
}

export const normalizeRelayModelUsageEvent = (
  value: Record<string, unknown>
): RelayModelUsageEvent | undefined => {
  const teamId = optionalString(value.teamId)
  const userId = optionalString(value.userId)
  const scope = value.scope === 'personal' ? 'personal' : value.scope === 'team' || teamId != null ? 'team' : undefined
  if (scope == null || userId == null || (scope === 'team' && teamId == null)) return undefined
  const source = value.source
  return {
    adapter: optionalString(value.adapter),
    cacheCreationInputTokens: count(value.cacheCreationInputTokens),
    cachedInputTokens: count(value.cachedInputTokens),
    deviceId: optionalString(value.deviceId),
    durationMs: value.durationMs == null ? undefined : count(value.durationMs),
    id: requiredString(value.id, randomUUID()),
    inputTokens: count(value.inputTokens),
    model: requiredString(value.model, 'unknown'),
    modelService: requiredString(value.modelService, 'unknown'),
    occurredAt: requiredString(value.occurredAt, new Date().toISOString()),
    outputTokens: count(value.outputTokens),
    receivedAt: requiredString(value.receivedAt, new Date().toISOString()),
    requestCount: count(value.requestCount, 1),
    serviceName: requiredString(value.serviceName, 'unknown'),
    serviceVersion: optionalString(value.serviceVersion),
    sessionId: optionalString(value.sessionId),
    scope,
    source: source === 'codex' || source === 'oneworks' ? source : 'other',
    success: value.success !== false,
    ...(scope === 'team' ? { teamId } : {}),
    userId
  }
}

const positiveIntegerFromEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

export const modelUsageRetention = () => ({
  days: positiveIntegerFromEnv('ONEWORKS_RELAY_MODEL_USAGE_RETENTION_DAYS', DEFAULT_RETENTION_DAYS),
  maxEvents: positiveIntegerFromEnv('ONEWORKS_RELAY_MODEL_USAGE_MAX_EVENTS', DEFAULT_MAX_EVENTS)
})

export const appendRelayModelUsageEvents = (store: RelayStore, events: RelayModelUsageEvent[], now = new Date()) => {
  const retention = modelUsageRetention()
  const cutoff = now.getTime() - retention.days * 24 * 60 * 60 * 1_000
  const seen = new Set<string>()
  store.modelUsageEvents = [...(store.modelUsageEvents ?? []), ...events]
    .filter(event => Date.parse(event.receivedAt) >= cutoff)
    .filter(event => {
      const key = `${event.scope}:${event.teamId ?? event.userId}:${event.userId}:${event.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(-retention.maxEvents)
}

export const normalizeRelayModelUsageEvents = (value: unknown, now = new Date()) => {
  const retention = modelUsageRetention()
  const cutoff = now.getTime() - retention.days * 24 * 60 * 60 * 1_000
  return (Array.isArray(value)
    ? value.filter(isRecord).map(normalizeRelayModelUsageEvent).filter((event): event is RelayModelUsageEvent => (
      event != null
    ))
    : [])
    .filter(event => Date.parse(event.receivedAt) >= cutoff)
    .slice(-retention.maxEvents)
}
