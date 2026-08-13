/* eslint-disable max-lines -- The allowlist and representation-aware persistence scrub form one credential boundary. */
import { Buffer } from 'node:buffer'

export const JUNIE_PROVIDER_AUTH_ENV_KEYS = {
  openai: ['JUNIE_OPENAI_API_KEY', 'OPENAI_API_KEY'],
  anthropic: ['JUNIE_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'],
  google: ['JUNIE_GOOGLE_API_KEY', 'GOOGLE_API_KEY'],
  xai: ['JUNIE_GROK_API_KEY', 'GROK_API_KEY'],
  openrouter: ['JUNIE_OPENROUTER_API_KEY', 'OPENROUTER_API_KEY'],
  copilot: [],
  litellm: ['JUNIE_LITELLM_API_KEY', 'LITELLM_API_KEY']
} as const

export type JunieAuthProvider = keyof typeof JUNIE_PROVIDER_AUTH_ENV_KEYS

export const JUNIE_PROVIDER_ROUTING_ENV_KEYS = {
  openai: [],
  anthropic: [],
  google: [],
  xai: [],
  openrouter: [],
  copilot: [],
  litellm: ['JUNIE_LITELLM_URL']
} as const satisfies Record<JunieAuthProvider, readonly string[]>

export const JUNIE_AUTH_ENV_KEYS = Object.freeze([
  'JUNIE_API_KEY',
  ...new Set(Object.values(JUNIE_PROVIDER_AUTH_ENV_KEYS).flat())
])

const JUNIE_AUTH_ENV_KEY_SET = new Set(JUNIE_AUTH_ENV_KEYS)
const JUNIE_RUNTIME_ENV_KEY_SET = new Set([
  ...JUNIE_AUTH_ENV_KEYS,
  ...Object.values(JUNIE_PROVIDER_ROUTING_ENV_KEYS).flat()
])
const OMIT_VALUE = Symbol('omit-junie-auth-value')
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u
const BASE64URL_PATTERN = /^[\w-]+={0,2}$/u
const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u
const GLOBAL_SECRET_VARIANT_MIN_LENGTH = 8

export const isJunieAuthEnvironmentKey = (key: string) => (
  JUNIE_AUTH_ENV_KEY_SET.has(key.normalize('NFKC').toUpperCase())
)

export const isJunieRuntimeEnvironmentKey = (key: string) => (
  JUNIE_RUNTIME_ENV_KEY_SET.has(key.normalize('NFKC').toUpperCase())
)

export const resolveJunieAuthEnvironmentKeys = (provider?: JunieAuthProvider) => (
  provider == null
    ? ['JUNIE_API_KEY'] as const
    : ['JUNIE_API_KEY', ...JUNIE_PROVIDER_AUTH_ENV_KEYS[provider]] as const
)

export const resolveJunieRuntimeEnvironmentKeys = (provider?: JunieAuthProvider) => (
  provider == null
    ? ['JUNIE_API_KEY'] as const
    : [
      'JUNIE_API_KEY',
      ...JUNIE_PROVIDER_AUTH_ENV_KEYS[provider],
      ...JUNIE_PROVIDER_ROUTING_ENV_KEYS[provider]
    ] as const
)

export const collectJunieAuthEnvironmentValues = (env: Record<string, unknown>) => (
  Object.entries(env).flatMap(([key, value]) => (
    isJunieAuthEnvironmentKey(key) && typeof value === 'string' && value !== '' ? [value] : []
  ))
)

const getGlobalSecretVariants = (values: readonly string[]) => (
  [
    ...new Set(values.flatMap((value) => {
      if (value.length < GLOBAL_SECRET_VARIANT_MIN_LENGTH) return []
      const encoded = Buffer.from(value, 'utf8')
      return [
        value,
        encodeURIComponent(value),
        JSON.stringify(value).slice(1, -1),
        encoded.toString('base64'),
        encoded.toString('base64url')
      ].filter(Boolean)
    }))
  ].sort((left, right) => right.length - left.length)
)

const decodeUtf8 = (value: Buffer) => {
  const decoded = value.toString('utf8')
  return Buffer.from(decoded, 'utf8').equals(value) ? decoded : undefined
}

const containsVariant = (value: string, variants: readonly string[]) => (
  variants.some(variant => value.includes(variant))
)

