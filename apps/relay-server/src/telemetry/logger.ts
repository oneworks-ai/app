import process from 'node:process'
import pino from 'pino'

export type RelayLogLevel = 'debug' | 'error' | 'info' | 'warn'

export interface RelayLogFields {
  [key: string]: unknown
}

const redactField = (key: string, value: unknown) => {
  const normalized = key.toLowerCase()
  if (
    normalized === 'message' ||
    normalized === 'content' ||
    normalized === 'result' ||
    normalized === 'body' ||
    normalized === 'payload' ||
    normalized === 'authorization' ||
    normalized === 'cookie' ||
    normalized === 'set-cookie'
  ) {
    return undefined
  }
  if (
    normalized.includes('token') ||
    normalized.includes('secret') ||
    normalized.includes('password')
  ) {
    return undefined
  }
  return value
}

const sanitizeLogValue = (key: string, value: unknown): unknown | undefined => {
  const redacted = redactField(key, value)
  if (redacted == null || typeof redacted !== 'object') return redacted
  if (Array.isArray(redacted)) {
    return redacted.map(item => sanitizeLogValue('', item)).filter(item => item !== undefined)
  }
  const sanitized: RelayLogFields = {}
  for (const [childKey, childValue] of Object.entries(redacted)) {
    const nextValue = sanitizeLogValue(childKey, childValue)
    if (nextValue !== undefined) sanitized[childKey] = nextValue
  }
  return sanitized
}

const logger = pino({
  base: {
    service: 'relay-server'
  },
  level: process.env.ONEWORKS_RELAY_LOG_LEVEL || 'info',
  timestamp: pino.stdTimeFunctions.isoTime
})

export const sanitizeRelayLogFields = (fields: RelayLogFields = {}) => {
  const sanitizedFields: RelayLogFields = {}
  for (const [key, value] of Object.entries(fields)) {
    const sanitized = sanitizeLogValue(key, value)
    if (sanitized !== undefined) sanitizedFields[key] = sanitized
  }
  return sanitizedFields
}

export const logRelayEvent = (level: RelayLogLevel, event: string, fields: RelayLogFields = {}) => {
  const body: RelayLogFields = {
    event,
    ...sanitizeRelayLogFields(fields)
  }
  logger[level](body)
}
