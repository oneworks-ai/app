import type { IncomingMessage, ServerResponse } from 'node:http'

import { InviteLoginError, upsertInviteLoginUser } from '../auth/invite-login.js'
import { PasswordValidationError, hashPassword } from '../auth/passwords.js'
import { createSession, pruneExpiredAuth, publicUser } from '../auth/sessions.js'
import { readRequestBody, sendJson } from '../http.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayServerArgs, RelayStore } from '../types.js'
import { recordLoginNotificationMessage } from './team-invitations.js'

const cleanString = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const cleanEmail = (value: unknown) => cleanString(value).toLowerCase()

const looksLikeEmail = (value: string) => {
  const at = value.indexOf('@')
  const dot = value.lastIndexOf('.')
  return at > 0 && dot > at + 1 && dot < value.length - 1 && !/\s/.test(value)
}

const inviteCodeFromBody = (body: Record<string, unknown>) => (
  cleanString(body.inviteCode) || cleanString(body.invite_code) || cleanString(body.code)
)

const passwordFromBody = (body: Record<string, unknown>) => (
  typeof body.password === 'string' && body.password !== '' ? body.password : undefined
)

export const handleInviteLoginRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url: URL
) => {
  if (url.pathname !== '/api/auth/invite-login') return false
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
    return true
  }

  pruneExpiredAuth(store)
  const body = await readRequestBody(req)
  const email = cleanEmail(body.email)
  const inviteCode = inviteCodeFromBody(body)
  if (!looksLikeEmail(email)) {
    sendJson(res, 400, { error: 'Email required.' }, args.allowOrigin)
    return true
  }
  if (inviteCode === '') {
    sendJson(res, 400, { error: 'Invite required.' }, args.allowOrigin)
    return true
  }

  try {
    const password = passwordFromBody(body)
    const passwordHash = password == null ? undefined : await hashPassword(password)
    const user = upsertInviteLoginUser(store, {
      email,
      inviteCode,
      name: cleanString(body.name) || undefined,
      passwordHash
    })
    const session = createSession(store, user.id, args.sessionTtlMs)
    recordLoginNotificationMessage(req, store, user)
    await storeRepository.write(store)
    sendJson(res, 200, { token: session.token, user: publicUser(user) }, args.allowOrigin)
  } catch (error) {
    const status = error instanceof PasswordValidationError
      ? 400
      : error instanceof InviteLoginError
      ? error.status
      : 500
    const message = error instanceof Error ? error.message : String(error)
    sendJson(res, status, { error: message }, args.allowOrigin)
  }
  return true
}
