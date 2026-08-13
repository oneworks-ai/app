/* eslint-disable max-lines -- credential classification and its encoding-aware redaction contract are one safety boundary. */
import { Buffer } from 'node:buffer'

import type { CredentialTextAssignment } from './credential-redaction-graph'
import { isCredentialLikeNativeAppValue } from './native-app-metadata'

export const REDACTED_CREDENTIAL_VALUE = '[REDACTED]'
export const MIN_EMBEDDED_CREDENTIAL_VALUE_BYTES = 8

const splitCredentialKey = (key: string) => (
  key
    .replace(/([a-z\d])([A-Z])/gu, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1_$2')
    .toLowerCase()
    .split(/[^a-z\d]+/gu)
    .filter(Boolean)
)

const endsWithTerms = (terms: string[], suffix: string[]) => (
  terms.length >= suffix.length && suffix.every(
    (term, index) => terms[terms.length - suffix.length + index] === term
  )
)

const CREDENTIAL_SUFFIXES = [
  ['access', 'key'],
  ['access', 'token'],
  ['api', 'key'],
  ['api', 'secret'],
  ['api', 'token'],
  ['auth', 'header'],
  ['auth', 'key'],
  ['auth', 'secret'],
  ['auth', 'token'],
  ['authorization', 'header'],
  ['bearer', 'token'],
  ['client', 'secret'],
  ['client', 'secret', 'file'],
  ['cookie', 'header'],
  ['credential', 'file'],
  ['credentials', 'file'],
  ['id', 'token'],
  ['oauth', 'token'],
  ['password', 'file'],
  ['password', 'value'],
  ['private', 'key'],
  ['private', 'key', 'file'],
  ['proxy', 'authorization'],
  ['refresh', 'token'],
  ['secret', 'access', 'key'],
  ['secret', 'file'],
  ['secret', 'key'],
  ['session', 'token'],
  ['set', 'cookie'],
  ['signing', 'key'],
  ['subscription', 'key'],
  ['token', 'file']
] as const

const COMPACT_CREDENTIAL_KEYS = new Set([
  'cloudsdkauthcredentialfileoverride',
  'mysqlpwd',
  'mysqltestloginfile',
  'netrc',
  'pgpassfile',
  'pgpassword'
])

const EXACT_CREDENTIAL_TERMS = new Set([
  'auth',
  'authorization',
  'bearer',
  'cookie',
  'credential',
  'credentials',
  'password',
  'passwd',
  'secret',
  'token'
])

const CREDENTIAL_VALUE_SUFFIXES = new Set([
  'blob',
  'content',
  'data',
  'json',
  'material',
  'string',
  'text',
  'value',
  'values'
])

/**
 * Identifies keys that directly contain credentials, without matching nearby metadata such as
 * `tokenCount`, `credentialRevision`, `secretary`, `authMethod`, or `apiKeyEnv`.
 */
export const isCredentialBearingKey = (key: string) => {
  const terms = splitCredentialKey(key)
  if (terms.length === 0) return false
  if (COMPACT_CREDENTIAL_KEYS.has(terms.join(''))) return true
  const last = terms.at(-1)!
  if (EXACT_CREDENTIAL_TERMS.has(last)) return true
  if (
    CREDENTIAL_VALUE_SUFFIXES.has(last) &&
    terms.length >= 2 &&
    EXACT_CREDENTIAL_TERMS.has(terms.at(-2)!)
  ) return true
  return CREDENTIAL_SUFFIXES.some(suffix => endsWithTerms(terms, [...suffix]))
}

/** Header maps are credential containers even when a provider uses an opaque header name. */
export const isCredentialHeaderContainerKey = (key: string) => (
  splitCredentialKey(key).at(-1) === 'headers'
)

export const isCredentialBearingValue = (value: string) => {
  if (isCredentialLikeNativeAppValue(value)) return true
  try {
    const url = new URL(value)
    return url.username !== '' || url.password !== ''
  } catch {
    return false
  }
}

const formEncode = (value: string) => {
  const encoded = new URLSearchParams({ value }).toString()
  return encoded.slice('value='.length)
}

export const createCredentialValueVariants = (value: string) => [
  value,
  encodeURIComponent(value),
  formEncode(value),
  Buffer.from(value).toString('base64'),
  Buffer.from(value).toString('base64url'),
  JSON.stringify(value).slice(1, -1)
]

export const isSafeEmbeddedCredentialValue = (value: string) => (
  value !== '' && Buffer.byteLength(value, 'utf8') >= MIN_EMBEDDED_CREDENTIAL_VALUE_BYTES
)

export const createCredentialVariants = (values: Iterable<string>) => (
  [...values]
    .filter(isSafeEmbeddedCredentialValue)
    .flatMap(createCredentialValueVariants)
    .filter((value, index, variants) => value !== '' && variants.indexOf(value) === index)
    .sort((left, right) => right.length - left.length)
)

export const redactCredentialVariantsInString = (
  value: string,
  variants: readonly string[],
  replacement = REDACTED_CREDENTIAL_VALUE
) => {
  let redacted = value
  for (const variant of variants) redacted = redacted.split(variant).join(replacement)
  return redacted
}

const CREDENTIAL_ASSIGNMENT =
  /([a-z][\w.-]{0,127})(\s*[:=]\s*)(["']?)(bearer\s+)?(\[REDACTED\]|[^\s,;|{"'}\x5B\x5D]+)/giu
const CREDENTIAL_JSON_ASSIGNMENT =
  /(["'])([a-z][\w.-]{0,127})\1(\s*[:=]\s*)(["']?)(bearer\s+)?(\[REDACTED\]|[^\s,;|{"'}\x5B\x5D]+)/giu

const redactCredentialAssignmentsWithMatcher = (
  value: string,
  isSensitive: (key: string, assignedValue: string) => boolean,
  replacement: string
) =>
  value
    .replace(
      CREDENTIAL_JSON_ASSIGNMENT,
      (
        match,
        keyQuote: string,
        key: string,
        separator: string,
        valueQuote: string,
        bearer: string | undefined,
        assignedValue: string
      ) => (
        assignedValue !== REDACTED_CREDENTIAL_VALUE && isSensitive(key, assignedValue)
          ? `${keyQuote}${key}${keyQuote}${separator}${valueQuote}${bearer ?? ''}${replacement}`
          : match
      )
    )
    .replace(
      CREDENTIAL_ASSIGNMENT,
      (
        match,
        key: string,
        separator: string,
        quote: string,
        bearer: string | undefined,
        assignedValue: string
      ) => (
        assignedValue !== REDACTED_CREDENTIAL_VALUE && isSensitive(key, assignedValue)
          ? `${key}${separator}${quote}${bearer ?? ''}${replacement}`
          : match
      )
    )

export const redactCredentialAssignmentsInString = (
  value: string,
  replacement = REDACTED_CREDENTIAL_VALUE
) =>
  redactCredentialAssignmentsWithMatcher(
    value,
    key => isCredentialBearingKey(key),
    replacement
  )

export const redactContextualCredentialAssignmentsInString = (
  value: string,
  assignments: readonly CredentialTextAssignment[],
  replacement = REDACTED_CREDENTIAL_VALUE
) => {
  const valuesByKey = new Map<string, Set<string>>()
  for (const assignment of assignments) {
    if (assignment.key === '' || assignment.value === '') continue
    const values = valuesByKey.get(assignment.key.toLowerCase()) ?? new Set<string>()
    values.add(assignment.value)
    valuesByKey.set(assignment.key.toLowerCase(), values)
  }
  if (valuesByKey.size === 0) return value
  return redactCredentialAssignmentsWithMatcher(
    value,
    (key, assignedValue) => valuesByKey.get(key.toLowerCase())?.has(assignedValue) === true,
    replacement
  )
}
