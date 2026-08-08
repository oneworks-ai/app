import type {
  PluginNativeAppAuthentication,
  PluginNativeAppConnectionRequirements,
  PluginNativeAppMetadata,
  PluginNativeMetadata,
  PluginNativeMetadataDiagnostic,
  PublicPluginDiagnostic
} from '@oneworks/types'

import { isCredentialShapedPublicValue } from './plugin-public-api-generic'
import {
  getPublicValue,
  hasPublicFields,
  hasUnsafePublicUrlMetadata,
  hasUnsafePublicUrlWhitespace,
  isPublicRecord,
  parseOptionalPublicText,
  parsePublicArray,
  parsePublicString,
  parsePublicStringList,
  parsePublicTextList
} from './plugin-public-api-values'
import type { PublicParseState } from './plugin-public-api-values'

const DIAGNOSTIC_LEVELS = new Set(['error', 'info', 'warning'])
const isDiagnosticLevel = (value: string): value is PublicPluginDiagnostic['level'] => (
  DIAGNOSTIC_LEVELS.has(value)
)

const decodePublicUrlValue = (value: string, isUnsafe: (candidate: string) => boolean) => {
  let candidate = value
  for (let depth = 0; depth <= 4; depth += 1) {
    if (isUnsafe(candidate)) return undefined
    try {
      const decoded = decodeURIComponent(candidate)
      if (isUnsafe(decoded)) return undefined
      if (decoded === candidate) return candidate
      candidate = decoded
    } catch {
      return undefined
    }
  }
  return undefined
}

const parsePublicNativeUrl = (value: unknown, state: PublicParseState) => {
  const parsed = parsePublicString(value, state)
  if (
    parsed == null ||
    hasUnsafePublicUrlWhitespace(parsed) ||
    isCredentialShapedPublicValue(parsed)
  ) return undefined
  if (decodePublicUrlValue(parsed, hasUnsafePublicUrlWhitespace) == null) return undefined
  try {
    const url = new URL(parsed)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username !== '' ||
      url.password !== ''
    ) return undefined
    return hasUnsafePublicUrlMetadata(url, { allowRedirectValues: true })
      ? undefined
      : parsed
  } catch {
    return undefined
  }
}

