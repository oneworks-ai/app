import process from 'node:process'

import { DEFAULT_SSO_SCOPE, normalizeSsoProviderId, readSsoText } from './auth/sso-provider-metadata.js'
import type { RelayOAuthClient } from './types.js'

interface CustomSsoClient {
  client: RelayOAuthClient
  id: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const requireString = (value: unknown, field: string) => {
  const text = readSsoText(value)
  if (text == null) throw new Error(`ONEWORKS_RELAY_SSO_PROVIDERS entry is missing "${field}".`)
  return text
}

const normalizeCustomSsoClient = (id: unknown, value: unknown): CustomSsoClient => {
  if (!isRecord(value)) throw new Error('ONEWORKS_RELAY_SSO_PROVIDERS entries must be objects.')
  const providerId = normalizeSsoProviderId(readSsoText(value.id) ?? id, 'ONEWORKS_RELAY_SSO_PROVIDERS entry')
  const clientId = readSsoText(value.clientId)
  const clientSecret = readSsoText(value.clientSecret)
  const authorizationUrl = readSsoText(value.authorizationUrl)
  const tokenUrl = readSsoText(value.tokenUrl)
  const userInfoUrl = readSsoText(value.userInfoUrl)
  return {
    id: providerId,
    client: {
      authorizationUrl: authorizationUrl ?? requireString(value.authorizationUrl, 'authorizationUrl'),
      clientId: clientId ?? requireString(value.clientId, 'clientId'),
      clientSecret: clientSecret ?? requireString(value.clientSecret, 'clientSecret'),
      displayName: readSsoText(value.name) ?? readSsoText(value.displayName) ?? providerId,
      id: providerId,
      scope: readSsoText(value.scope) ?? DEFAULT_SSO_SCOPE,
      tokenUrl: tokenUrl ?? requireString(value.tokenUrl, 'tokenUrl'),
      userInfoUrl: userInfoUrl ?? requireString(value.userInfoUrl, 'userInfoUrl')
    }
  }
}

export const readCustomSsoClients = () => {
  const raw = process.env.ONEWORKS_RELAY_SSO_PROVIDERS
  if (raw == null || raw.trim() === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new Error('ONEWORKS_RELAY_SSO_PROVIDERS must contain valid JSON.')
  }
  const clients = Array.isArray(parsed)
    ? parsed.map(item => normalizeCustomSsoClient(undefined, item))
    : isRecord(parsed)
    ? Object.entries(parsed).map(([id, item]) => normalizeCustomSsoClient(id, item))
    : undefined
  if (clients == null) {
    throw new Error('ONEWORKS_RELAY_SSO_PROVIDERS must be a JSON object or array.')
  }
  const seen = new Set<string>()
  for (const client of clients) {
    if (seen.has(client.id)) throw new Error(`ONEWORKS_RELAY_SSO_PROVIDERS includes duplicate provider "${client.id}".`)
    seen.add(client.id)
  }
  return clients
}
