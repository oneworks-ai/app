import { createHash, randomUUID } from 'node:crypto'

import type { RelayAccessToken, RelayAccessTokenScope, RelayStore } from '../types.js'
import { createToken, now } from '../utils.js'

export interface PublicRelayAccessToken {
  id: string
  name: string
  permissionGroupIds: string[]
  permissionGroupMode: 'all' | 'custom'
  scope: RelayAccessTokenScope
  teamId: string | null
  tokenPreview: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

const accessTokenPrefix = 'owrt_'

const cleanString = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const normalizePermissionGroupIds = (value: unknown) => (
  Array.isArray(value)
    ? [...new Set(value.map(cleanString).filter((item): item is string => item !== ''))]
    : []
)

const normalizeAccessTokenScope = (value: unknown): RelayAccessTokenScope => {
  if (value === 'team' || value === 'user') return value
  return 'platform'
}

const normalizePermissionGrant = (input: { permissionGroupIds?: unknown; permissionGroupMode?: unknown }) => {
  const permissionGroupMode: RelayAccessToken['permissionGroupMode'] = input.permissionGroupMode === 'custom'
    ? 'custom'
    : 'all'
  return {
    permissionGroupIds: permissionGroupMode === 'custom' ? normalizePermissionGroupIds(input.permissionGroupIds) : [],
    permissionGroupMode
  }
}

const hashAccessToken = (token: string) => `sha256:${createHash('sha256').update(token).digest('base64url')}`

const previewAccessToken = (token: string) => `${token.slice(0, 10)}********${token.slice(-6)}`

export const createRelayAccessToken = (
  store: RelayStore,
  input: {
    name?: unknown
    permissionGroupIds?: unknown
    permissionGroupMode?: unknown
    scope?: unknown
    teamId?: unknown
    userId: string
  }
) => {
  const token = `${accessTokenPrefix}${createToken()}`
  const timestamp = now()
  const permissionGrant = normalizePermissionGrant(input)
  const scope = normalizeAccessTokenScope(input.scope)
  const accessToken: RelayAccessToken = {
    id: randomUUID(),
    userId: input.userId,
    name: cleanString(input.name) || 'API access token',
    ...permissionGrant,
    scope,
    teamId: scope === 'team' ? cleanString(input.teamId) : undefined,
    tokenHash: hashAccessToken(token),
    tokenPreview: previewAccessToken(token),
    createdAt: timestamp
  }
  store.accessTokens.push(accessToken)
  return {
    accessToken,
    token
  }
}

export const publicRelayAccessToken = (accessToken: RelayAccessToken): PublicRelayAccessToken => ({
  id: accessToken.id,
  name: accessToken.name,
  permissionGroupIds: accessToken.permissionGroupIds ?? [],
  permissionGroupMode: accessToken.permissionGroupMode ?? 'all',
  scope: accessToken.scope ?? 'platform',
  teamId: accessToken.teamId ?? null,
  tokenPreview: accessToken.tokenPreview,
  createdAt: accessToken.createdAt,
  lastUsedAt: accessToken.lastUsedAt ?? null,
  revokedAt: accessToken.revokedAt ?? null
})

export const listPublicRelayAccessTokens = (store: RelayStore, userId: string) =>
  store.accessTokens
    .filter(accessToken => accessToken.userId === userId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map(publicRelayAccessToken)

export const resolveRelayAccessToken = (store: RelayStore, token: string) => {
  if (!token.startsWith(accessTokenPrefix)) return undefined
  const tokenHash = hashAccessToken(token)
  const accessToken = store.accessTokens.find(item => item.tokenHash === tokenHash && item.revokedAt == null)
  if (accessToken == null) return undefined
  const user = store.users.find(item => item.id === accessToken.userId)
  if (user == null || user.disabledAt != null) return undefined
  accessToken.lastUsedAt = now()
  return {
    accessToken,
    user
  }
}

export const revokeRelayAccessToken = (store: RelayStore, input: { tokenId: string; userId: string }) => {
  const accessToken = store.accessTokens.find(item => item.id === input.tokenId && item.userId === input.userId)
  if (accessToken == null) return undefined
  if (accessToken.revokedAt == null) accessToken.revokedAt = now()
  return accessToken
}

export const updateRelayAccessToken = (
  store: RelayStore,
  input: {
    name?: unknown
    permissionGroupIds?: unknown
    permissionGroupMode?: unknown
    scope?: unknown
    teamId?: unknown
    tokenId: string
    userId: string
  }
) => {
  const accessToken = store.accessTokens.find(item => item.id === input.tokenId && item.userId === input.userId)
  if (accessToken == null || accessToken.revokedAt != null) return undefined
  const name = cleanString(input.name)
  accessToken.name = name || accessToken.name
  const scope = normalizeAccessTokenScope(input.scope)
  Object.assign(accessToken, normalizePermissionGrant(input))
  accessToken.scope = scope
  accessToken.teamId = scope === 'team' ? cleanString(input.teamId) : undefined
  return accessToken
}
