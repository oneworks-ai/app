import { Buffer } from 'node:buffer'

import {
  isCredentialLikeNativeAppKey,
  isCredentialLikeNativeAppValue,
  isSafeNativeAppDeclarativeValue
} from '@oneworks/utils'
import type { NativeAppDeclarativeField } from '@oneworks/utils'

const MAX_IDENTIFIER_BYTES = 512
const MAX_ROUTE_OR_URL_BYTES = 2048
const MAX_CREDENTIAL_VALUE_DECODE_DEPTH = 4
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
  for (let depth = 0; depth <= 2; depth += 1) {
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

export const isCredentialShapedValue = (
  value: string
) => {
  let candidate = value
  for (let depth = 0; depth <= MAX_CREDENTIAL_VALUE_DECODE_DEPTH; depth += 1) {
    if (isCredentialLikeNativeAppValue(candidate)) return true
    let decoded: string
    try {
      decoded = decodeURIComponent(candidate)
    } catch {
      return true
    }
    if (decoded === candidate) return false
    candidate = decoded
  }
  return true
}

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
    isCredentialShapedValue(normalized)
  ) return undefined
  let decoded
  try {
    decoded = decodeURIComponent(normalized)
  } catch {
    return undefined
  }
  if (decoded.split(/[/?#]/u).some(part => part === '.' || part === '..')) return undefined
  return normalized
}

export const normalizeHttpUrl = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (
    normalized === '' ||
    Buffer.byteLength(normalized, 'utf8') > MAX_ROUTE_OR_URL_BYTES ||
    isCredentialShapedValue(normalized)
  ) return undefined
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
