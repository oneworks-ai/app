/* eslint-disable max-lines -- public plugin shapes stay explicit and fail closed in one contract module. */
import type {
  PluginConfigManifest,
  PluginContributionCliCommand,
  PluginContributionManifest,
  PluginContributionSurface,
  PluginLocalizedText,
  PluginRuntimeApiRegistration,
  PluginRuntimeEndpointStatus,
  PluginServerManifest,
  PluginServerRuntimeRole,
  PublicPluginRuntimeEndpoint
} from '@oneworks/types'

import { parsePublicContributionField } from './plugin-public-api-contributions'
import {
  parsePublicJsonRecord,
  parsePublicSchemaJsonRecord,
  parsePublicStringRecord
} from './plugin-public-api-generic'
import {
  getPublicValue,
  isFilesystemShapedPublicValue,
  isPublicRecord,
  parseOptionalPublicString,
  parseOptionalPublicText,
  parsePublicArray,
  parsePublicAssetString,
  parsePublicEndpointString,
  parsePublicString,
  parsePublicStringList,
  parsePublicText
} from './plugin-public-api-values'
import type { PublicParseState } from './plugin-public-api-values'

const SERVER_ROLES = new Set(['manager', 'workspace'])
const CONTRIBUTION_SURFACES = new Set(['launcher', 'workspace'])
const API_MODES = new Set(['handler', 'proxy'])
const RUNTIME_STATUSES = new Set(['offline', 'online', 'unknown'])
const CLI_COMMAND_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u
const CONTRIBUTION_KEYS = new Set([
  'chatHeaderActions',
  'chatHeaderMoreMenu',
  'chatInteractionPanelEmptyActions',
  'cliCommands',
  'extensionContributions',
  'extensionPoints',
  'launcherSearchProviders',
  'navFooterBefore',
  'navItems',
  'navMoreMenu',
  'roles',
  'routeHeaderActions',
  'routeMoreMenu',
  'routeMoreMenuItems',
  'routes',
  'routeSidebarContextMenu',
  'routeWindowBarActions',
  'sessionGroups',
  'settingsPages',
  'surfaces',
  'toolUsePresentations',
  'usageSources',
  'workbenchAddMenu',
  'workbenchTabs',
  'workspaceDrawerTabs'
])
const CONFIG_KEYS = new Set(['jsonSchema', 'schema', 'uiSchema'])
const API_KEYS = new Set([
  'description',
  'headerSchema',
  'id',
  'inputSchema',
  'mode',
  'outputSchema',
  'proxyTarget',
  'target',
  'title'
])
const CLI_COMMAND_KEYS = new Set([
  'aliases',
  'command',
  'description',
  'descriptionI18n',
  'i18n',
  'id',
  'path',
  'roles',
  'root',
  'surfaces',
  'title',
  'titleI18n'
])

const isServerRole = (value: string): value is PluginServerRuntimeRole => SERVER_ROLES.has(value)
const isContributionSurface = (value: string): value is PluginContributionSurface => CONTRIBUTION_SURFACES.has(value)
const isApiMode = (value: string): value is PluginRuntimeApiRegistration['mode'] => API_MODES.has(value)
const isRuntimeStatus = (value: string): value is PluginRuntimeEndpointStatus => RUNTIME_STATUSES.has(value)

const parsePublicRuntimeServerBaseUrl = (value: unknown, state: PublicParseState) => {
  const parsed = parsePublicString(value, state)
  if (parsed == null || parsed.length > 2_048) return undefined
  try {
    const url = new URL(parsed)
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username !== '' ||
      url.password !== '' ||
      (url.pathname !== '' && url.pathname !== '/') ||
      url.search !== '' ||
      url.hash !== ''
    ) return undefined
    return url.origin
  } catch {
    return undefined
  }
}

const parsePublicRuntimeStartedAt = (value: unknown, state: PublicParseState) => {
  const parsed = parsePublicString(value, state)
  if (parsed == null || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(parsed)) return undefined
  const date = new Date(parsed)
  return Number.isNaN(date.valueOf()) || date.toISOString() !== parsed ? undefined : parsed
}

const parseLocalizedText = (value: unknown, state: PublicParseState): PluginLocalizedText | undefined => {
  if (typeof value === 'string') return parsePublicText(value, state)
  return parsePublicStringRecord(value, state)
}

