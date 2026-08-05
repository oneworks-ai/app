import type {
  PluginManifestAssets,
  PluginNativeAppAuthentication,
  PluginNativeAppConnectionRequirements,
  PluginNativeAppMetadata,
  PluginNativeMetadata,
  PluginNativeMetadataDiagnostic,
  PluginRuntimeSource,
  PublicPluginClientManifest,
  PublicPluginDiagnostic,
  PublicPluginRuntimeInstance,
  PublicPluginRuntimeManifest
} from '@oneworks/types'
import {
  parsePublicConfigManifest,
  parsePublicContributionManifest,
  parsePublicServerManifest
} from './plugin-public-api-contract'
import { parsePublicStringRecord } from './plugin-public-api-generic'
import {
  getPublicValue,
  hasPublicFields,
  isPublicRecord,
  parseOptionalPublicString,
  parsePublicArray,
  parsePublicStringList
} from './plugin-public-api-values'
import type { PublicParseState } from './plugin-public-api-values'
const SOURCE_KINDS = new Set(['directory', 'marketplace', 'package'])
const SOURCE_GROUPS = new Set(['builtIn', 'global', 'localDev', 'project'])
const DIAGNOSTIC_LEVELS = new Set(['error', 'info', 'warning'])
const CLIENT_ENTRY_KINDS = new Set(['dev-server', 'host-vite', 'runtime-source'])
export const isSourceGroup = (value: string): value is NonNullable<PublicPluginRuntimeInstance['sourceGroup']> =>
  SOURCE_GROUPS.has(value)
export const isClientEntryKind = (
  value: string
): value is NonNullable<PublicPluginClientManifest['devClientEntryKind']> => CLIENT_ENTRY_KINDS.has(value)
const isSourceKind = (value: string): value is PluginRuntimeSource['kind'] => SOURCE_KINDS.has(value)
const isDiagnosticLevel = (value: string): value is PublicPluginDiagnostic['level'] => DIAGNOSTIC_LEVELS.has(value)

export const parsePublicClientManifest = (value: unknown, state: PublicParseState) => {
  if (!isPublicRecord(value, state)) return undefined
  const result: PublicPluginClientManifest = {}
  for (const key of ['clientEntryUrl', 'devClientEntryUrl', 'devEntry', 'devServer', 'entry'] as const) {
    const parsed = parseOptionalPublicString(value, key, state)
    if (parsed != null) result[key] = parsed
  }
  const kind = parseOptionalPublicString(value, 'devClientEntryKind', state)
  if (kind != null && isClientEntryKind(kind)) result.devClientEntryKind = kind
  return hasPublicFields(result) ? result : undefined
}

export const parseRuntimeSource = (value: unknown, state: PublicParseState): PluginRuntimeSource | undefined => {
  if (!isPublicRecord(value, state)) return undefined
  const kind = parseOptionalPublicString(value, 'kind', state)
  if (kind == null || !isSourceKind(kind)) return undefined
  const result: PluginRuntimeSource = { kind }
  for (const key of ['adapter', 'marketplace', 'plugin'] as const) {
    const parsed = parseOptionalPublicString(value, key, state)
    if (parsed != null) result[key] = parsed
  }
  return result
}

const parseAuthentication = (value: unknown, state: PublicParseState) => {
  if (!isPublicRecord(value, state)) return undefined
  const result: PluginNativeAppAuthentication = {}
  for (const key of ['authorizationUrl', 'callbackPath', 'tokenUrl', 'type'] as const) {
    const parsed = parseOptionalPublicString(value, key, state)
    if (parsed != null) result[key] = parsed
  }
  const scopes = parsePublicStringList(getPublicValue(value, 'scopes'), state, 64)
  if (scopes != null) result.scopes = scopes
  return hasPublicFields(result) ? result : undefined
}

const parseConnection = (value: unknown, state: PublicParseState) => {
  if (!isPublicRecord(value, state)) return undefined
  const result: PluginNativeAppConnectionRequirements = {}
  for (const key of ['callbackPath', 'endpoint', 'type'] as const) {
    const parsed = parseOptionalPublicString(value, key, state)
    if (parsed != null) result[key] = parsed
  }
  const required = getPublicValue(value, 'required')
  if (typeof required === 'boolean') result.required = required
  return hasPublicFields(result) ? result : undefined
}

