import { Buffer } from 'node:buffer'

import { redactEncodedCredentialCandidates } from './task-cache-credential-candidate'

const REDACTED_VALUE = '[REDACTED]'
const REDACTED_KEY = '__ONEWORKS_REDACTED_CREDENTIAL_KEY__'
const MIN_UNSCOPED_SECRET_LENGTH = 12

const normalizeSecretKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/gu, '')

export const isCredentialKey = (key: string) => {
  const normalized = normalizeSecretKey(key)
  return normalized === 'authorization' ||
    normalized === 'credential' ||
    normalized === 'credentials' ||
    normalized.endsWith('apikey') ||
    normalized.endsWith('password') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('token')
}

const secretVariants = (secret: string) =>
  Array.from(
    new Set([
      secret,
      encodeURIComponent(secret),
      Buffer.from(secret).toString('base64'),
      Buffer.from(secret).toString('base64url'),
      JSON.stringify(secret).slice(1, -1)
    ])
  ).filter(value => value !== '')

export const addSecretVariants = (
  secrets: Set<string>,
  value: string,
  rawSecrets?: Set<string>
) => {
  rawSecrets?.add(value)
  for (const variant of secretVariants(value)) secrets.add(variant)
}

const collectStrings = (
  value: unknown,
  secrets: Set<string>,
  rawSecrets: Set<string> | undefined,
  seen: WeakSet<object>
) => {
  if (typeof value === 'string') {
    addSecretVariants(secrets, value, rawSecrets)
    return
  }
  if (value == null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, secrets, rawSecrets, seen)
    return
  }
  for (const item of Object.values(value)) collectStrings(item, secrets, rawSecrets, seen)
}

export const collectConfigContentSecrets = (
  value: unknown,
  secrets: Set<string>,
  rawSecrets?: Set<string>,
  insideConfigContent = false,
  seenOutside = new WeakSet<object>(),
  seenInside = new WeakSet<object>()
) => {
  if (value == null || typeof value !== 'object') return
  const seen = insideConfigContent ? seenInside : seenOutside
  if (seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) {
      collectConfigContentSecrets(item, secrets, rawSecrets, insideConfigContent, seenOutside, seenInside)
    }
    return
  }
  for (const [key, item] of Object.entries(value)) {
    const nextInsideConfigContent = insideConfigContent || key === 'configContent'
    if (nextInsideConfigContent && isCredentialKey(key)) {
      collectStrings(item, secrets, rawSecrets, new WeakSet<object>())
      continue
    }
    collectConfigContentSecrets(
      item,
      secrets,
      rawSecrets,
      nextInsideConfigContent,
      seenOutside,
      seenInside
    )
  }
}

const contextualSecretPrefixes = [
  /\bFACTORY_(?:API_KEY|TOKEN)\s*[:=]\s*(["']?)$/iu,
  /["']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|authorization)["']?\s*[:=]\s*(["']?)$/iu,
  /\bAuthorization\s*[:=]\s*(?:Bearer\s+)?(["']?)$/iu,
  /\bBearer\s+(["']?)$/iu,
  /[?&](?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password)=\s*(["']?)$/iu
]

const isAssignmentTerminator = (value: string | undefined) => value == null || /[\s,;|)#}\]&]/u.test(value)

const percentEscapePattern = /%[0-9a-f]{2}/giu
const hasPercentEscape = (value: string) => /%[0-9a-f]{2}/iu.test(value)
const normalizePercentEscapes = (value: string) => value.replace(percentEscapePattern, escape => escape.toUpperCase())

const hasCredentialAssignmentContext = (value: string, start: number, end: number) => {
  const prefix = value.slice(0, start)
  for (const pattern of contextualSecretPrefixes) {
    const match = pattern.exec(prefix)
    if (match == null) continue
    const quote = match[1] ?? ''
    const next = value[end]
    return quote === '' ? isAssignmentTerminator(next) : next === quote || next == null
  }
  return false
}

const redactKnownSecret = (value: string, secret: string, requireCredentialContext: boolean) => {
  const percentEncoded = hasPercentEscape(secret)
  const comparableValue = percentEncoded ? normalizePercentEscapes(value) : value
  const comparableSecret = percentEncoded ? normalizePercentEscapes(secret) : secret
  let cursor = 0
  let sanitized = ''
  while (cursor < value.length) {
    const start = comparableValue.indexOf(comparableSecret, cursor)
    if (start < 0) return sanitized + value.slice(cursor)
    const end = start + secret.length
    sanitized += value.slice(cursor, start)
    if (!requireCredentialContext || hasCredentialAssignmentContext(value, start, end)) {
      sanitized += REDACTED_VALUE
    } else {
      sanitized += value.slice(start, end)
    }
    cursor = end
  }
  return sanitized
}

export const createKnownSecretRedactor = (
  secretSet: ReadonlySet<string>,
  rawSecretSet: ReadonlySet<string> = secretSet
) => {
  const secrets = [...secretSet].sort((left, right) => right.length - left.length)
  const normalizedPercentSecrets = new Set(
    secrets.filter(hasPercentEscape).map(normalizePercentEscapes)
  )
  const redactText = (value: string) => {
    if (
      secretSet.has(value) ||
      (hasPercentEscape(value) && normalizedPercentSecrets.has(normalizePercentEscapes(value)))
    ) return REDACTED_VALUE
    let sanitized = redactEncodedCredentialCandidates(value, rawSecretSet, REDACTED_VALUE)
    for (const secret of secrets) {
      sanitized = redactKnownSecret(sanitized, secret, true)
      if (secret.length >= MIN_UNSCOPED_SECRET_LENGTH) {
        sanitized = redactKnownSecret(sanitized, secret, false)
      }
    }
    return sanitized
  }
  return {
    redactText,
    redactKey: (key: string) => {
      const sanitized = redactText(key)
      return sanitized === REDACTED_VALUE ? REDACTED_KEY : sanitized
    }
  }
}

export const uniqueSanitizedKey = (key: string, usedKeys: Set<string>) => {
  if (!usedKeys.has(key)) return key
  let index = 2
  while (usedKeys.has(`${key}_${index}`)) index += 1
  return `${key}_${index}`
}