const parsePublicApiProxyTarget = (value: unknown, state: PublicParseState) => {
  if (typeof value !== 'string') return undefined
  if (/^https?:\/\//iu.test(value)) return parsePublicEndpointString(value, state)
  const parsed = parsePublicText(value, state)
  return parsed != null && /^[a-z][\w.-]{0,127}$/iu.test(parsed) ? parsed : undefined
}

const parseCliI18n = (value: unknown, state: PublicParseState) => {
  const parsed = parsePublicJsonRecord(value, state)
  if (parsed == null) return undefined
  const result: NonNullable<PluginContributionCliCommand['i18n']> = {}
  for (const [locale, entry] of Object.entries(parsed)) {
    if (entry == null || Array.isArray(entry) || typeof entry !== 'object') return undefined
    if (Object.keys(entry).some(key => key !== 'description' && key !== 'title')) return undefined
    const localized: { description?: string; title?: string } = {}
    for (const key of ['description', 'title'] as const) {
      const text = (entry as Record<string, unknown>)[key]
      if (text != null && typeof text !== 'string') return undefined
      if (typeof text === 'string') localized[key] = text
    }
    result[locale] = localized
  }
  return result
}

const parsePublicCliCommands = (value: unknown, state: PublicParseState) => {
  const entries = parsePublicArray(value, state, 128)
  if (entries == null) return undefined
  const result: PluginContributionCliCommand[] = []
  for (const entry of entries) {
    if (!isPublicRecord(entry, state)) return undefined
    if (Object.keys(entry).some(key => !CLI_COMMAND_KEYS.has(key))) return undefined
    const command = parseOptionalPublicString(entry, 'command', state)
    const id = parseOptionalPublicString(entry, 'id', state)
    if (
      command == null ||
      id == null ||
      !CLI_COMMAND_ID_PATTERN.test(command) ||
      !CLI_COMMAND_ID_PATTERN.test(id)
    ) return undefined
    const item: PluginContributionCliCommand = { command, id }
    for (const key of ['aliases', 'path'] as const) {
      const raw = getPublicValue(entry, key)
      const parsed = raw == null ? undefined : parsePublicStringList(raw, state, 64)
      if (raw != null && (parsed == null || !parsed.every(value => CLI_COMMAND_ID_PATTERN.test(value)))) {
        return undefined
      }
      if (parsed != null) item[key] = parsed
    }
    const rawDescription = getPublicValue(entry, 'description')
    const description = rawDescription == null ? undefined : parseLocalizedText(rawDescription, state)
    if (rawDescription != null && description == null) return undefined
    if (description != null) item.description = description
    const rawTitle = getPublicValue(entry, 'title')
    const title = rawTitle == null ? undefined : parsePublicText(rawTitle, state)
    if (rawTitle != null && title == null) return undefined
    if (title != null) item.title = title
    for (const key of ['descriptionI18n', 'titleI18n'] as const) {
      const raw = getPublicValue(entry, key)
      const parsed = raw == null ? undefined : parsePublicStringRecord(raw, state)
      if (raw != null && parsed == null) return undefined
      if (parsed != null) item[key] = parsed
    }
    const rawI18n = getPublicValue(entry, 'i18n')
    const i18n = rawI18n == null ? undefined : parseCliI18n(rawI18n, state)
    if (rawI18n != null && i18n == null) return undefined
    if (i18n != null) item.i18n = i18n
    const rawRoles = getPublicValue(entry, 'roles')
    const roles = rawRoles == null ? undefined : parsePublicStringList(rawRoles, state, 2)
    if (rawRoles != null && (roles == null || !roles.every(isServerRole))) return undefined
    if (roles != null && roles.every(isServerRole)) item.roles = roles
    const rawSurfaces = getPublicValue(entry, 'surfaces')
    const surfaces = rawSurfaces == null ? undefined : parsePublicStringList(rawSurfaces, state, 2)
    if (rawSurfaces != null && (surfaces == null || !surfaces.every(isContributionSurface))) return undefined
    if (surfaces != null && surfaces.every(isContributionSurface)) item.surfaces = surfaces
    const root = getPublicValue(entry, 'root')
    if (Object.hasOwn(entry, 'root') && typeof root !== 'boolean') return undefined
    if (typeof root === 'boolean') item.root = root
    result.push(item)
  }
  return result
}

export const parsePublicContributionManifest = (value: unknown, state: PublicParseState) => {
  if (!isPublicRecord(value, state)) return undefined
  if (Object.keys(value).some(key => !CONTRIBUTION_KEYS.has(key))) return undefined
  const parsed: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    const raw = getPublicValue(value, key)
    const field = key === 'cliCommands'
      ? parsePublicCliCommands(raw, state)
      : parsePublicContributionField(key, raw, state)
    if (field === undefined) return undefined
    parsed[key] = field
  }
  const result: PluginContributionManifest = {}
  Object.assign(result, parsed)
  return result
}

export const parsePublicConfigManifest = (value: unknown, state: PublicParseState) => {
  const parsed = parsePublicSchemaJsonRecord(value, state)
  if (parsed == null || Object.keys(parsed).some(key => !CONFIG_KEYS.has(key))) return undefined
  const result: PluginConfigManifest = {}
  Object.assign(result, parsed)
  return result
}