const sanitizeKnownJunieAuthValue = (
  input: unknown,
  variants: readonly string[],
  ancestors: WeakSet<object>
): unknown | typeof OMIT_VALUE => {
  const sanitizeString = (
    value: string,
    allowBase64 = true
  ): string | typeof OMIT_VALUE => {
    const trimmed = value.trim()
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length <= 1_000_000) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        const sanitized = sanitizeKnownJunieAuthValue(parsed, variants, new WeakSet())
        if (sanitized === OMIT_VALUE) return OMIT_VALUE
        const serialized = JSON.stringify(sanitized)
        return serialized === JSON.stringify(parsed) ? value : serialized
      } catch {
        // Continue through the other representation-aware checks.
      }
    }

    let candidate = value
    const isUri = URI_SCHEME_PATTERN.test(candidate)
    if (isUri) {
      try {
        const url = new URL(candidate)
        let changed = false
        if (containsVariant(url.username, variants) || containsVariant(url.password, variants)) {
          url.username = ''
          url.password = ''
          changed = true
        }
        for (const key of Array.from(new Set(url.searchParams.keys()))) {
          if (isJunieAuthEnvironmentKey(key)) {
            url.searchParams.delete(key)
            changed = true
          }
        }
        if (changed) candidate = url.toString()
      } catch {
        // Non-URL strings continue through the other checks.
      }
    }

    if (!isUri && candidate.includes('=') && !candidate.includes('\n') && !candidate.includes('\r')) {
      const prefix = candidate.startsWith('?') ? '?' : ''
      const source = prefix === '' ? candidate : candidate.slice(1)
      const entries = source.split('&')
      if (entries.every(entry => entry.includes('='))) {
        const params = new URLSearchParams(source)
        let changed = false
        for (const key of Array.from(new Set(params.keys()))) {
          if (isJunieAuthEnvironmentKey(key)) {
            params.delete(key)
            changed = true
          }
        }
        if (changed) {
          const sanitized = `${prefix}${params.toString()}`
          if (sanitized === '' || sanitized === '?') return OMIT_VALUE
          candidate = sanitized
        }
      }
    }

    if (allowBase64 && candidate.length >= 8 && candidate.length <= 1_000_000) {
      const isStandard = candidate.length % 4 === 0 && BASE64_PATTERN.test(candidate)
      const isUrl = BASE64URL_PATTERN.test(candidate)
      if (isStandard || isUrl) {
        try {
          const encoding = isStandard ? 'base64' : 'base64url'
          const decoded = decodeUtf8(Buffer.from(candidate, encoding))
          if (decoded != null) {
            const sanitized = sanitizeString(decoded, false)
            if (sanitized === OMIT_VALUE) return OMIT_VALUE
            if (sanitized !== decoded) {
              const encoded = Buffer.from(sanitized, 'utf8').toString(encoding)
              return encoding === 'base64url' && !candidate.endsWith('=') ? encoded.replace(/=+$/u, '') : encoded
            }
          }
        } catch {
          // Invalid encodings fall through to literal variant replacement.
        }
      }
    }

    let sanitized = candidate
    for (const variant of variants) sanitized = sanitized.replaceAll(variant, '[REDACTED]')
    return sanitized
  }

  if (typeof input === 'string') return sanitizeString(input)
  if (input == null || typeof input === 'boolean' || typeof input === 'number') return input
  if (typeof input === 'bigint') return input.toString()
  if (typeof input === 'function' || typeof input === 'symbol' || typeof input === 'undefined') return OMIT_VALUE
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? OMIT_VALUE : input.toISOString()
  if (input instanceof URL) return sanitizeString(input.toString())
  if (input instanceof URLSearchParams) return sanitizeString(input.toString())
  if (Buffer.isBuffer(input)) {
    const decoded = decodeUtf8(input)
    if (decoded == null) return Array.from(input)
    const sanitized = sanitizeString(decoded)
    return sanitized === decoded ? Array.from(input) : sanitized
  }
  if (ArrayBuffer.isView(input)) return Array.from(new Uint8Array(input.buffer, input.byteOffset, input.byteLength))
  if (input instanceof ArrayBuffer) return Array.from(new Uint8Array(input))
  if (ancestors.has(input)) return OMIT_VALUE
  ancestors.add(input)

  let output: unknown
  if (Array.isArray(input)) {
    output = input.flatMap((item) => {
      const sanitized = sanitizeKnownJunieAuthValue(item, variants, ancestors)
      return sanitized === OMIT_VALUE ? [] : [sanitized]
    })
  } else if (input instanceof Set) {
    output = Array.from(input).flatMap((item) => {
      const sanitized = sanitizeKnownJunieAuthValue(item, variants, ancestors)
      return sanitized === OMIT_VALUE ? [] : [sanitized]
    })
  } else {
    const entries: Array<[string, unknown]> = []
    const sourceEntries = input instanceof Map
      ? Array.from(input.entries()).filter(([key]) => ['string', 'number', 'boolean'].includes(typeof key))
        .map(([key, value]) => [String(key), value] as const)
      : Object.keys(input).flatMap((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(input, key)
        return descriptor != null && 'value' in descriptor ? [[key, descriptor.value] as const] : []
      })
    for (const [key, value] of sourceEntries) {
      if (isJunieAuthEnvironmentKey(key) || containsVariant(key, variants)) continue
      const sanitized = sanitizeKnownJunieAuthValue(value, variants, ancestors)
      if (sanitized !== OMIT_VALUE) entries.push([key, sanitized])
    }
    output = Object.fromEntries(entries)
  }
  ancestors.delete(input)
  return output
}

export const scrubJunieAuthValuesForPersistence = (
  value: unknown,
  authValues: readonly string[]
) => {
  const sanitized = sanitizeKnownJunieAuthValue(value, getGlobalSecretVariants(authValues), new WeakSet())
  return sanitized === OMIT_VALUE ? undefined : sanitized
}

export const scrubJunieAuthEnvironmentForPersistence = (
  env: Record<string, unknown>
) => {
  const sanitized = scrubJunieAuthValuesForPersistence(env, collectJunieAuthEnvironmentValues(env))
  return sanitized != null && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : {}
}
