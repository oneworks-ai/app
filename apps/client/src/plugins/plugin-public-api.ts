import type { PublicPluginRuntimeInstance } from '@oneworks/types'

import { parsePublicApiRegistrations, parsePublicContributionManifest } from './plugin-public-api-contract'
import { parsePublicJsonRecord, parsePublicStringRecord } from './plugin-public-api-generic'
import {
  isClientEntryKind,
  isSourceGroup,
  parsePublicClientManifest,
  parsePublicDiagnostics,
  parsePublicRuntimeManifest,
  parseRuntimeSource
} from './plugin-public-api-manifest'
import {
  createPublicParseState,
  getPublicValue,
  isPublicRecord,
  parseOptionalPublicString
} from './plugin-public-api-values'

export const parsePublicPluginRuntimeInstance = (
  value: unknown
): PublicPluginRuntimeInstance | undefined => {
  const state = createPublicParseState()
  if (!isPublicRecord(value, state)) return undefined
  const requestId = parseOptionalPublicString(value, 'requestId', state)
  const scope = parseOptionalPublicString(value, 'scope', state)
  if (requestId == null || scope == null) return undefined

  const result: PublicPluginRuntimeInstance = { requestId, scope }
  for (
    const key of ['description', 'displayName', 'icon', 'name', 'packageId', 'requestedVersion', 'version'] as const
  ) {
    const parsed = parseOptionalPublicString(value, key, state)
    if (parsed != null) result[key] = parsed
  }
  for (const key of ['descriptionI18n', 'displayNameI18n'] as const) {
    const parsed = parsePublicStringRecord(getPublicValue(value, key), state)
    if (parsed != null) result[key] = parsed
  }
  const enabled = getPublicValue(value, 'enabled')
  if (typeof enabled === 'boolean') result.enabled = enabled
  const sourceGroup = parseOptionalPublicString(value, 'sourceGroup', state)
  if (sourceGroup != null && isSourceGroup(sourceGroup)) result.sourceGroup = sourceGroup
  const source = parseRuntimeSource(getPublicValue(value, 'source'), state)
  if (source != null) result.source = source
  const client = parsePublicClientManifest(getPublicValue(value, 'client'), state)
  if (client != null) result.client = client
  for (const key of ['clientEntryUrl', 'devClientEntryUrl'] as const) {
    const parsed = parseOptionalPublicString(value, key, state)
    if (parsed != null) result[key] = parsed
  }
  const entryKind = parseOptionalPublicString(value, 'devClientEntryKind', state)
  if (entryKind != null && isClientEntryKind(entryKind)) result.devClientEntryKind = entryKind
  if (result.clientEntryUrl == null && client?.clientEntryUrl != null) result.clientEntryUrl = client.clientEntryUrl
  if (result.devClientEntryUrl == null && client?.devClientEntryUrl != null) {
    result.devClientEntryUrl = client.devClientEntryUrl
  }
  if (result.devClientEntryKind == null && client?.devClientEntryKind != null) {
    result.devClientEntryKind = client.devClientEntryKind
  }

  const manifest = parsePublicRuntimeManifest(getPublicValue(value, 'manifest'), state)
  if (manifest != null) result.manifest = manifest
  const diagnostics = parsePublicDiagnostics(getPublicValue(value, 'diagnostics'), state)
  if (diagnostics != null) result.diagnostics = diagnostics
  const apis = parsePublicApiRegistrations(getPublicValue(value, 'apis'), state)
  if (apis != null) result.apis = apis
  const contributions = parsePublicContributionManifest(getPublicValue(value, 'contributions'), state)
  if (contributions != null) result.contributions = contributions
  const pluginValue = getPublicValue(value, 'plugin')
  if (pluginValue != null && isPublicRecord(pluginValue, state)) {
    const pluginContributions = parsePublicContributionManifest(
      getPublicValue(pluginValue, 'contributions'),
      state
    )
    if (pluginContributions != null) result.plugin = { contributions: pluginContributions }
  }
  const options = parsePublicJsonRecord(getPublicValue(value, 'options'), state)
  if (options != null) result.options = options
  const watch = getPublicValue(value, 'watch')
  if (watch != null && isPublicRecord(watch, state)) {
    const watchEnabled = getPublicValue(watch, 'enabled')
    if (typeof watchEnabled === 'boolean') result.watch = { enabled: watchEnabled }
  }
  return result
}
