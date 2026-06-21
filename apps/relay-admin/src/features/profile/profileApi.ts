import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser'

import { requestJson } from '../../shared/api/requestJson'

export type RelayProfileAccessTokenScope = 'platform' | 'team' | 'user'

export interface RelayProfileAccessToken {
  id: string
  name: string
  permissionGroupIds: string[]
  permissionGroupMode: 'all' | 'custom'
  scope: RelayProfileAccessTokenScope
  teamId: string | null
  tokenPreview: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

export interface RelayProfileSecuritySummary {
  accessTokens: RelayProfileAccessToken[]
  accountDeletion: {
    available: boolean
  }
  password: {
    enabled: boolean
  }
  passkeys: {
    count: number
    enabled: boolean
    lastUsedAt: string | null
  }
  twoFactor: {
    available: boolean
    enabled: boolean
  }
}

export interface RelayProfileOpenApiAuditEvent {
  id: string
  tokenId: string
  tokenPreview: string
  userId: string
  method: string
  path: string
  status: number
  ip: string | null
  userAgent: string | null
  permission: string | null
  error: string | null
  createdAt: string
}

export interface RelayProfileOpenApiAuditFilters {
  from?: string
  key?: string
  path?: string
  status?: string
  to?: string
}

export interface RelayProfileAccessTokenCreateResponse {
  accessToken: string
  token: RelayProfileAccessToken
}

export interface RelayProfileAccessTokenGrantInput {
  name?: string
  permissionGroupIds?: string[]
  permissionGroupMode: 'all' | 'custom'
  scope: RelayProfileAccessTokenScope
  teamId?: string
}

export interface RelayProfilePasskeyOptionsResponse {
  options: PublicKeyCredentialCreationOptionsJSON
}

export const fetchRelayProfileSecurity = async (token: string) =>
  await requestJson<RelayProfileSecuritySummary>(token, '/api/profile/security')

export const deleteRelayProfileAccount = async (token: string) =>
  await requestJson<{ deleted: boolean; userId: string }>(token, '/api/profile/account', {
    method: 'DELETE'
  })

export const fetchRelayProfileOpenApiAuditEvents = async (
  token: string,
  filters: RelayProfileOpenApiAuditFilters = {}
) => {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    const normalized = value?.trim()
    if (normalized != null && normalized !== '') params.set(key, normalized)
  })
  const query = params.toString()
  return await requestJson<{ events: RelayProfileOpenApiAuditEvent[] }>(
    token,
    `/api/profile/openapi-audit${query === '' ? '' : `?${query}`}`
  )
}

export const createRelayProfileAccessToken = async (token: string, input: RelayProfileAccessTokenGrantInput) =>
  await requestJson<RelayProfileAccessTokenCreateResponse>(token, '/api/profile/access-tokens', {
    method: 'POST',
    body: JSON.stringify(input)
  })

export const updateRelayProfileAccessToken = async (
  token: string,
  tokenId: string,
  input: RelayProfileAccessTokenGrantInput
) =>
  await requestJson<{ token: RelayProfileAccessToken }>(
    token,
    `/api/profile/access-tokens/${encodeURIComponent(tokenId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input)
    }
  )

export const revokeRelayProfileAccessToken = async (token: string, tokenId: string) =>
  await requestJson<{ revoked: boolean; token: RelayProfileAccessToken }>(
    token,
    `/api/profile/access-tokens/${encodeURIComponent(tokenId)}`,
    {
      method: 'DELETE'
    }
  )

export const changeRelayProfilePassword = async (
  token: string,
  input: {
    currentPassword?: string
    password: string
  }
) =>
  await requestJson<{ password: { enabled: boolean } }>(token, '/api/profile/password', {
    method: 'POST',
    body: JSON.stringify(input)
  })

export const createRelayProfilePasskeyOptions = async (token: string) =>
  await requestJson<RelayProfilePasskeyOptionsResponse>(token, '/api/profile/passkeys/register/options', {
    method: 'POST',
    body: JSON.stringify({})
  })

export const verifyRelayProfilePasskey = async (
  token: string,
  input: {
    credentialName?: string
    response: unknown
  }
) =>
  await requestJson<{ passkeys: RelayProfileSecuritySummary['passkeys'] }>(
    token,
    '/api/profile/passkeys/register/verify',
    {
      method: 'POST',
      body: JSON.stringify(input)
    }
  )
