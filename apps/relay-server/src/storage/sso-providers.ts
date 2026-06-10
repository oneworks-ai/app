import {
  DEFAULT_SSO_SCOPE,
  cleanSsoProviderId,
  normalizeSsoProviderType,
  readSsoText
} from '../auth/sso-provider-metadata.js'
import type { RelaySsoProvider } from '../types.js'
import { isRecord, now } from '../utils.js'

export const normalizeRelaySsoProvider = (value: Record<string, unknown>): RelaySsoProvider | undefined => {
  const id = cleanSsoProviderId(value.id)
  if (id == null) return undefined
  return {
    id,
    name: readSsoText(value.name) ?? id,
    type: normalizeSsoProviderType(value.type),
    authorizationUrl: readSsoText(value.authorizationUrl) ?? '',
    tokenUrl: readSsoText(value.tokenUrl) ?? '',
    userInfoUrl: readSsoText(value.userInfoUrl) ?? '',
    scope: readSsoText(value.scope) ?? DEFAULT_SSO_SCOPE,
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    clientId: readSsoText(value.clientId) ?? '',
    clientSecret: readSsoText(value.clientSecret) ?? '',
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined
  }
}

export const normalizeRelaySsoProviders = (value: unknown) => (
  Array.isArray(value)
    ? value
      .filter(isRecord)
      .map(normalizeRelaySsoProvider)
      .filter((provider): provider is RelaySsoProvider => provider != null)
    : []
)
