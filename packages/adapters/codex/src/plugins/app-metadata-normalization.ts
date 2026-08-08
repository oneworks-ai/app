/* eslint-disable max-lines -- bounded normalization and URL metadata validation form one fail-closed contract. */
import { Buffer } from 'node:buffer'

import {
  isCredentialLikeNativeAppKey,
  isCredentialShapedNativeAppValue,
  isSafeNativeAppDeclarativeValue
} from '@oneworks/utils'
import type { NativeAppDeclarativeField } from '@oneworks/utils'

const MAX_IDENTIFIER_BYTES = 512
const MAX_ROUTE_OR_URL_BYTES = 2048
const MAX_PERCENT_DECODE_ROUNDS = 4
const DANGEROUS_METADATA_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export const isPlainAppMetadataRecord = (
  value: unknown
): value is Record<string, unknown> => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export const hasOnlyOwnAllowedAppMetadataKeys = (
  value: Record<string, unknown>,
  allowedKeys: Set<string>
) => (
  Object.keys(value).every(key =>
    !DANGEROUS_METADATA_KEYS.has(key) &&
    !isCredentialLikeNativeAppKey(key) &&
    allowedKeys.has(key)
  )
)

const containsFilesystemPath = (value: string) => (
  /(?:^|[\s=("'`[,;])(?:file:\/\/\/|[a-z]:[\\/]|\\\\|\/(?!\/))/iu.test(value)
)

export const containsEncodedFilesystemPath = (value: string) => {
  let candidate = value
  for (let depth = 0; depth <= MAX_PERCENT_DECODE_ROUNDS; depth += 1) {
    if (containsFilesystemPath(candidate)) return true
    try {
      const decoded = decodeURIComponent(candidate)
      if (decoded === candidate) return false
      candidate = decoded
    } catch {
      return false
    }
  }
  return false
}

const normalizeUrlMetadataKey = (value: string) => {
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

const isSafeRedirectValue = (value: string): boolean => {
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
        return url.username === '' && url.password === '' && !hasUnsafeUrlMetadata(url)
      }
      if (
        !candidate.startsWith('/') ||
        candidate.startsWith('//') ||
        candidate.includes('\\') ||
        candidate.includes('\0') ||
        candidate.split(/[?#]/u).some(part => part === '.' || part === '..') ||
        !/^\/(?:api\/)?(?:auth|callback|oauth)(?:[/?#-]|$)/iu.test(candidate)
      ) return false
      return !hasUnsafeUrlMetadata(new URL(candidate, 'https://public.invalid/'))
    } catch {
      return false
    }
  }
  return false
}

const hasUnsafeUrlMetadata = (
  url: URL,
  options: { allowRedirectValues?: boolean } = {}
): boolean => {
  if (
    url.hash !== '' &&
    (
      containsEncodedFilesystemPath(url.hash.slice(1)) ||
      isCredentialShapedValue(url.hash.slice(1))
    )
  ) return true
  return [...url.searchParams.entries()].some(([key, entry]) => {
    const normalizedKey = normalizeUrlMetadataKey(key)
    const safeRedirectValue = options.allowRedirectValues === true &&
      (normalizedKey === 'redirecturi' || normalizedKey === 'redirecturl') &&
      isSafeRedirectValue(entry)
    return isCredentialLikeNativeAppKey(key) ||
      containsEncodedFilesystemPath(key) ||
      (!safeRedirectValue && containsEncodedFilesystemPath(entry)) ||
      isCredentialShapedValue(entry)
  })
}

export const isCredentialShapedValue = (
  value: string
) => isCredentialShapedNativeAppValue(value)

export const containsControlCharacter = (value: string) => (
  [...value].some(character => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
)

const normalizeBoundedLabel = (
  value: unknown,
  maxBytes = MAX_IDENTIFIER_BYTES
) => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (
    normalized === '' ||
    Buffer.byteLength(normalized, 'utf8') > maxBytes ||
    containsEncodedFilesystemPath(normalized) ||
    isCredentialShapedValue(normalized)
  ) return undefined
  return normalized
}

export const normalizeDeclarativeValue = (
  value: unknown,
  options: { field: NativeAppDeclarativeField; maxBytes: number }
) => {
  const normalized = normalizeBoundedLabel(value, options.maxBytes)
  return normalized != null && isSafeNativeAppDeclarativeValue(normalized, options.field)
    ? normalized
    : undefined
}

export const normalizeDeclarativeList = (
  value: unknown,
  options: {
    field: NativeAppDeclarativeField
    itemBytes: number
    maxItems: number
  }
) => {
  if (!Array.isArray(value) || value.length > options.maxItems) return undefined
  const entries = value.map(item =>
    normalizeDeclarativeValue(item, {
      maxBytes: options.itemBytes,
      field: options.field
    })
  )
  return entries.some(entry => entry == null) ? undefined : entries as string[]
}

export const normalizeRootRelativeRoute = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (
    normalized === '' ||
    Buffer.byteLength(normalized, 'utf8') > MAX_ROUTE_OR_URL_BYTES ||
    !normalized.startsWith('/') ||
    normalized.startsWith('//') ||
    normalized.includes('\\') ||
    normalized.includes('\0') ||
    containsControlCharacter(value) ||
    isCredentialShapedValue(normalized)
  ) return undefined
  let candidate = normalized
  let decodeStabilized = false
  for (let depth = 0; depth <= MAX_PERCENT_DECODE_ROUNDS; depth += 1) {
    if (containsControlCharacter(candidate)) return undefined
    if (candidate.split(/[/?#]/u).some(part => part === '.' || part === '..')) return undefined
    try {
      const decoded = decodeURIComponent(candidate)
      if (containsControlCharacter(decoded)) return undefined
      if (decoded === candidate) {
        decodeStabilized = true
        break
      }
      candidate = decoded
    } catch {
      return undefined
    }
  }
  if (!decodeStabilized) return undefined
  const url = new URL(candidate, 'https://public.invalid/')
  return hasUnsafeUrlMetadata(url) ? undefined : normalized
}

export const normalizeHttpUrl = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (
    normalized === '' ||
    Buffer.byteLength(normalized, 'utf8') > MAX_ROUTE_OR_URL_BYTES ||
    containsControlCharacter(value) ||
    isCredentialShapedValue(normalized)
  ) return undefined
  let decoded = normalized
  let decodeStabilized = false
  for (let depth = 0; depth <= MAX_PERCENT_DECODE_ROUNDS; depth += 1) {
    if (containsControlCharacter(decoded)) return undefined
    try {
      const next = decodeURIComponent(decoded)
      if (containsControlCharacter(next)) return undefined
      if (next === decoded) {
        decodeStabilized = true
        break
      }
      decoded = next
    } catch {
      return undefined
    }
  }
  if (!decodeStabilized) return undefined
  try {
    const url = new URL(normalized)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username !== '' ||
      url.password !== ''
    ) return undefined
    for (const [key, entry] of url.searchParams.entries()) {
      if (
        isCredentialLikeNativeAppKey(key) ||
        isCredentialShapedValue(entry)
      ) return undefined
    }
    if (hasUnsafeUrlMetadata(url, { allowRedirectValues: true })) return undefined
    return normalized
  } catch {
    return undefined
  }
}

export const getAliasedAppMetadataValue = (
  value: Record<string, unknown>,
  primary: string,
  alias: string
) => {
  if (Object.hasOwn(value, primary) && Object.hasOwn(value, alias)) {
    return { conflict: true, value: undefined }
  }
  return {
    conflict: false,
    value: Object.hasOwn(value, primary) ? value[primary] : value[alias]
  }
}
