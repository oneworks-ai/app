import type { RelayOAuthClient, RelaySsoProvider, RelaySsoProviderType } from '../types.js'

export const DEFAULT_SSO_SCOPE = 'openid email profile'
export const SSO_CLIENT_SECRET_REDACTION = '********'
export const SSO_PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

const RESERVED_PROVIDER_IDS = new Set(['github', 'google'])
const ssoProviderTypes = new Set<RelaySsoProviderType>(['oauth2', 'oidc'])

export const readSsoText = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

export const isReservedSsoProviderId = (id: string) => RESERVED_PROVIDER_IDS.has(id)

export const cleanSsoProviderId = (value: unknown) => {
  const id = readSsoText(value)?.toLowerCase()
  if (id == null || !SSO_PROVIDER_ID_PATTERN.test(id) || isReservedSsoProviderId(id)) return undefined
  return id
}

export const normalizeSsoProviderId = (value: unknown, source: string) => {
  const id = readSsoText(value)?.toLowerCase()
  if (id == null || !SSO_PROVIDER_ID_PATTERN.test(id)) {
    throw new Error(`${source} must match ${SSO_PROVIDER_ID_PATTERN.source}.`)
  }
  if (isReservedSsoProviderId(id)) {
    throw new Error(`${source} cannot override built-in provider "${id}".`)
  }
  return id
}

export const normalizeSsoProviderType = (value: unknown): RelaySsoProviderType => (
  typeof value === 'string' && ssoProviderTypes.has(value.toLowerCase() as RelaySsoProviderType)
    ? value.toLowerCase() as RelaySsoProviderType
    : 'oidc'
)

export const relaySsoProviderToOAuthClient = (provider: RelaySsoProvider): RelayOAuthClient | undefined => {
  if (!provider.enabled) return undefined
  if (
    provider.authorizationUrl === '' ||
    provider.clientId === '' ||
    provider.clientSecret === '' ||
    provider.tokenUrl === '' ||
    provider.userInfoUrl === ''
  ) {
    return undefined
  }
  return {
    authorizationUrl: provider.authorizationUrl,
    clientId: provider.clientId,
    clientSecret: provider.clientSecret,
    displayName: provider.name,
    id: provider.id,
    scope: provider.scope,
    tokenUrl: provider.tokenUrl,
    userInfoUrl: provider.userInfoUrl
  }
}