export const parsePublicServerManifest = (value: unknown, state: PublicParseState) => {
  const parsed = parsePublicJsonRecord(value, state)
  if (parsed == null || Object.keys(parsed).some(key => key !== 'entry' && key !== 'roles')) return undefined
  const roles = parsePublicStringList(getPublicValue(parsed, 'roles'), state, 2)
  if (roles == null || !roles.every(isServerRole)) return undefined
  const entry = parsePublicAssetString(getPublicValue(parsed, 'entry'), state)
  const server: PluginServerManifest = entry == null ? { roles } : {
    entry,
    roles
  }
  return server
}

export const parsePublicRuntimeEndpoint = (value: unknown, state: PublicParseState) => {
  if (!isPublicRecord(value, state)) return undefined
  const id = parseOptionalPublicString(value, 'id', state)
  const role = parseOptionalPublicString(value, 'role', state)
  if (id == null || role == null || !isServerRole(role)) return undefined
  const result: PublicPluginRuntimeEndpoint = { id, role }
  const current = getPublicValue(value, 'current')
  if (Object.hasOwn(value, 'current') && typeof current !== 'boolean') return undefined
  if (typeof current === 'boolean') result.current = current
  const rawServerBaseUrl = getPublicValue(value, 'serverBaseUrl')
  const serverBaseUrl = rawServerBaseUrl == null
    ? undefined
    : parsePublicRuntimeServerBaseUrl(rawServerBaseUrl, state)
  if (rawServerBaseUrl != null && serverBaseUrl == null) return undefined
  if (serverBaseUrl != null) result.serverBaseUrl = serverBaseUrl
  if (
    isFilesystemShapedPublicValue(id) &&
    (serverBaseUrl == null || id !== `${role}:${serverBaseUrl}`)
  ) return undefined
  const rawStartedAt = getPublicValue(value, 'startedAt')
  const startedAt = rawStartedAt == null ? undefined : parsePublicRuntimeStartedAt(rawStartedAt, state)
  if (rawStartedAt != null && startedAt == null) return undefined
  if (startedAt != null) result.startedAt = startedAt
  const rawWorkspaceId = getPublicValue(value, 'workspaceId')
  const workspaceId = rawWorkspaceId == null ? undefined : parsePublicText(rawWorkspaceId, state)
  if (rawWorkspaceId != null && workspaceId == null) return undefined
  if (workspaceId != null) result.workspaceId = workspaceId
  const rawStatus = getPublicValue(value, 'status')
  const status = rawStatus == null ? undefined : parsePublicString(rawStatus, state)
  if (rawStatus != null && (status == null || !isRuntimeStatus(status))) return undefined
  if (status != null && isRuntimeStatus(status)) result.status = status
  return result
}

export const parsePublicApiRegistrations = (value: unknown, state: PublicParseState) => {
  const entries = parsePublicArray(value, state, 128)
  if (entries == null) return undefined
  const result: PluginRuntimeApiRegistration[] = []
  for (const entry of entries) {
    if (!isPublicRecord(entry, state)) return undefined
    if (Object.keys(entry).some(key => !API_KEYS.has(key))) return undefined
    const id = parseOptionalPublicText(entry, 'id', state)
    const mode = parseOptionalPublicString(entry, 'mode', state)
    const target = parsePublicEndpointString(getPublicValue(entry, 'target'), state)
    if (id == null || target == null || mode == null || !isApiMode(mode)) return undefined
    const rawDescription = getPublicValue(entry, 'description')
    const rawTitle = getPublicValue(entry, 'title')
    const rawProxyTarget = getPublicValue(entry, 'proxyTarget')
    const rawHeaderSchema = getPublicValue(entry, 'headerSchema')
    const rawInputSchema = getPublicValue(entry, 'inputSchema')
    const rawOutputSchema = getPublicValue(entry, 'outputSchema')
    const description = parseLocalizedText(rawDescription, state)
    const title = parseLocalizedText(rawTitle, state)
    const proxyTarget = rawProxyTarget == null
      ? undefined
      : parsePublicApiProxyTarget(rawProxyTarget, state)
    const headerSchema = parsePublicSchemaJsonRecord(rawHeaderSchema, state)
    const inputSchema = parsePublicSchemaJsonRecord(rawInputSchema, state)
    const outputSchema = parsePublicSchemaJsonRecord(rawOutputSchema, state)
    if (
      (rawDescription != null && description == null) ||
      (rawTitle != null && title == null) ||
      (rawProxyTarget != null && proxyTarget == null) ||
      (rawHeaderSchema != null && headerSchema == null) ||
      (rawInputSchema != null && inputSchema == null) ||
      (rawOutputSchema != null && outputSchema == null)
    ) return undefined
    result.push({
      id,
      mode,
      target,
      ...(description == null ? {} : { description }),
      ...(headerSchema == null ? {} : { headerSchema }),
      ...(inputSchema == null ? {} : { inputSchema }),
      ...(outputSchema == null ? {} : { outputSchema }),
      ...(proxyTarget == null ? {} : { proxyTarget }),
      ...(title == null ? {} : { title })
    })
  }
  return result
}
