import { createHash, randomUUID } from 'node:crypto'

import type { RelayAccessToken, RelayStore } from '../types.js'
import { createToken, now } from '../utils.js'

export interface PublicRelayAccessToken {
  id: string
  name: string
  tokenPreview: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

const accessTokenPrefix = 'owrt_'

const cleanString = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const hashAccessToken = (token: string) => `sha256:${createHash('sha256').update(token).digest('base64url')}`

const previewAccessToken = (token: string) => `${token.slice(0, 10)}********${token.slice(-6)}`

export const createRelayAccessToken = (
  store: RelayStore,
  input: {
    name?: unknown
    userId: string
  }
) => {
  const token = `${accessTokenPrefix}${createToken()}`
  const timestamp = now()
  const accessToken: RelayAccessToken = {
    id: randomUUID(),
    userId: input.userId,
    name: cleanString(input.name) || 'System access token',
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
