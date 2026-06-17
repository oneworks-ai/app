import type { IncomingMessage, ServerResponse } from 'node:http'

import { verifyPassword } from '../auth/passwords.js'
import { createSession, pruneExpiredAuth, publicUser } from '../auth/sessions.js'
import { readRequestBody, sendJson } from '../http.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayServerArgs, RelayStore } from '../types.js'
import { recordLoginNotificationMessage } from './team-invitations.js'

const cleanString = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const passwordFromBody = (body: Record<string, unknown>) => (
  typeof body.password === 'string' ? body.password : ''
)

export const handlePasswordLoginRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
) => {
  if (req.method !== 'POST' || url.pathname !== '/api/auth/password-login') return false
  pruneExpiredAuth(store)
  const body = await readRequestBody(req)
  const email = cleanString(body.email).toLowerCase()
  const password = passwordFromBody(body)
  if (email === '' || password === '') {
    sendJson(res, 400, { error: 'Email and password are required.' }, args.allowOrigin)
    return true
  }

  const user = store.users.find(item => item.email.toLowerCase() === email)
  if (user == null || user.disabledAt != null || !(await verifyPassword(password, user.passwordHash))) {
    sendJson(res, 401, { error: 'Invalid email or password.' }, args.allowOrigin)
    return true
  }

  const session = createSession(store, user.id, args.sessionTtlMs)
  recordLoginNotificationMessage(req, store, user)
  await storeRepository.write(store)
  sendJson(res, 200, { token: session.token, user: publicUser(user) }, args.allowOrigin)
  return true
}
