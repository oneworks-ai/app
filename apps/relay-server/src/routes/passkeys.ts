/* eslint-disable max-lines -- Passkey route handlers share body parsing and session finalization. */
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'

import {
  RelayPasskeyError,
  prepareRelayPasskeyAuthentication,
  prepareRelayPasskeyRegistration,
  verifyRelayPasskeyAuthentication,
  verifyRelayPasskeyRegistration
} from '../auth/passkeys.js'
import { createSession, pruneExpiredAuth, publicUser } from '../auth/sessions.js'
import { domainFromEmail, looksLikeEmailAddress, normalizeEmailAddress } from '../email/domains.js'
import { readRequestBody, sendJson } from '../http.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayServerArgs, RelayStore } from '../types.js'
import { recordLoginNotificationMessage } from './team-invitations.js'

const cleanString = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const inviteCodeFromBody = (body: Record<string, unknown>) => (
  cleanString(body.inviteCode) || cleanString(body.invite_code)
)

const emailCodeFromBody = (body: Record<string, unknown>) => (
  cleanString(body.emailCode) ||
  cleanString(body.verificationCode) ||
  cleanString(body.verification_code) ||
  cleanString(body.code)
)

const credentialNameFromBody = (body: Record<string, unknown>) => (
  cleanString(body.credentialName) || cleanString(body.passkeyName) || cleanString(body.name)
)

const responseFromBody = <TResponse>(body: Record<string, unknown>) => (
  body.response != null && typeof body.response === 'object' && !Array.isArray(body.response)
    ? body.response as TResponse
    : undefined
)

const readEmail = (body: Record<string, unknown>) => normalizeEmailAddress(body.email)

const requireEmail = (email: string) => looksLikeEmailAddress(email) && domainFromEmail(email) !== ''

const sendPasskeyError = (res: ServerResponse, args: RelayServerArgs, error: unknown) => {
  if (error instanceof RelayPasskeyError) {
    sendJson(res, error.status, {
      code: error.code,
      error: error.message
    }, args.allowOrigin)
    return
  }
  throw error
}

const sendMethodNotAllowed = (res: ServerResponse, args: RelayServerArgs) => {
  sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
}

const sendEmailRequired = (res: ServerResponse, args: RelayServerArgs) => {
  sendJson(res, 400, {
    code: 'email_required',
    error: 'Email required.'
  }, args.allowOrigin)
}

const sendCredentialRequired = (res: ServerResponse, args: RelayServerArgs) => {
  sendJson(res, 400, {
    code: 'passkey_response_required',
    error: 'Passkey response required.'
  }, args.allowOrigin)
}

const finishWithSession = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  userId: string
) => {
  const session = createSession(store, userId, args.sessionTtlMs)
  const user = store.users.find(item => item.id === userId)
  if (user != null) recordLoginNotificationMessage(req, store, user)
  await storeRepository.write(store)
  sendJson(res, 200, {
    token: session.token,
    user: user == null ? undefined : publicUser(user)
  }, args.allowOrigin)
}

const handleRegisterOptions = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository
) => {
  if (req.method !== 'POST') {
    sendMethodNotAllowed(res, args)
    return
  }
  const body = await readRequestBody(req)
  const email = readEmail(body)
  if (!requireEmail(email)) {
    sendEmailRequired(res, args)
    return
  }
  try {
    const result = await prepareRelayPasskeyRegistration(req, args, store, {
      code: emailCodeFromBody(body),
      email,
      inviteCode: inviteCodeFromBody(body),
      name: cleanString(body.name)
    })
    await storeRepository.write(store)
    sendJson(res, 200, result, args.allowOrigin)
  } catch (error) {
    sendPasskeyError(res, args, error)
  }
}

const handleRegisterVerify = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  body: Record<string, unknown>
) => {
  const email = readEmail(body)
  const response = responseFromBody<RegistrationResponseJSON>(body)
  if (!requireEmail(email)) {
    sendEmailRequired(res, args)
    return
  }
  if (response == null) {
    sendCredentialRequired(res, args)
    return
  }
  try {
    const result = await verifyRelayPasskeyRegistration(args, store, {
      credentialName: credentialNameFromBody(body),
      email,
      response
    })
    await finishWithSession(req, res, args, store, storeRepository, result.tokenUser.id)
  } catch (error) {
    sendPasskeyError(res, args, error)
  }
}

const handleLoginOptions = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository
) => {
  if (req.method !== 'POST') {
    sendMethodNotAllowed(res, args)
    return
  }
  const body = await readRequestBody(req)
  const email = readEmail(body)
  if (!requireEmail(email)) {
    sendEmailRequired(res, args)
    return
  }
  try {
    const result = await prepareRelayPasskeyAuthentication(req, args, store, { email })
    await storeRepository.write(store)
    sendJson(res, 200, result, args.allowOrigin)
  } catch (error) {
    sendPasskeyError(res, args, error)
  }
}

const handleLoginVerify = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  body: Record<string, unknown>
) => {
  const email = readEmail(body)
  const response = responseFromBody<AuthenticationResponseJSON>(body)
  if (!requireEmail(email)) {
    sendEmailRequired(res, args)
    return
  }
  if (response == null) {
    sendCredentialRequired(res, args)
    return
  }
  try {
    const result = await verifyRelayPasskeyAuthentication(args, store, { email, response })
    await finishWithSession(req, res, args, store, storeRepository, result.tokenUser.id)
  } catch (error) {
    sendPasskeyError(res, args, error)
  }
}

export const handlePasskeyRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url: URL
) => {
  if (!url.pathname.startsWith('/api/auth/passkey/')) return false
  pruneExpiredAuth(store)
  if (url.pathname === '/api/auth/passkey/register/options') {
    await handleRegisterOptions(req, res, args, store, storeRepository)
    return true
  }
  if (url.pathname === '/api/auth/passkey/login/options') {
    await handleLoginOptions(req, res, args, store, storeRepository)
    return true
  }
  if (req.method !== 'POST') {
    sendMethodNotAllowed(res, args)
    return true
  }
  const body = await readRequestBody(req)
  if (url.pathname === '/api/auth/passkey/register/verify') {
    await handleRegisterVerify(req, res, args, store, storeRepository, body)
    return true
  }
  if (url.pathname === '/api/auth/passkey/login/verify') {
    await handleLoginVerify(req, res, args, store, storeRepository, body)
    return true
  }
  return false
}
