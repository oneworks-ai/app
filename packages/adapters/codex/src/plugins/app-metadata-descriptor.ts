import type {
  PluginNativeAppAuthentication,
  PluginNativeAppConnectionRequirements,
  PluginNativeAppMetadata
} from '@oneworks/types'

import {
  getAliasedAppMetadataValue,
  hasOnlyOwnAllowedAppMetadataKeys,
  isPlainAppMetadataRecord,
  normalizeDeclarativeList,
  normalizeDeclarativeValue,
  normalizeHttpUrl,
  normalizeRootRelativeRoute
} from './app-metadata-normalization'

const APP_DESCRIPTOR_KEYS = new Set([
  'authentication',
  'capabilities',
  'connectionRequirements',
  'connection_requirements',
  'id',
  'permissions',
  'required'
])
const AUTHENTICATION_KEYS = new Set([
  'authorizationUrl',
  'authorization_url',
  'callbackPath',
  'callback_path',
  'scopes',
  'tokenUrl',
  'token_url',
  'type'
])
const CONNECTION_REQUIREMENT_KEYS = new Set([
  'callbackPath',
  'callback_path',
  'endpoint',
  'required',
  'type'
])

const parseAuthentication = (
  value: unknown
): PluginNativeAppAuthentication | undefined => {
  if (
    !isPlainAppMetadataRecord(value) ||
    !hasOnlyOwnAllowedAppMetadataKeys(value, AUTHENTICATION_KEYS)
  ) return undefined
  const authorizationUrl = getAliasedAppMetadataValue(
    value,
    'authorizationUrl',
    'authorization_url'
  )
  const callbackPath = getAliasedAppMetadataValue(value, 'callbackPath', 'callback_path')
  const tokenUrl = getAliasedAppMetadataValue(value, 'tokenUrl', 'token_url')
  if (authorizationUrl.conflict || callbackPath.conflict || tokenUrl.conflict) return undefined

  const result: PluginNativeAppAuthentication = {}
  if (Object.hasOwn(value, 'type')) {
    const type = normalizeDeclarativeValue(value.type, {
      field: 'authenticationType',
      maxBytes: 32
    })
    if (type == null) return undefined
    result.type = type
  }
  if (authorizationUrl.value != null) {
    const normalized = normalizeHttpUrl(authorizationUrl.value)
    if (normalized == null) return undefined
    result.authorizationUrl = normalized
  }
  if (tokenUrl.value != null) {
    const normalized = normalizeHttpUrl(tokenUrl.value)
    if (normalized == null) return undefined
    result.tokenUrl = normalized
  }
  if (callbackPath.value != null) {
    const normalized = normalizeRootRelativeRoute(callbackPath.value)
    if (normalized == null) return undefined
    result.callbackPath = normalized
  }
  if (Object.hasOwn(value, 'scopes')) {
    const scopes = normalizeDeclarativeList(value.scopes, {
      itemBytes: 256,
      maxItems: 64,
      field: 'scope'
    })
    if (scopes == null) return undefined
    result.scopes = scopes
  }
  return result
}

const parseConnectionRequirements = (
  value: unknown
): PluginNativeAppConnectionRequirements | undefined => {
  if (
    !isPlainAppMetadataRecord(value) ||
    !hasOnlyOwnAllowedAppMetadataKeys(value, CONNECTION_REQUIREMENT_KEYS)
  ) return undefined
  const callbackPath = getAliasedAppMetadataValue(value, 'callbackPath', 'callback_path')
  if (callbackPath.conflict) return undefined

  const result: PluginNativeAppConnectionRequirements = {}
  if (Object.hasOwn(value, 'required')) {
    if (typeof value.required !== 'boolean') return undefined
    result.required = value.required
  }
  if (Object.hasOwn(value, 'type')) {
    const type = normalizeDeclarativeValue(value.type, {
      field: 'connectionType',
      maxBytes: 32
    })
    if (type == null) return undefined
    result.type = type
  }
  if (Object.hasOwn(value, 'endpoint')) {
    const endpoint = normalizeHttpUrl(value.endpoint)
    if (endpoint == null) return undefined
    result.endpoint = endpoint
  }
  if (callbackPath.value != null) {
    const normalized = normalizeRootRelativeRoute(callbackPath.value)
    if (normalized == null) return undefined
    result.callbackPath = normalized
  }
  return result
}

export const parseAppMetadataDescriptor = (
  name: string,
  value: unknown,
  manifestCapabilities: string[] | undefined
): PluginNativeAppMetadata | undefined => {
  if (
    !isPlainAppMetadataRecord(value) ||
    !hasOnlyOwnAllowedAppMetadataKeys(value, APP_DESCRIPTOR_KEYS) ||
    !Object.hasOwn(value, 'id')
  ) return undefined
  const id = normalizeDeclarativeValue(value.id, { field: 'appId', maxBytes: 128 })
  if (id == null) return undefined

  const authentication = Object.hasOwn(value, 'authentication')
    ? parseAuthentication(value.authentication)
    : undefined
  if (Object.hasOwn(value, 'authentication') && authentication == null) return undefined
  const capabilities = Object.hasOwn(value, 'capabilities')
    ? normalizeDeclarativeList(value.capabilities, {
      itemBytes: 256,
      maxItems: 64,
      field: 'capability'
    })
    : manifestCapabilities
  if (Object.hasOwn(value, 'capabilities') && capabilities == null) return undefined
  const permissions = Object.hasOwn(value, 'permissions')
    ? normalizeDeclarativeList(value.permissions, {
      itemBytes: 256,
      maxItems: 128,
      field: 'permission'
    })
    : undefined
  if (Object.hasOwn(value, 'permissions') && permissions == null) return undefined

  const connectionValue = getAliasedAppMetadataValue(
    value,
    'connectionRequirements',
    'connection_requirements'
  )
  if (connectionValue.conflict) return undefined
  let connectionRequirements = connectionValue.value == null
    ? undefined
    : parseConnectionRequirements(connectionValue.value)
  if (connectionValue.value != null && connectionRequirements == null) return undefined
  if (Object.hasOwn(value, 'required')) {
    if (typeof value.required !== 'boolean') return undefined
    if (
      connectionRequirements?.required != null &&
      connectionRequirements.required !== value.required
    ) return undefined
    connectionRequirements = {
      ...(connectionRequirements ?? {}),
      required: value.required
    }
  }

  return {
    id,
    name,
    ...(authentication == null ? {} : { authentication }),
    ...(capabilities == null ? {} : { capabilities }),
    ...(connectionRequirements == null ? {} : { connectionRequirements }),
    ...(permissions == null ? {} : { permissions })
  }
}
