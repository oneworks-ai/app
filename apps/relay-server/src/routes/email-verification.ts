import type { IncomingMessage, ServerResponse } from 'node:http'

import { domainFromEmail, looksLikeEmailAddress, normalizeEmailAddress } from '../email/domains.js'
import { prepareRelayEmailChallengeSend, rememberRelayEmailProviderResult } from '../email/policy.js'
import { RelayEmailProviderUnavailableError, resolveRelayEmailProvider } from '../email/provider.js'
import { verifyRelayTurnstile } from '../email/turnstile.js'
import { readRequestBody, sendJson } from '../http.js'
import { requestIp } from '../security/request.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayEmailProvider, RelayEmailPurpose, RelayLocale, RelayServerArgs, RelayStore } from '../types.js'
import { normalizeRelayLoginLocale, parseAcceptLanguage } from './login-page-i18n.js'

const relayEmailPurposes = new Set<RelayEmailPurpose>([
  'email-verification',
  'invite',
  'login'
])

const cleanString = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const purposeFromBody = (value: unknown): RelayEmailPurpose => (
  typeof value === 'string' && relayEmailPurposes.has(value as RelayEmailPurpose)
    ? value as RelayEmailPurpose
    : 'email-verification'
)

const localeFromBody = (body: Record<string, unknown>) => (
  normalizeRelayLoginLocale(cleanString(body.locale)) ??
    normalizeRelayLoginLocale(cleanString(body.lang)) ??
    normalizeRelayLoginLocale(cleanString(body.language))
)

const resolveEmailLocale = (req: IncomingMessage, body: Record<string, unknown>): RelayLocale => {
  const bodyLocale = localeFromBody(body)
  if (bodyLocale != null) return bodyLocale
  for (const language of parseAcceptLanguage(req.headers['accept-language'])) {
    const locale = normalizeRelayLoginLocale(language)
    if (locale != null) return locale
  }
  return 'en'
}

const turnstileTokenFromBody = (body: Record<string, unknown>) => (
  cleanString(body.turnstileToken) ||
  cleanString(body.turnstile_token) ||
  cleanString(body.cfTurnstileResponse)
)

const sendEmailUnavailable = (
  res: ServerResponse,
  args: RelayServerArgs
) => {
  sendJson(res, 503, {
    code: 'email_send_unavailable',
    error: 'Unable to send email right now.'
  }, args.allowOrigin)
}

const sendEmailRejected = (
  res: ServerResponse,
  args: RelayServerArgs,
  input: {
    retryAfterSeconds?: number
    status?: number
  } = {}
) => {
  const status = input.status ?? 400
  const headers: Record<string, string> = {
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-origin': args.allowOrigin,
    'content-type': 'application/json; charset=utf-8'
  }
  if (input.retryAfterSeconds != null) headers['retry-after'] = String(input.retryAfterSeconds)
  res.writeHead(status, headers)
  res.end(`${
    JSON.stringify({
      code: 'email_send_rejected',
      error: 'Unable to send email right now.'
    })
  }\n`)
}

export const handleEmailVerificationSendRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url: URL
) => {
  if (url.pathname !== '/api/auth/email-verification/send') return false
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
    return true
  }
  if (args.email == null) {
    sendEmailUnavailable(res, args)
    return true
  }

  const body = await readRequestBody(req)
  const email = normalizeEmailAddress(body.email)
  if (!looksLikeEmailAddress(email) || domainFromEmail(email) === '') {
    sendJson(res, 400, {
      code: 'email_required',
      error: 'Email required.'
    }, args.allowOrigin)
    return true
  }

  let provider: RelayEmailProvider
  try {
    provider = resolveRelayEmailProvider(args)
  } catch (error) {
    if (error instanceof RelayEmailProviderUnavailableError) {
      sendEmailUnavailable(res, args)
      return true
    }
    throw error
  }

  const ip = requestIp(req)
  const turnstile = await verifyRelayTurnstile(args.email, {
    ip,
    token: turnstileTokenFromBody(body)
  })
  if (!turnstile.allowed) {
    if (turnstile.code === 'turnstile_not_configured') {
      sendEmailUnavailable(res, args)
      return true
    }
    sendEmailRejected(res, args, { status: turnstile.status })
    return true
  }

  const purpose = purposeFromBody(body.purpose)
  const locale = resolveEmailLocale(req, body)
  const decision = prepareRelayEmailChallengeSend(store, args.email, {
    email,
    ip,
    purpose
  })
  if (!decision.allowed) {
    sendEmailRejected(res, args, {
      retryAfterSeconds: decision.retryAfterSeconds,
      status: decision.code === 'domain_rejected' ? 400 : 429
    })
    return true
  }
  if (decision.reused) {
    await storeRepository.write(store)
    sendJson(res, 200, { ok: true }, args.allowOrigin)
    return true
  }

  try {
    const result = await provider.sendVerificationCode({
      code: decision.code ?? '',
      email,
      expiresAt: decision.challenge.expiresAt,
      locale,
      purpose
    })
    rememberRelayEmailProviderResult(store, decision.challenge.id, result.messageId)
    await storeRepository.write(store)
    sendJson(res, 200, { ok: true }, args.allowOrigin)
  } catch {
    await storeRepository.write(store)
    sendEmailRejected(res, args, { status: 502 })
  }
  return true
}
