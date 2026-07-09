import type { IncomingMessage, ServerResponse } from 'node:http'

import { findEnabledEmailCodeUserByIdentifier } from '../auth/identities.js'
import { loginIdentifierFromBody } from '../auth/login-identifiers.js'
import { createSession, pruneExpiredAuth, publicUser } from '../auth/sessions.js'
import { domainFromEmail, looksLikeEmailAddress, normalizeEmailAddress } from '../email/domains.js'
import { verifyRelayEmailChallengeCode } from '../email/policy.js'
import { readRequestBody, sendJson } from '../http.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayServerArgs, RelayStore } from '../types.js'
import { recordLoginNotificationMessage } from './team-invitations.js'

const cleanString = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const emailCodeFromBody = (body: Record<string, unknown>) => (
  cleanString(body.emailCode) ||
  cleanString(body.verificationCode) ||
  cleanString(body.verification_code) ||
  cleanString(body.code)
)

const sendEmailRequired = (res: ServerResponse, args: RelayServerArgs) => {
  sendJson(res, 400, {
    code: 'email_required',
    error: 'Email required.'
  }, args.allowOrigin)
}

const sendInvalidCode = (res: ServerResponse, args: RelayServerArgs) => {
  sendJson(res, 401, {
    code: 'invalid_email_code',
    error: 'Invalid email or verification code.'
  }, args.allowOrigin)
}

export const handleEmailCodeLoginRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url: URL
) => {
  if (url.pathname !== '/api/auth/email-code-login') return false
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
    return true
  }
  pruneExpiredAuth(store)
  const body = await readRequestBody(req)
  const loginId = loginIdentifierFromBody(body)
  const user = findEnabledEmailCodeUserByIdentifier(store, loginId)
  const email = normalizeEmailAddress(user?.email ?? '')
  if (!looksLikeEmailAddress(email) || domainFromEmail(email) === '') {
    sendEmailRequired(res, args)
    return true
  }
  const code = emailCodeFromBody(body)
  const verification = verifyRelayEmailChallengeCode(store, {
    code,
    email,
    purpose: 'login'
  })
  if (!verification.verified || user == null) {
    sendInvalidCode(res, args)
    return true
  }
  verifyRelayEmailChallengeCode(store, {
    code,
    consume: true,
    email,
    purpose: 'login'
  })
  const session = createSession(store, user.id, args.sessionTtlMs)
  recordLoginNotificationMessage(req, store, user)
  await storeRepository.write(store)
  sendJson(res, 200, {
    token: session.token,
    user: publicUser(user)
  }, args.allowOrigin)
  return true
}
