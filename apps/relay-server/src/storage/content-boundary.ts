const relayContentStorageKeys = new Set([
  'content',
  'lastmessage',
  'lastusermessage',
  'message',
  'result'
])

export const isRelayContentStorageKey = (key: string) => relayContentStorageKeys.has(key.toLowerCase())

export const sanitizeRelayStorageValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeRelayStorageValue(item))
  }
  if (value == null || typeof value !== 'object') {
    return value
  }

  const sanitized: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (!isRelayContentStorageKey(key)) {
      sanitized[key] = sanitizeRelayStorageValue(item)
    }
  }
  return sanitized
}
