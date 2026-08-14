/* eslint-disable max-lines -- One recursive boundary owns every Kiro persistence and logging representation. */
import { Buffer } from 'node:buffer'

import type { AdapterCtx, Logger } from '@oneworks/types'

const REDACTED_KIRO_CREDENTIAL = '[redacted Kiro credential]'
const SHORT_SECRET_LENGTH = 8

const KIRO_PROCESS_ONLY_CREDENTIAL_ENV_NAMES = new Set([
  'KIRO_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_SECURITY_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'AWS_CONFIG_FILE',
  'AWS_SHARED_CREDENTIALS_FILE',
  'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE'
])

export const isKiroProcessOnlyCredentialEnvName = (name: string) => {
  const normalized = name.toUpperCase()
  return KIRO_PROCESS_ONLY_CREDENTIAL_ENV_NAMES.has(normalized) ||
    (normalized.startsWith('KIRO_') && /(?:API_KEY|TOKEN|SECRET|PASSWORD)$/u.test(normalized))
}

const encodeUrlFormValue = (value: string) => {
  const encoded = new URLSearchParams({ value }).toString()
  return encoded.slice(encoded.indexOf('=') + 1)
}

const lowercasePercentEscapes = (value: string) => (
  value.replace(/%[0-9A-F]{2}/gu, match => match.toLowerCase())
)

const decodePercentByteRuns = (value: string) => (
  value.replace(/(?:%[0-9A-F]{2})+/giu, (sequence) => {
    const bytes = sequence.match(/[0-9A-F]{2}/giu)?.map(byte => Number.parseInt(byte, 16)) ?? []
    return Buffer.from(bytes).toString('utf8')
  })
)

const buildPercentDecodedCandidates = (value: string) => {
  const candidates = new Set([value])
  let frontier = [value]
  for (let depth = 0; depth < 4 && frontier.length > 0; depth += 1) {
    const next: string[] = []
    for (const candidate of frontier) {
      for (const input of [candidate, candidate.replaceAll('+', ' ')]) {
        const decoded = decodePercentByteRuns(input)
        if (decoded === candidate || candidates.has(decoded)) continue
        candidates.add(decoded)
        next.push(decoded)
      }
    }
    frontier = next
  }
  return [...candidates]
}

const buildSecretVariants = (secret: string) => {
  const standardBase64 = Buffer.from(secret, 'utf8').toString('base64')
  const urlBase64 = Buffer.from(secret, 'utf8').toString('base64url')
  const urlEncoded = encodeURIComponent(secret)
  const formEncoded = encodeUrlFormValue(secret)
  return [
    ...new Set([
      secret,
      urlEncoded,
      lowercasePercentEscapes(urlEncoded),
      formEncoded,
      lowercasePercentEscapes(formEncoded),
      standardBase64,
      standardBase64.replace(/=+$/u, ''),
      urlBase64,
      `${urlBase64}${'='.repeat((4 - (urlBase64.length % 4)) % 4)}`
    ].filter(value => value !== ''))
  ].sort((left, right) => right.length - left.length)
}

interface SecretPattern {
  short: boolean
  variants: string[]
}

const collectSecretPatterns = (env: AdapterCtx['env']) => {
  const patterns: SecretPattern[] = []
  const seen = new Set<string>()
  for (const [name, value] of Object.entries(env)) {
    if (!isKiroProcessOnlyCredentialEnvName(name) || typeof value !== 'string' || value === '' || seen.has(value)) {
      continue
    }
    seen.add(value)
    patterns.push({
      short: value.length < SHORT_SECRET_LENGTH,
      variants: buildSecretVariants(value)
    })
  }
  return patterns
}

const redactString = (value: string, patterns: SecretPattern[]) => {
  let redacted = value
  for (const pattern of patterns) {
    const hasDirectMatch = pattern.variants.some(variant => redacted.includes(variant))
    const hasPercentEquivalent = buildPercentDecodedCandidates(redacted).slice(1)
      .some(candidate => pattern.variants.some(variant => candidate.includes(variant)))
    if (!hasDirectMatch && !hasPercentEquivalent) continue
    if (pattern.short) return REDACTED_KIRO_CREDENTIAL
    if (hasPercentEquivalent) return REDACTED_KIRO_CREDENTIAL
    for (const variant of pattern.variants) {
      redacted = redacted.replaceAll(variant, REDACTED_KIRO_CREDENTIAL)
    }
  }
  return redacted
}

const shouldDropSensitiveKey = (key: string, patterns: SecretPattern[]) => (
  isKiroProcessOnlyCredentialEnvName(key) || redactString(key, patterns) !== key
)

const scrubValue = (
  value: unknown,
  patterns: SecretPattern[],
  seen: WeakMap<object, unknown>
): unknown => {
  if (typeof value === 'string') return redactString(value, patterns)
  if (value == null || typeof value !== 'object') return value
  if (value instanceof Date || ArrayBuffer.isView(value)) return value
  if (value instanceof Error) {
    const error = new Error(redactString(value.message, patterns))
    error.name = value.name
    if (value.stack != null) error.stack = redactString(value.stack, patterns)
    return error
  }
  const existing = seen.get(value)
  if (existing != null) return existing
  if (Array.isArray(value)) {
    const result: unknown[] = []
    seen.set(value, result)
    result.push(...value.map(item => scrubValue(item, patterns, seen)))
    return result
  }
  if (value instanceof Map) {
    const result = new Map<unknown, unknown>()
    seen.set(value, result)
    for (const [key, entry] of value) {
      if (typeof key === 'string' && shouldDropSensitiveKey(key, patterns)) continue
      const scrubbedKey = scrubValue(key, patterns, seen)
      if (result.has(scrubbedKey)) continue
      result.set(scrubbedKey, scrubValue(entry, patterns, seen))
    }
    return result
  }
  if (value instanceof Set) {
    const result = new Set<unknown>()
    seen.set(value, result)
    for (const entry of value) result.add(scrubValue(entry, patterns, seen))
    return result
  }

  const result: Record<string, unknown> = {}
  seen.set(value, result)
  for (const [key, entry] of Object.entries(value)) {
    if (shouldDropSensitiveKey(key, patterns)) continue
    result[key] = scrubValue(entry, patterns, seen)
  }
  return result
}

export interface KiroPersistenceBoundary {
  scrub: <T>(value: T) => T
  wrapLogger: (logger: Logger) => Logger
}

export const createKiroPersistenceBoundary = (env: AdapterCtx['env']): KiroPersistenceBoundary => {
  const patterns = collectSecretPatterns(env)
  const scrub = <T>(value: T): T => scrubValue(value, patterns, new WeakMap()) as T
  const wrapLogger = (logger: Logger): Logger => {
    const wrap = (method: Logger['info']) => (...args: unknown[]) => method(...scrub(args))
    return {
      stream: logger.stream,
      ...(logger.paths == null ? {} : { paths: logger.paths }),
      info: wrap(logger.info),
      warn: wrap(logger.warn),
      debug: wrap(logger.debug),
      error: wrap(logger.error)
    }
  }
  return { scrub, wrapLogger }
}

export const applyKiroPersistenceBoundary = (
  ctx: AdapterCtx,
  boundary: KiroPersistenceBoundary
): AdapterCtx => ({
  ...ctx,
  configs: boundary.scrub(ctx.configs),
  ...(ctx.configState == null ? {} : { configState: boundary.scrub(ctx.configState) }),
  logger: boundary.wrapLogger(ctx.logger)
})