const parseNativeApp = (value: unknown, state: PublicParseState): PluginNativeAppMetadata | undefined => {
  if (!isPublicRecord(value, state)) return undefined
  const id = parseOptionalPublicString(value, 'id', state)
  if (id == null) return undefined
  const result: PluginNativeAppMetadata = { id }
  const name = parseOptionalPublicString(value, 'name', state)
  if (name != null) result.name = name
  for (const key of ['capabilities', 'permissions'] as const) {
    const parsed = parsePublicStringList(getPublicValue(value, key), state, 64)
    if (parsed != null) result[key] = parsed
  }
  const authentication = parseAuthentication(getPublicValue(value, 'authentication'), state)
  if (authentication != null) result.authentication = authentication
  const connectionRequirements = parseConnection(getPublicValue(value, 'connectionRequirements'), state)
  if (connectionRequirements != null) result.connectionRequirements = connectionRequirements
  return result
}

const parseNative = (value: unknown, state: PublicParseState): PluginNativeMetadata | undefined => {
  if (!isPublicRecord(value, state)) return undefined
  const adapter = parseOptionalPublicString(value, 'adapter', state)
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
      const code = parseOptionalPublicString(item, 'code', state)
      const message = parseOptionalPublicString(item, 'message', state)
      const level = parseOptionalPublicString(item, 'level', state)
      if (code == null || message == null || level == null || !isDiagnosticLevel(level)) return undefined
      diagnostics.push({ code, level, message })
    }
    result.diagnostics = diagnostics
  }
  return result
}

export const parsePublicRuntimeManifest = (value: unknown, state: PublicParseState) => {
  if (!isPublicRecord(value, state)) return undefined
  const result: PublicPluginRuntimeManifest = {}
  for (const key of ['description', 'displayName', 'icon', 'name', 'version'] as const) {
    const parsed = parseOptionalPublicString(value, key, state)
    if (parsed != null) result[key] = parsed
  }
  for (const key of ['descriptionI18n', 'displayNameI18n'] as const) {
    const parsed = parsePublicStringRecord(getPublicValue(value, key), state)
    if (parsed != null) result[key] = parsed
  }
  const config = parsePublicConfigManifest(getPublicValue(value, 'config'), state)
  if (config != null) result.config = config
  const source = parseRuntimeSource(getPublicValue(value, 'source'), state)
  if (source != null) result.source = source
  const native = parseNative(getPublicValue(value, 'native'), state)
  if (native != null) result.native = native
  const assetsValue = getPublicValue(value, 'assets')
  if (assetsValue != null && isPublicRecord(assetsValue, state)) {
    const assets: PluginManifestAssets = {}
    for (const key of ['apps', 'entities', 'hooks', 'mcp', 'rules', 'skills', 'specs'] as const) {
      const parsed = parseOptionalPublicString(assetsValue, key, state)
      if (parsed != null) assets[key] = parsed
    }
    if (hasPublicFields(assets)) result.assets = assets
  }
  const pluginValue = getPublicValue(value, 'plugin')
  if (pluginValue != null && isPublicRecord(pluginValue, state)) {
    const client = parsePublicClientManifest(getPublicValue(pluginValue, 'client'), state)
    const contributions = parsePublicContributionManifest(
      getPublicValue(pluginValue, 'contributions'),
      state
    )
    const server = parsePublicServerManifest(getPublicValue(pluginValue, 'server'), state)
    if (client != null || contributions != null || server != null) {
      result.plugin = { client, contributions, server }
    }
  }
  return hasPublicFields(result) ? result : undefined
}

export const parsePublicDiagnostics = (value: unknown, state: PublicParseState) => {
  const diagnosticsValue = parsePublicArray(value, state, 128)
  if (diagnosticsValue == null) return undefined
  const diagnostics: PublicPluginDiagnostic[] = []
  for (const item of diagnosticsValue) {
    if (!isPublicRecord(item, state)) return undefined
    const level = parseOptionalPublicString(item, 'level', state)
    const message = parseOptionalPublicString(item, 'message', state)
    if (level == null || message == null || !isDiagnosticLevel(level)) return undefined
    const diagnostic: PublicPluginDiagnostic = { level, message }
    const code = parseOptionalPublicString(item, 'code', state)
    const scope = parseOptionalPublicString(item, 'scope', state)
    if (code != null) diagnostic.code = code
    if (scope != null) diagnostic.scope = scope
    diagnostics.push(diagnostic)
  }
  return diagnostics
}
