import process from 'node:process'

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

const levelWeights: Record<RelayLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
}

const readLogLevel = (value: unknown): RelayLogLevel => (
  value === 'debug' || value === 'info' || value === 'warn' || value === 'error'
    ? value
    : 'info'
)

const shouldLog = (level: RelayLogLevel) =>
  levelWeights[level] >= levelWeights[readLogLevel(process.env.ONEWORKS_RELAY_LOG_LEVEL)]

const writeStructuredLog = (level: RelayLogLevel, body: RelayLogFields) => {
  if (!shouldLog(level)) return
  const payload = {
    level,
    time: new Date().toISOString(),
    service: 'relay-server',
    ...body
  }
  const line = JSON.stringify(payload)
  if (level === 'error') {
    console.error(line)
    return
  }
  if (level === 'warn') {
    console.warn(line)
    return
  }
  console.log(line)
}

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
  writeStructuredLog(level, body)
}
