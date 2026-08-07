import { getPublicValue, isPublicRecord, parsePublicArray, parsePublicString } from './plugin-public-api-values'
import type { PublicParseState } from './plugin-public-api-values'

const MAX_DEPTH = 8
const MAX_PERCENT_DECODE_ROUNDS = 8
const DANGEROUS_FIELD_NAMES = new Set(['constructor', 'proto', 'prototype'])
const CREDENTIAL_FIELD_NAMES = new Set([
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
const CREDENTIAL_VALUE_PATTERN =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S+|AIza[\w-]{20,}|A(?:KIA|SIA)[0-9A-Z]{16}|(?:github_pat|ghp|gho|ghs|glpat|sk|xox[aboprs])[-\w]{12,}\b|\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b|(?:api[_-]?key|client[_-]?secret|password|token)\s*[:=]\s*\S+/iu
const PRIVATE_FIELD_NAMES = new Set([
  'accessToken',
  'apiKey',
  'clientSecret',
  'installDir',
  'nativePluginDir',
  'pluginRoot',
  'projectHome',
  'root',
  'rootDir',
  'sourceRoot',
  'workspaceFolder'
].map(value => value.replaceAll(/[^a-z\d]/giu, '').toLowerCase()))

const normalizePublicFieldName = (value: string) => {
  let decoded = value
  for (let round = 0; round < MAX_PERCENT_DECODE_ROUNDS; round += 1) {
    const next = decoded.replaceAll(
      /%([a-f\d]{2})/giu,
      (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))
    )
    if (next === decoded) return decoded.replaceAll(/[^a-z\d]/giu, '').toLowerCase()
    decoded = next
  }
  return /%[a-f\d]{2}/iu.test(decoded)
    ? undefined
    : decoded.replaceAll(/[^a-z\d]/giu, '').toLowerCase()
}

export const isPrivatePublicFieldName = (value: string) => {
  const normalized = normalizePublicFieldName(value)
  return normalized == null ||
    DANGEROUS_FIELD_NAMES.has(normalized) ||
    PRIVATE_FIELD_NAMES.has(normalized)
}

export const isCredentialPublicFieldName = (value: string) => {
  const normalized = normalizePublicFieldName(value)
  return normalized == null || CREDENTIAL_FIELD_NAMES.has(normalized)
}

const hasSegmentedOpaquePublicValue = (value: string) => {
  const segments = value.split(/[./:_-]+/u).filter(Boolean)
  const longSegments = segments.filter(segment => /^[a-z0-9]+$/iu.test(segment) && segment.length >= 12)
  return longSegments.length >= 2 && longSegments.join('').length >= 40
}

export const isCredentialShapedPublicValue = (value: string) => {
  let candidate = value
  for (let depth = 0; depth <= 4; depth += 1) {
    if (CREDENTIAL_VALUE_PATTERN.test(candidate) || hasSegmentedOpaquePublicValue(candidate)) return true
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

export const parsePublicStringRecord = (value: unknown, state: PublicParseState) => {
  if (!isPublicRecord(value, state)) return undefined
  const result = Object.create(null) as Record<string, string>
  for (const key of Object.keys(value)) {
    if (isPrivatePublicFieldName(key)) return undefined
    const parsed = parsePublicString(getPublicValue(value, key), state)
    if (parsed == null) return undefined
    result[key] = parsed
  }
  return result
}

export const parsePublicJsonValue = (
  value: unknown,
  state: PublicParseState,
  depth = 0
): boolean | null | number | string | unknown[] | Record<string, unknown> | undefined => {
  if (depth > MAX_DEPTH) return undefined
  if (value == null || typeof value === 'boolean') return value
  if (typeof value === 'string') return parsePublicString(value, state)
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  const array = parsePublicArray(value, state, 128)
  if (array != null) {
    const result: unknown[] = []
    for (const item of array) {
      const parsed = parsePublicJsonValue(item, state, depth + 1)
      if (parsed === undefined) return undefined
      result.push(parsed)
    }
    return result
  }
  if (!isPublicRecord(value, state)) return undefined
  const result = Object.create(null) as Record<string, unknown>
  for (const key of Object.keys(value)) {
    if (isPrivatePublicFieldName(key)) return undefined
    const parsed = parsePublicJsonValue(getPublicValue(value, key), state, depth + 1)
    if (parsed === undefined) return undefined
    result[key] = parsed
  }
  return result
}

export const parsePublicJsonRecord = (value: unknown, state: PublicParseState) => {
  const parsed = parsePublicJsonValue(value, state)
  return parsed != null && !Array.isArray(parsed) && typeof parsed === 'object' ? parsed : undefined
}
