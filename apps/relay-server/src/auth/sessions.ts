import type { IncomingMessage } from 'node:http'

import { getBearerToken } from '../http.js'
import type { RelaySession, RelayStore, RelayUser } from '../types.js'
import { createToken, now } from '../utils.js'

export const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export const createSession = (store: RelayStore, userId: string, ttlMs = DEFAULT_SESSION_TTL_MS) => {
  const timestamp = now()
  const session: RelaySession = {
    token: createToken(),
    userId,
    createdAt: timestamp,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    lastSeenAt: timestamp
  }
  store.sessions.push(session)
  return session
}

export const pruneExpiredAuth = (store: RelayStore) => {
  const nowMs = Date.now()
  store.oauthStates = store.oauthStates.filter(state => Date.parse(state.expiresAt) > nowMs)
  store.sessions = store.sessions.filter(session => Date.parse(session.expiresAt) > nowMs)
}

export const resolveSession = (req: IncomingMessage, store: RelayStore) => {
  const token = getBearerToken(req)
  if (token === '') return undefined
  const session = store.sessions.find(item => item.token === token)
  if (session == null || Date.parse(session.expiresAt) <= Date.now()) return undefined
  const user = store.users.find(item => item.id === session.userId)
  if (user == null || user.disabledAt != null) return undefined
  session.lastSeenAt = now()
  return { session, user }
}

export const publicUser = (user: RelayUser) => ({
  id: user.id,
  email: user.email,
  loginId: user.loginId,
  name: user.name,
  avatarUrl: user.avatarUrl,
  disabledAt: user.disabledAt,
  provider: user.provider,
  role: user.role
})
