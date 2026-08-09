/* eslint-disable max-lines -- bounded public scalar and URL validators share one parse-state implementation. */
const MAX_ITEMS = 128
const MAX_STRING_BYTES = 16 * 1024
const MAX_TOTAL_BYTES = 256 * 1024
const TEXT_ENCODER = new TextEncoder()
const CREDENTIAL_VALUE_PATTERN =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S+|AIza[\w-]{20,}|A(?:KIA|SIA)[0-9A-Z]{16}|(?:github_pat|ghp|gho|ghs|glpat|sk|xox[aboprs])[-\w]{12,}\b|\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b|(?:api[_-]?key|client[_-]?secret|password|token)\s*[:=]\s*\S+/iu
const CREDENTIAL_URL_METADATA_KEYS = new Set([
  'accesstoken',
  'apikey',
  'authorizationheader',
  'bearertoken',
  'clientsecret',
  'credential',
  'credentials',
  'oauthtoken',
  'password',
  'privatekey',
  'refreshtoken',
  'secret',
  'token'
])
const MAX_PERCENT_DECODE_ROUNDS = 4

export interface PublicParseState {
  bytes: number
  objects: WeakSet<object>
}

export const createPublicParseState = (): PublicParseState => ({
  bytes: 0,
  objects: new WeakSet<object>()
})

export const isPublicRecord = (value: unknown, state: PublicParseState): value is Record<string, unknown> => {
  if (value == null || typeof value !== 'object') return false
  if (Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || state.objects.has(value)) return false
  const keys = Reflect.ownKeys(value)
  if (keys.length > MAX_ITEMS) return false
  for (const key of keys) {
    if (typeof key !== 'string') return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor == null || !Object.hasOwn(descriptor, 'value')) return false
  }
  state.objects.add(value)
  return true
}

export const getPublicValue = (record: Record<string, unknown>, key: string) => {
  const descriptor = Object.getOwnPropertyDescriptor(record, key)
  return descriptor != null && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
}

export const hasPublicFields = (value: object) => Object.keys(value).length > 0

export const hasUnsafePublicUrlWhitespace = (value: string) => (
  [...value].some(character => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  }) || value.startsWith(' ') || value.endsWith(' ')
)

const hasSegmentedOpaquePublicValue = (value: string) => {
  const segments = value.split(/[./:_-]+/u).filter(Boolean)
  const longSegments = segments.filter(segment => /^[a-z0-9]+$/iu.test(segment) && segment.length >= 12)
  return longSegments.length >= 2 && longSegments.join('').length >= 40
}

