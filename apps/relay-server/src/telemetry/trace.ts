import type { IncomingMessage } from 'node:http'

import { now } from '../utils.js'
import type { RelayLogFields, RelayLogLevel } from './logger.js'
import { logRelayEvent } from './logger.js'
import type { RelayTelemetry, RelayTraceMetricsEvent } from './metrics.js'

const stringTraceKeys = new Set([
  'deviceId',
  'errorCode',
  'jobId',
  'requestId',
  'sessionId',
  'status',
  'traceId',
  'userId'
])

const numberTraceKeys = new Set([
  'payloadSizeBytes',
  'resultSizeBytes',
  'sessionCount'
])

const booleanTraceKeys = new Set([
  'resultAvailable'
])

const firstHeaderValue = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) return value[0]
  return value
}

const cleanString = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

export const traceContextFromRequest = (req: IncomingMessage) => ({
  requestId: cleanString(firstHeaderValue(req.headers['x-request-id'])),
  traceId: cleanString(firstHeaderValue(req.headers['x-trace-id']))
})

export const createTraceMetricsEvent = (
  level: RelayLogLevel,
  event: string,
  fields: RelayLogFields = {}
): RelayTraceMetricsEvent => {
  const traceEvent: RelayTraceMetricsEvent = {
    at: now(),
    event,
    level
  }
  for (const [key, value] of Object.entries(fields)) {
    if (stringTraceKeys.has(key)) {
      const cleaned = cleanString(value)
      if (cleaned != null) {
        traceEvent[
          key as keyof Pick<
            RelayTraceMetricsEvent,
            'deviceId' | 'errorCode' | 'jobId' | 'requestId' | 'sessionId' | 'status' | 'traceId' | 'userId'
          >
        ] = cleaned
      }
      continue
    }
    if (numberTraceKeys.has(key) && typeof value === 'number' && Number.isFinite(value)) {
      traceEvent[key as keyof Pick<RelayTraceMetricsEvent, 'payloadSizeBytes' | 'resultSizeBytes' | 'sessionCount'>] =
        Math.max(0, value)
      continue
    }
    if (booleanTraceKeys.has(key) && typeof value === 'boolean') {
      traceEvent[key as keyof Pick<RelayTraceMetricsEvent, 'resultAvailable'>] = value
    }
  }
  return traceEvent
}

export const recordRelayTraceEvent = (
  telemetry: RelayTelemetry | undefined,
  level: RelayLogLevel,
  event: string,
  fields: RelayLogFields = {}
) => {
  telemetry?.metrics.recordTraceEvent(createTraceMetricsEvent(level, event, fields))
  logRelayEvent(level, event, fields)
}
