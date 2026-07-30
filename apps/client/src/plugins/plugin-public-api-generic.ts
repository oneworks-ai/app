import { getPublicValue, isPublicRecord, parsePublicArray, parsePublicString } from './plugin-public-api-values'
import type { PublicParseState } from './plugin-public-api-values'

const MAX_DEPTH = 8
const MAX_PERCENT_DECODE_ROUNDS = 8
const DANGEROUS_FIELD_NAMES = new Set(['constructor', 'proto', 'prototype'])
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