const hasHttpUserInfo = (value: string) => {
  if (!/^https?:\/\//iu.test(value)) return false
  try {
    const url = new URL(value)
    return url.username !== '' || url.password !== ''
  } catch {
    return true
  }
}

const isRawFilesystemShapedPublicValue = (value: string) => {
  let candidate = value
  for (let depth = 0; depth <= MAX_PERCENT_DECODE_ROUNDS; depth += 1) {
    if (/(?:^|[^a-z0-9])(?:file:\/\/\/|[a-z]:[\\/]|\\\\|\/(?!\/))/iu.test(candidate)) return true
    try {
      const decoded = decodeURIComponent(candidate)
      if (decoded === candidate) return false
      candidate = decoded
    } catch {
      return true
    }
  }
  return true
}

export const isFilesystemShapedPublicValue = (value: string) => {
  if (!/^https?:\/\//iu.test(value)) return isRawFilesystemShapedPublicValue(value)
  try {
    const url = new URL(value)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.hostname === '' ||
      url.username !== '' ||
      url.password !== ''
    ) return true
    if (url.hash !== '' && isRawFilesystemShapedPublicValue(url.hash.slice(1))) return true
    return [...url.searchParams.entries()].some(([key, entry]) => (
      isRawFilesystemShapedPublicValue(key) || isRawFilesystemShapedPublicValue(entry)
    ))
  } catch {
    return true
  }
}

export const isCredentialShapedPublicValue = (value: string) => {
  let candidate = value
  for (let depth = 0; depth <= MAX_PERCENT_DECODE_ROUNDS; depth += 1) {
    if (
      CREDENTIAL_VALUE_PATTERN.test(candidate) ||
      hasSegmentedOpaquePublicValue(candidate) ||
      hasHttpUserInfo(candidate)
    ) return true
    try {
      const decoded = decodeURIComponent(candidate)
      if (decoded === candidate) return false
      candidate = decoded
    } catch {
      return true
    }
  }
  return true
}

export const parsePublicString = (value: unknown, state: PublicParseState) => {
  if (typeof value !== 'string' || isCredentialShapedPublicValue(value)) return undefined
  const bytes = TEXT_ENCODER.encode(value).byteLength
  if (bytes > MAX_STRING_BYTES || state.bytes + bytes > MAX_TOTAL_BYTES) return undefined
  state.bytes += bytes
  return value
}

export const parseOptionalPublicString = (
  record: Record<string, unknown>,
  key: string,
  state: PublicParseState
) => {
  const value = getPublicValue(record, key)
  return value == null ? undefined : parsePublicString(value, state)
}

export const parsePublicText = (value: unknown, state: PublicParseState) => {
  const parsed = parsePublicString(value, state)
  return parsed == null || isFilesystemShapedPublicValue(parsed) ? undefined : parsed
}

export const parseOptionalPublicText = (
  record: Record<string, unknown>,
  key: string,
  state: PublicParseState
) => {
  const value = getPublicValue(record, key)
  return value == null ? undefined : parsePublicText(value, state)
}

export const isSafePublicJsonPointer = (value: string) => {
  if (!value.startsWith('#/') || value.includes('%') || value.includes('\\') || value.includes('\0')) return false
  const segments = value.slice(2).split('/')
  return segments.length > 0 && segments.every(segment => (
    segment !== '' &&
    segment !== '.' &&
    segment !== '..' &&
    !/~(?![01])/u.test(segment)
  ))
}

const normalizePublicUrlMetadataKey = (value: string) => {
  let candidate = value
  for (let depth = 0; depth <= MAX_PERCENT_DECODE_ROUNDS; depth += 1) {
    try {
      const decoded = decodeURIComponent(candidate)
      if (decoded === candidate) return candidate.replace(/[^a-z0-9]+/giu, '').toLowerCase()
      candidate = decoded
    } catch {
      return undefined
    }
  }
  return undefined
}

const isSafePublicRedirectValue = (value: string): boolean => {
  let candidate = value
  for (let depth = 0; depth <= MAX_PERCENT_DECODE_ROUNDS; depth += 1) {
    try {
      const decoded = decodeURIComponent(candidate)
      if (decoded !== candidate) {
        candidate = decoded
        continue
      }
      if (/^https?:\/\//iu.test(candidate)) {
        const url = new URL(candidate)
        return url.username === '' && url.password === '' && !hasUnsafePublicUrlMetadata(url)
      }
      if (
        !candidate.startsWith('/') ||
        candidate.startsWith('//') ||
        candidate.includes('\\') ||
        candidate.includes('\0') ||
        candidate.split(/[?#]/u)[0]?.split('/').includes('..') ||
        !/^\/(?:api\/)?(?:auth|callback|oauth)(?:[/?#-]|$)/iu.test(candidate)
      ) return false
      return !hasUnsafePublicUrlMetadata(new URL(candidate, 'https://public.invalid/'))
    } catch {
      return false
    }
  }
  return false
}

export const hasUnsafePublicUrlMetadata = (
  url: URL,
  options: { allowRedirectValues?: boolean } = {}
): boolean => {
  if (
    url.hash !== '' &&
    (
      isRawFilesystemShapedPublicValue(url.hash.slice(1)) ||
      isCredentialShapedPublicValue(url.hash.slice(1))
    )
  ) return true
  return [...url.searchParams.entries()].some(([key, entry]) => {
    const normalizedKey = normalizePublicUrlMetadataKey(key)
    const safeRedirectValue = options.allowRedirectValues === true &&
      (normalizedKey === 'redirecturi' || normalizedKey === 'redirecturl') &&
      isSafePublicRedirectValue(entry)
    return normalizedKey == null ||
      CREDENTIAL_URL_METADATA_KEYS.has(normalizedKey) ||
      /(?:access|bearer|oauth|refresh)token|apikey|authorizationheader|clientsecret|privatekey/iu.test(
        normalizedKey
      ) ||
      isRawFilesystemShapedPublicValue(key) ||
      (!safeRedirectValue && isRawFilesystemShapedPublicValue(entry)) ||
      isCredentialShapedPublicValue(entry)
  })
}

export const parsePublicAssetString = (value: unknown, state: PublicParseState) => {
  const parsed = parsePublicString(value, state)
  if (parsed == null || hasUnsafePublicUrlWhitespace(parsed)) return undefined
  if (/^https?:\/\//iu.test(parsed)) {
    try {
      const url = new URL(parsed)
      return url.username === '' && url.password === '' && !hasUnsafePublicUrlMetadata(url)
        ? parsed
        : undefined
    } catch {
      return undefined
    }
  }
  let candidate = parsed
  for (let depth = 0; depth <= MAX_PERCENT_DECODE_ROUNDS; depth += 1) {
    if (
      hasUnsafePublicUrlWhitespace(candidate) ||
      candidate.includes('\\') ||
      candidate.startsWith('/') ||
      /^[a-z][a-z\d+.-]*:/iu.test(candidate) ||
      candidate.split(/[?#]/u)[0]?.split('/').includes('..')
    ) return undefined
    try {
      const decoded = decodeURIComponent(candidate)
      if (decoded === candidate) {
        const url = new URL(candidate, 'https://public.invalid/')
        return hasUnsafePublicUrlMetadata(url) ? undefined : parsed
      }
      candidate = decoded
    } catch {
      return undefined
    }
  }
  return undefined
}

export const parsePublicEndpointString = (value: unknown, state: PublicParseState) => {
  const parsed = parsePublicString(value, state)
  if (parsed == null) return undefined
  if (/^https?:\/\//iu.test(parsed)) {
    try {
      const url = new URL(parsed)
      return url.username === '' && url.password === '' && !hasUnsafePublicUrlMetadata(url)
        ? parsed
        : undefined
    } catch {
      return undefined
    }
  }
  let candidate = parsed
  for (let depth = 0; depth <= MAX_PERCENT_DECODE_ROUNDS; depth += 1) {
    if (
      candidate.includes('\0') ||
      candidate.includes('\\') ||
      candidate.startsWith('//') ||
      candidate.split(/[?#]/u)[0]?.split('/').includes('..')
    ) return undefined
    try {
      const decoded = decodeURIComponent(candidate)
      if (decoded === candidate) {
        const url = new URL(candidate, 'https://public.invalid/')
        return /^\/(?:api\/|plugins\/)/u.test(url.pathname) && !hasUnsafePublicUrlMetadata(url)
          ? parsed
          : undefined
      }
      candidate = decoded
    } catch {
      return undefined
    }
  }
  return undefined
}

export const parsePublicStringList = (
  value: unknown,
  state: PublicParseState,
  maximum = MAX_ITEMS
) => {
  if (value == null || typeof value !== 'object') return undefined
  if (!Array.isArray(value) || value.length > maximum) return undefined
  const result: string[] = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (descriptor == null || !Object.hasOwn(descriptor, 'value')) return undefined
    const parsed = parsePublicString(descriptor.value, state)
    if (parsed == null) return undefined
    result.push(parsed)
  }
  return result
}

export const parsePublicTextList = (
  value: unknown,
  state: PublicParseState,
  maximum = MAX_ITEMS
) => {
  const parsed = parsePublicStringList(value, state, maximum)
  return parsed == null || parsed.some(isFilesystemShapedPublicValue) ? undefined : parsed
}

export const parsePublicArray = (
  value: unknown,
  state: PublicParseState,
  maximum: number
) => {
  if (value == null || typeof value !== 'object') return undefined
  if (!Array.isArray(value) || value.length > maximum) return undefined
  const result: unknown[] = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (descriptor == null || !Object.hasOwn(descriptor, 'value')) return undefined
    result.push(descriptor.value)
  }
  return result
}
