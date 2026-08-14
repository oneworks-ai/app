/* eslint-disable max-lines -- Representation decoding and the recursive JSON-safe clone share one audit boundary. */
import { Buffer } from 'node:buffer'

const OMIT_CREDENTIAL_VALUE = Symbol('omit-credential-value')

const SECRET_VALUE_PATTERN =
  /^(?:bearer\s+\S+|gh[pousr]_[\w-]{4,}|github_pat_[\w-]{4,}|sk[-_][\w-]{4,}|xai[-_][\w-]{4,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)$/iu
const EMBEDDED_SECRET_FIELD_PATTERN =
  /(?:^|[\s?&#;,{"'])(?:(?:api|access|refresh|session)[\s_.-]*(?:key|token)|authorization|credential|password|private[\s_.-]*key|secret|token)[\s"']*(?::|=)/iu
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u
const BASE64URL_PATTERN = /^[\w-]+={0,2}$/u
const URI_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u
const SAFE_BYOK_SCALAR_KEYS = new Set(['baseurl', 'enabled', 'endpoint', 'model', 'provider', 'region', 'url'])

const normalizeConfigKey = (key: string) => key.normalize('NFKC').replace(/[^a-z0-9]/giu, '').toLowerCase()

const isSecretConfigKey = (key: string) => {
  const normalized = normalizeConfigKey(key)
  if (normalized === '') return false
  return normalized === 'auth' ||
    normalized === 'authorization' ||
    normalized.endsWith('auth') ||
    normalized.endsWith('apikey') ||
    normalized.endsWith('accesstoken') ||
    normalized.endsWith('refreshtoken') ||
    normalized.endsWith('sessiontoken') ||
    normalized.endsWith('privatekey') ||
    ['credential', 'credentials', 'password', 'passphrase', 'secret', 'secrets', 'token', 'tokens'].some(part => (
      normalized === part || normalized.endsWith(part)
    ))
}

const isDirectByokScalar = (path: string[]) => {
  const normalized = path.map(normalizeConfigKey)
  const byokIndex = normalized.indexOf('byok')
  if (byokIndex === -1) return false
  const afterByok = normalized.slice(byokIndex + 1).filter(segment => !/^\d+$/u.test(segment))
  return afterByok.length === 1 && !SAFE_BYOK_SCALAR_KEYS.has(afterByok[0] ?? '')
}

const decodeUtf8 = (value: Buffer) => {
  const decoded = value.toString('utf8')
  return Buffer.from(decoded, 'utf8').equals(value) ? decoded : undefined
}

const sanitizeUrlString = (
  value: string,
  path: string[],
  sanitizeString: (value: string, path: string[], allowBase64?: boolean) => string | typeof OMIT_CREDENTIAL_VALUE
) => {
  if (!URI_SCHEME_PATTERN.test(value)) return value
  try {
    const url = new URL(value)
    let changed = false
    if (url.username !== '' || url.password !== '') {
      url.username = ''
      url.password = ''
      changed = true
    }
    for (const key of Array.from(url.searchParams.keys())) {
      const values = url.searchParams.getAll(key)
      if (isSecretConfigKey(key)) {
        url.searchParams.delete(key)
        changed = true
        continue
      }
      const sanitizedValues = values.flatMap((item) => {
        const sanitized = sanitizeString(item, [...path, key])
        return sanitized === OMIT_CREDENTIAL_VALUE ? [] : [sanitized]
      })
      if (sanitizedValues.length !== values.length || sanitizedValues.some((item, index) => item !== values[index])) {
        url.searchParams.delete(key)
        for (const item of sanitizedValues) url.searchParams.append(key, item)
        changed = true
      }
    }
    return changed ? url.toString() : value
  } catch {
    return value
  }
}

const sanitizeFormString = (
  value: string,
  path: string[],
  sanitizeString: (value: string, path: string[], allowBase64?: boolean) => string | typeof OMIT_CREDENTIAL_VALUE
) => {
  if (!value.includes('=') || value.includes('\n') || value.includes('\r')) return value
  const prefix = value.startsWith('?') ? '?' : ''
  const source = prefix === '' ? value : value.slice(1)
  const entries = source.split('&')
  if (entries.some(entry => !entry.includes('='))) return value
  const params = new URLSearchParams(source)
  if (Array.from(params.keys()).length === 0) return value
  let changed = false
  for (const key of Array.from(new Set(params.keys()))) {
    const values = params.getAll(key)
    if (isSecretConfigKey(key)) {
      params.delete(key)
      changed = true
      continue
    }
    const sanitizedValues = values.flatMap((item) => {
      const sanitized = sanitizeString(item, [...path, key])
      return sanitized === OMIT_CREDENTIAL_VALUE ? [] : [sanitized]
    })
    if (sanitizedValues.length !== values.length || sanitizedValues.some((item, index) => item !== values[index])) {
      params.delete(key)
      for (const item of sanitizedValues) params.append(key, item)
      changed = true
    }
  }
  return changed ? `${prefix}${params.toString()}` : value
}

const sanitizeBase64String = (
  value: string,
  path: string[],
  sanitizeString: (value: string, path: string[], allowBase64?: boolean) => string | typeof OMIT_CREDENTIAL_VALUE
) => {
  if (value.length < 8 || value.length > 1_000_000) return value
  const isStandard = value.length % 4 === 0 && BASE64_PATTERN.test(value)
  const isUrl = BASE64URL_PATTERN.test(value)
  if (!isStandard && !isUrl) return value
  try {
    const encoding = isStandard ? 'base64' : 'base64url'
    const decoded = decodeUtf8(Buffer.from(value, encoding))
    if (
      decoded == null || (!EMBEDDED_SECRET_FIELD_PATTERN.test(decoded) && !SECRET_VALUE_PATTERN.test(decoded.trim()))
    ) {
      return value
    }
    const sanitized = sanitizeString(decoded, path, false)
    if (sanitized === OMIT_CREDENTIAL_VALUE) return OMIT_CREDENTIAL_VALUE
    if (sanitized === decoded) return value
    const encoded = Buffer.from(sanitized, 'utf8').toString(encoding)
    return encoding === 'base64url' && !value.endsWith('=') ? encoded.replace(/=+$/u, '') : encoded
  } catch {
    return value
  }
}

const sanitizeCredentialValue = (
  input: unknown,
  path: string[],
  seen: WeakSet<object>
): unknown | typeof OMIT_CREDENTIAL_VALUE => {
  const sanitizeString = (
    value: string,
    stringPath: string[],
    allowBase64 = true,
    allowDirectByok = true
  ): string | typeof OMIT_CREDENTIAL_VALUE => {
    const trimmed = value.trim()
    if (trimmed !== '' && SECRET_VALUE_PATTERN.test(trimmed)) return OMIT_CREDENTIAL_VALUE
    if (allowDirectByok && isDirectByokScalar(stringPath)) return OMIT_CREDENTIAL_VALUE

    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length <= 1_000_000) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        const sanitized = sanitizeCredentialValue(parsed, stringPath, new WeakSet())
        if (sanitized === OMIT_CREDENTIAL_VALUE) return OMIT_CREDENTIAL_VALUE
        const serialized = JSON.stringify(sanitized)
        return serialized === JSON.stringify(parsed) ? value : serialized
      } catch {
        // Non-JSON strings continue through the representation-aware checks.
      }
    }

    const urlSanitized = sanitizeUrlString(value, stringPath, sanitizeString)
    if (urlSanitized !== value) return urlSanitized
    const formSanitized = sanitizeFormString(value, stringPath, sanitizeString)
    if (formSanitized !== value) {
      return formSanitized === '' || formSanitized === '?'
        ? OMIT_CREDENTIAL_VALUE
        : formSanitized
    }
    if (allowBase64) {
      const base64Sanitized = sanitizeBase64String(value, stringPath, sanitizeString)
      if (base64Sanitized !== value) return base64Sanitized
    }
    if (EMBEDDED_SECRET_FIELD_PATTERN.test(value)) return OMIT_CREDENTIAL_VALUE
    return value
  }

  if (typeof input === 'string') return sanitizeString(input, path)
  if (input == null || typeof input === 'boolean' || typeof input === 'number') return input
  if (typeof input === 'bigint') return input.toString()
  if (typeof input === 'function' || typeof input === 'symbol' || typeof input === 'undefined') {
    return OMIT_CREDENTIAL_VALUE
  }

  if (input instanceof Date) return Number.isNaN(input.getTime()) ? OMIT_CREDENTIAL_VALUE : input.toISOString()
  if (input instanceof URL) return sanitizeString(input.toString(), path)
  if (input instanceof URLSearchParams) return sanitizeFormString(input.toString(), path, sanitizeString)
  if (Buffer.isBuffer(input)) {
    const decoded = decodeUtf8(input)
    if (decoded == null) return Array.from(input)
    const sanitized = sanitizeString(decoded, path)
    return sanitized === decoded ? Array.from(input) : sanitized
  }
  if (ArrayBuffer.isView(input)) return Array.from(new Uint8Array(input.buffer, input.byteOffset, input.byteLength))
  if (input instanceof ArrayBuffer) return Array.from(new Uint8Array(input))
  if (seen.has(input)) return OMIT_CREDENTIAL_VALUE
  seen.add(input)

  let output: unknown
  if (Array.isArray(input)) {
    output = input.flatMap((item, index) => {
      const sanitized = sanitizeCredentialValue(item, [...path, String(index)], seen)
      return sanitized === OMIT_CREDENTIAL_VALUE ? [] : [sanitized]
    })
  } else if (input instanceof Set) {
    output = Array.from(input).flatMap((item, index) => {
      const sanitized = sanitizeCredentialValue(item, [...path, String(index)], seen)
      return sanitized === OMIT_CREDENTIAL_VALUE ? [] : [sanitized]
    })
  } else if (input instanceof Map) {
    const entries: Array<[string, unknown]> = []
    for (const [key, value] of input.entries()) {
      if (typeof key !== 'string' && typeof key !== 'number' && typeof key !== 'boolean') continue
      const stringKey = String(key)
      if (isSecretConfigKey(stringKey)) continue
      const sanitizedKey = sanitizeString(stringKey, path, true, false)
      if (sanitizedKey === OMIT_CREDENTIAL_VALUE || sanitizedKey !== stringKey) continue
      const sanitized = sanitizeCredentialValue(value, [...path, stringKey], seen)
      if (sanitized !== OMIT_CREDENTIAL_VALUE) entries.push([stringKey, sanitized])
    }
    output = Object.fromEntries(entries)
  } else {
    const entries: Array<[string, unknown]> = []
    for (const key of Object.keys(input)) {
      if (isSecretConfigKey(key)) continue
      const sanitizedKey = sanitizeString(key, path, true, false)
      if (sanitizedKey === OMIT_CREDENTIAL_VALUE || sanitizedKey !== key) continue
      const descriptor = Object.getOwnPropertyDescriptor(input, key)
      if (descriptor == null || !('value' in descriptor)) continue
      const sanitized = sanitizeCredentialValue(descriptor.value, [...path, key], seen)
      if (sanitized !== OMIT_CREDENTIAL_VALUE) entries.push([key, sanitized])
    }
    output = Object.fromEntries(entries)
  }
  seen.delete(input)
  return output
}

/**
 * Produces a JSON-compatible clone while removing credential-bearing keys,
 * values, and common embedded representations. The input is never mutated and
 * accessors or custom `toJSON` methods are never invoked.
 */
export const scrubCredentialConfigForPersistence = (value: unknown): unknown => {
  const sanitized = sanitizeCredentialValue(value, [], new WeakSet())
  return sanitized === OMIT_CREDENTIAL_VALUE ? undefined : sanitized
}