const parsePublicNativeRoute = (value: unknown, state: PublicParseState) => {
  const parsed = parsePublicString(value, state)
  if (
    parsed == null ||
    !parsed.startsWith('/') ||
    parsed.startsWith('//') ||
    parsed.includes('\\') ||
    parsed.includes('\0') ||
    hasUnsafePublicUrlWhitespace(parsed) ||
    isCredentialShapedPublicValue(parsed)
  ) return undefined
  const candidate = decodePublicUrlValue(parsed, current => (
    hasUnsafePublicUrlWhitespace(current) ||
    current.split(/[?#]/u)[0]?.split('/').includes('..') === true
  ))
  if (candidate == null) return undefined
  const url = new URL(candidate, 'https://public.invalid/')
  return hasUnsafePublicUrlMetadata(url) ? undefined : parsed
}

const parseAuthentication = (value: unknown, state: PublicParseState) => {
  if (!isPublicRecord(value, state)) return undefined
  const result: PluginNativeAppAuthentication = {}
  for (const key of ['authorizationUrl', 'tokenUrl'] as const) {
    const raw = getPublicValue(value, key)
    if (raw == null) continue
    const parsed = parsePublicNativeUrl(raw, state)
    if (parsed == null) return undefined
    result[key] = parsed
  }
  const callbackRaw = getPublicValue(value, 'callbackPath')
  if (callbackRaw != null) {
    const callbackPath = parsePublicNativeRoute(callbackRaw, state)
    if (callbackPath == null) return undefined
    result.callbackPath = callbackPath
  }
  const type = parseOptionalPublicText(value, 'type', state)
  if (type != null) {
    if (isCredentialShapedPublicValue(type)) return undefined
    result.type = type
  }
  const scopes = parsePublicStringList(getPublicValue(value, 'scopes'), state, 64)
  if (scopes != null) {
    if (scopes.some(isCredentialShapedPublicValue)) return undefined
    result.scopes = scopes
  }
  return hasPublicFields(result) ? result : undefined
}

const parseConnection = (value: unknown, state: PublicParseState) => {
  if (!isPublicRecord(value, state)) return undefined
  const result: PluginNativeAppConnectionRequirements = {}
  for (const key of ['callbackPath', 'endpoint'] as const) {
    const raw = getPublicValue(value, key)
    if (raw == null) continue
    const parsed = key === 'endpoint'
      ? parsePublicNativeUrl(raw, state)
      : parsePublicNativeRoute(raw, state)
    if (parsed == null) return undefined
    result[key] = parsed
  }
  const type = parseOptionalPublicText(value, 'type', state)
  if (type != null) {
    if (isCredentialShapedPublicValue(type)) return undefined
    result.type = type
  }
  const required = getPublicValue(value, 'required')
  if (typeof required === 'boolean') result.required = required
  return hasPublicFields(result) ? result : undefined
}

const parseNativeApp = (value: unknown, state: PublicParseState): PluginNativeAppMetadata | undefined => {
  if (!isPublicRecord(value, state)) return undefined
  const id = parseOptionalPublicText(value, 'id', state)
  if (id == null) return undefined
  const result: PluginNativeAppMetadata = { id }
  const name = parseOptionalPublicText(value, 'name', state)
  if (name != null) result.name = name
  for (const key of ['capabilities', 'permissions'] as const) {
    const parsed = parsePublicTextList(getPublicValue(value, key), state, 64)
    if (parsed != null) result[key] = parsed
  }
  const authenticationValue = getPublicValue(value, 'authentication')
  const authentication = parseAuthentication(authenticationValue, state)
  if (authenticationValue != null && authentication == null) return undefined
  if (authentication != null) result.authentication = authentication
  const connectionValue = getPublicValue(value, 'connectionRequirements')
  const connectionRequirements = parseConnection(connectionValue, state)
  if (connectionValue != null && connectionRequirements == null) return undefined
  if (connectionRequirements != null) result.connectionRequirements = connectionRequirements
  return result
}

export const parsePublicNativeMetadata = (
  value: unknown,
  state: PublicParseState
): PluginNativeMetadata | undefined => {
  if (!isPublicRecord(value, state)) return undefined
  const adapter = parseOptionalPublicText(value, 'adapter', state)
  if (adapter == null) return undefined
  const result: PluginNativeMetadata = { adapter }
  const rawApps = getPublicValue(value, 'apps')
  if (rawApps != null) {
    const appsValue = parsePublicArray(rawApps, state, 64)
    if (appsValue == null) return undefined
    const apps: PluginNativeAppMetadata[] = []
    for (const rawApp of appsValue) {
      const app = parseNativeApp(rawApp, state)
      if (app == null) return undefined
      apps.push(app)
    }
    result.apps = apps
  }
  const rawDiagnostics = getPublicValue(value, 'diagnostics')
  if (rawDiagnostics != null) {
    const diagnosticsValue = parsePublicArray(rawDiagnostics, state, 128)
    if (diagnosticsValue == null) return undefined
    const diagnostics: PluginNativeMetadataDiagnostic[] = []
    for (const item of diagnosticsValue) {
      if (!isPublicRecord(item, state)) return undefined
      const code = parseOptionalPublicText(item, 'code', state)
      const message = parseOptionalPublicText(item, 'message', state)
      const level = parseOptionalPublicText(item, 'level', state)
      if (code == null || message == null || level == null || !isDiagnosticLevel(level)) return undefined
      diagnostics.push({ code, level, message })
    }
    result.diagnostics = diagnostics
  }
  return result
}
