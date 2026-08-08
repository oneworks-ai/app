import type {
  PluginManifestAssets,
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
import { parsePublicNativeMetadata } from './plugin-public-api-native'
import {
  getPublicValue,
  hasPublicFields,
  isPublicRecord,
  parseOptionalPublicText,
  parsePublicArray,
  parsePublicAssetString,
  parsePublicEndpointString
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
  for (const key of ['clientEntryUrl', 'devClientEntryUrl', 'devServer'] as const) {
    const parsed = parsePublicEndpointString(getPublicValue(value, key), state)
    if (parsed != null) result[key] = parsed
  }
  for (const key of ['devEntry', 'entry'] as const) {
    const parsed = parsePublicAssetString(getPublicValue(value, key), state)
    if (parsed != null) result[key] = parsed
  }
  const kind = parseOptionalPublicText(value, 'devClientEntryKind', state)
  if (kind != null && isClientEntryKind(kind)) result.devClientEntryKind = kind
  return hasPublicFields(result) ? result : undefined
}

export const parseRuntimeSource = (value: unknown, state: PublicParseState): PluginRuntimeSource | undefined => {
  if (!isPublicRecord(value, state)) return undefined
  const kind = parseOptionalPublicText(value, 'kind', state)
  if (kind == null || !isSourceKind(kind)) return undefined
  const result: PluginRuntimeSource = { kind }
  for (const key of ['adapter', 'marketplace', 'plugin'] as const) {
    const parsed = parseOptionalPublicText(value, key, state)
    if (parsed != null) result[key] = parsed
  }
  return result
}

export const parsePublicRuntimeManifest = (value: unknown, state: PublicParseState) => {
  if (!isPublicRecord(value, state)) return undefined
  const result: PublicPluginRuntimeManifest = {}
  for (const key of ['description', 'displayName', 'name', 'version'] as const) {
    const parsed = parseOptionalPublicText(value, key, state)
    if (parsed != null) result[key] = parsed
  }
  const icon = parsePublicAssetString(getPublicValue(value, 'icon'), state)
  if (icon != null) result.icon = icon
  for (const key of ['descriptionI18n', 'displayNameI18n'] as const) {
    const parsed = parsePublicStringRecord(getPublicValue(value, key), state)
    if (parsed != null) result[key] = parsed
  }
  const config = parsePublicConfigManifest(getPublicValue(value, 'config'), state)
  if (config != null) result.config = config
  const source = parseRuntimeSource(getPublicValue(value, 'source'), state)
  if (source != null) result.source = source
  const native = parsePublicNativeMetadata(getPublicValue(value, 'native'), state)
  if (native != null) result.native = native
  const assetsValue = getPublicValue(value, 'assets')
  if (assetsValue != null && isPublicRecord(assetsValue, state)) {
    const assets: PluginManifestAssets = {}
    for (const key of ['apps', 'entities', 'hooks', 'mcp', 'rules', 'skills', 'specs'] as const) {
      const parsed = parsePublicAssetString(getPublicValue(assetsValue, key), state)
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
    const level = parseOptionalPublicText(item, 'level', state)
    const message = parseOptionalPublicText(item, 'message', state)
    if (level == null || message == null || !isDiagnosticLevel(level)) return undefined
    const diagnostic: PublicPluginDiagnostic = { level, message }
    const code = parseOptionalPublicText(item, 'code', state)
    const scope = parseOptionalPublicText(item, 'scope', state)
    if (code != null) diagnostic.code = code
    if (scope != null) diagnostic.scope = scope
    diagnostics.push(diagnostic)
  }
  return diagnostics
}
