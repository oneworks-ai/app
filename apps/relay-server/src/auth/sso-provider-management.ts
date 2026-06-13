import type { RelaySsoProvider } from '../types.js'
import { now } from '../utils.js'
import {
  DEFAULT_SSO_SCOPE,
  SSO_CLIENT_SECRET_REDACTION,
  normalizeSsoProviderId,
  readSsoText
} from './sso-provider-metadata.js'

const ssoProviderTypes = new Set<RelaySsoProvider['type']>(['oauth2', 'oidc'])

const hasOwn = (body: Record<string, unknown>, field: string) =>
  Object.prototype.hasOwnProperty.call(body, field)

export interface RelayAdminSsoProvider {
  id: string
  name: string
  type: RelaySsoProvider['type']
  authorizationUrl: string
  tokenUrl: string
  userInfoUrl: string
  scope: string
  enabled: boolean
  clientId: string
  clientSecret: typeof SSO_CLIENT_SECRET_REDACTION | null
  createdAt: string
  updatedAt: string | null
}

const requireText = (value: unknown, field: string) => {
  const text = readSsoText(value)
  if (text == null) throw new Error(`SSO provider ${field} is required.`)
  return text
}

const readBoolean = (body: Record<string, unknown>, field: string, fallback: boolean) => {
  if (!hasOwn(body, field)) return fallback
  if (typeof body[field] !== 'boolean') throw new Error(`SSO provider ${field} must be a boolean.`)
  return body[field]
}

const readProviderType = (value: unknown, fallback: RelaySsoProvider['type']) => {
  const type = readSsoText(value)?.toLowerCase()
  if (type == null) return fallback
  if (ssoProviderTypes.has(type as RelaySsoProvider['type'])) return type as RelaySsoProvider['type']
  throw new Error('SSO provider type must be "oidc" or "oauth2".')
}

const readHttpUrl = (value: unknown, field: string) => {
  const text = requireText(value, field)
  try {
    const url = new URL(text)
    if (url.protocol === 'http:' || url.protocol === 'https:') return text
  } catch {
    // Fall through to the uniform validation error below.
  }
  throw new Error(`SSO provider ${field} must be an http or https URL.`)
}

const readPatchHttpUrl = (body: Record<string, unknown>, field: string, fallback: string) => (
  hasOwn(body, field) ? readHttpUrl(body[field], field) : fallback
)

const readPatchText = (body: Record<string, unknown>, field: string, fallback: string) => (
  hasOwn(body, field) ? requireText(body[field], field) : fallback
)

const assertProviderIdAvailable = (id: string, existingIds: ReadonlySet<string>) => {
  if (existingIds.has(id)) throw new Error(`SSO provider "${id}" already exists.`)
}

export const redactSsoProvider = (provider: RelaySsoProvider): RelayAdminSsoProvider => ({
  id: provider.id,
  name: provider.name,
  type: provider.type,
  authorizationUrl: provider.authorizationUrl,
  tokenUrl: provider.tokenUrl,
  userInfoUrl: provider.userInfoUrl,
  scope: provider.scope,
  enabled: provider.enabled,
  clientId: provider.clientId,
  clientSecret: provider.clientSecret === '' ? null : SSO_CLIENT_SECRET_REDACTION,
  createdAt: provider.createdAt,
  updatedAt: provider.updatedAt ?? null
})

export const createSsoProviderFromBody = (
  body: Record<string, unknown>,
  existingIds: ReadonlySet<string>
): RelaySsoProvider => {
  const id = normalizeSsoProviderId(body.id, 'SSO provider id')
  assertProviderIdAvailable(id, existingIds)
  const clientSecret = requireText(body.clientSecret, 'clientSecret')
  if (clientSecret === SSO_CLIENT_SECRET_REDACTION) {
    throw new Error('SSO provider clientSecret must be provided when creating a provider.')
  }
  return {
    id,
    name: requireText(body.name, 'name'),
    type: readProviderType(body.type, 'oidc'),
    authorizationUrl: readHttpUrl(body.authorizationUrl, 'authorizationUrl'),
    tokenUrl: readHttpUrl(body.tokenUrl, 'tokenUrl'),
    userInfoUrl: readHttpUrl(body.userInfoUrl, 'userInfoUrl'),
    scope: readSsoText(body.scope) ?? DEFAULT_SSO_SCOPE,
    enabled: readBoolean(body, 'enabled', true),
    clientId: requireText(body.clientId, 'clientId'),
    clientSecret,
    createdAt: now()
  }
}

export const updateSsoProviderFromBody = (
  provider: RelaySsoProvider,
  body: Record<string, unknown>
): RelaySsoProvider => {
  if (hasOwn(body, 'id')) {
    const id = normalizeSsoProviderId(body.id, 'SSO provider id')
    if (id !== provider.id) throw new Error('SSO provider id cannot be changed.')
  }
  const clientSecret = readSsoText(body.clientSecret)
  return {
    ...provider,
    name: readPatchText(body, 'name', provider.name),
    type: readProviderType(body.type, provider.type),
    authorizationUrl: readPatchHttpUrl(body, 'authorizationUrl', provider.authorizationUrl),
    tokenUrl: readPatchHttpUrl(body, 'tokenUrl', provider.tokenUrl),
    userInfoUrl: readPatchHttpUrl(body, 'userInfoUrl', provider.userInfoUrl),
    scope: readSsoText(body.scope) ?? provider.scope,
    enabled: readBoolean(body, 'enabled', provider.enabled),
    clientId: readPatchText(body, 'clientId', provider.clientId),
    clientSecret: clientSecret == null || clientSecret === SSO_CLIENT_SECRET_REDACTION
      ? provider.clientSecret
      : clientSecret,
    updatedAt: now()
  }
}
