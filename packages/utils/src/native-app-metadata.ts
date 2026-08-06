import { Buffer } from 'node:buffer'

const CREDENTIAL_VALUE_PATTERN =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S+|AIza[\w-]{20,}|A(?:KIA|SIA)[0-9A-Z]{16}|(?:github_pat|ghp|gho|ghs|glpat|sk|xox[aboprs])[-\w]{12,}\b|\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b|(?:api[_-]?key|client[_-]?secret|password|token)\s*[:=]\s*\S+/iu
const APP_NAME_PATTERN = /^[a-z][\w-]{0,63}$/iu
const APP_ID_PATTERN = /^[a-z][\w-]{0,95}$/iu
const DECLARATIVE_VALUE_PATTERN = /^[a-z][\w:./-]{0,255}$/iu
const DECLARATIVE_CAPABILITY_PATTERN = /^[a-z][\w .-]{0,127}$/iu
const CREDENTIAL_KEY_PATTERN =
  /(?:^|[_-])(?:access[_-]?token|api[_-]?key|authorization[_-]?header|bearer[_-]?token|client[_-]?secret|credential|credentials|oauth[_-]?token|password|private[_-]?key|refresh[_-]?token|secret|token)(?:$|[_-])/iu
const COMPACT_CREDENTIAL_KEY_PATTERN =
  /(?:access|bearer|oauth|refresh)token|apikey|authorizationheader|clientsecret|privatekey/iu
const GENERIC_COMPACT_CREDENTIAL_KEY_PATTERN =
  /^(?:credential|credentials|password|secret|token)(?:data|field|string|text|value|values)?$/iu
const MAX_METADATA_KEY_BYTES = 256
const MAX_METADATA_KEY_DECODE_DEPTH = 4

export type NativeAppDeclarativeField =
  | 'appId'
  | 'appName'
  | 'authenticationType'
  | 'capability'
  | 'connectionType'
  | 'permission'
  | 'scope'

const hasSegmentedOpaqueValue = (value: string) => {
  const segments = value.split(/[./:_-]+/u).filter(Boolean)
  const longSegments = segments.filter(segment => /^[a-z0-9]+$/iu.test(segment) && segment.length >= 12)
  return longSegments.length >= 2 && longSegments.join('').length >= 40
}

const containsDecodedFilesystemSelector = (value: string) => {
  let candidate = value
  for (let depth = 0; depth <= 4; depth += 1) {
    if (/(?:^|[^a-z0-9])(?:file:\/\/\/|[a-z]:[\\/]|\\\\|\/(?!\/))/iu.test(candidate)) return true
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

const containsDecodedCredentialValue = (value: string) => {
  let candidate = value
  for (let depth = 0; depth <= 4; depth += 1) {
    if (CREDENTIAL_VALUE_PATTERN.test(candidate) || hasSegmentedOpaqueValue(candidate)) return true
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

const hasMalformedPercentEncoding = (value: string) => {
  let candidate = value
  for (let depth = 0; depth <= 4; depth += 1) {
    try {
      const decoded = decodeURIComponent(candidate)
      if (decoded === candidate) return false
      candidate = decoded
    } catch {
      return true
    }
  }
  return false
}

export const isCredentialLikeNativeAppValue = (value: string) => (
  CREDENTIAL_VALUE_PATTERN.test(value) || hasSegmentedOpaqueValue(value)
)

export const isCredentialShapedNativeAppValue = (value: string) => {
  let candidate = value
  for (let depth = 0; depth <= MAX_METADATA_KEY_DECODE_DEPTH; depth += 1) {
    if (isCredentialLikeNativeAppValue(candidate)) return true
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

const decodeNativeAppMetadataKey = (value: string) => {
  let candidate = value
  for (let depth = 0; depth < MAX_METADATA_KEY_DECODE_DEPTH; depth += 1) {
    if (Buffer.byteLength(candidate, 'utf8') > MAX_METADATA_KEY_BYTES) return undefined
    try {
      const decoded = decodeURIComponent(candidate)
      if (decoded === candidate) return candidate
      candidate = decoded
    } catch {
      return undefined
    }
  }
  try {
    return decodeURIComponent(candidate) === candidate ? candidate : undefined
  } catch {
    return undefined
  }
}

export const normalizeNativeAppMetadataKey = (value: string) => {
  const decoded = decodeNativeAppMetadataKey(value)
  if (decoded == null) return undefined
  return decoded
    .replace(/([\da-z])([A-Z])/gu, '$1_$2')
    .replace(/[^a-z0-9]+/giu, '_')
    .replace(/^_+|_+$/gu, '')
    .toLowerCase()
}

export const isCredentialLikeNativeAppKey = (value: string) => {
  const normalized = normalizeNativeAppMetadataKey(value)
  if (normalized == null) return true
  const compact = normalized.replaceAll('_', '')
  return (
    CREDENTIAL_KEY_PATTERN.test(normalized) ||
    COMPACT_CREDENTIAL_KEY_PATTERN.test(compact) ||
    GENERIC_COMPACT_CREDENTIAL_KEY_PATTERN.test(compact)
  )
}

export const isSafePublicPluginIdentity = (value: string) => (
  value.trim() !== '' &&
  !hasMalformedPercentEncoding(value) &&
  !containsDecodedFilesystemSelector(value) &&
  !containsDecodedCredentialValue(value) &&
  !/^(?:file|https?|git(?:\+[^:]+)?|ssh):/iu.test(value.trim()) &&
  !value.split(/[\\/]/u).includes('..')
)

export const isSafeNativeAppDeclarativeValue = (
  value: string,
  field: NativeAppDeclarativeField
) => {
  if (isCredentialLikeNativeAppValue(value)) return false
  switch (field) {
    case 'appId':
      return APP_ID_PATTERN.test(value)
    case 'appName':
      return APP_NAME_PATTERN.test(value)
    case 'authenticationType':
    case 'connectionType':
      return value === 'oauth' || value === 'oauth2' || value === 'none'
    case 'capability':
      return DECLARATIVE_CAPABILITY_PATTERN.test(value)
    case 'permission':
    case 'scope':
      return DECLARATIVE_VALUE_PATTERN.test(value)
  }
}
