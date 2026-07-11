import type { IncomingMessage, ServerResponse } from 'node:http'

import { buildOAuthAuthorizeUrl, fetchOAuthProfile } from '../auth/providers.js'
import { createSession, pruneExpiredAuth, publicUser, resolveSession } from '../auth/sessions.js'
import { resolveOAuthClient } from '../auth/sso-provider-registry.js'
import { upsertOAuthUser } from '../auth/users.js'
import { getBearerToken, redirect, sendJson } from '../http.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayServerArgs, RelayStore } from '../types.js'
import { createToken, now } from '../utils.js'
import { handleAuthProviders, handleLoginOptions } from './login-options.js'
import { isSupportedOAuthRedirectUri, withRelayLoginError, withRelayLoginToken } from './login-redirect.js'
import { publicRequestBaseUrl } from './request-origin.js'
import { recordLoginNotificationMessage } from './team-invitations.js'

const callbackUrl = (req: IncomingMessage, args: RelayServerArgs, provider: string) => {
  const base = publicRequestBaseUrl(req, args.publicBaseUrl)
  return `${base}/api/auth/oauth/${provider}/callback`
}

const handleStart = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  provider: string,
  url: URL
) => {
  const client = resolveOAuthClient(args, store, provider)
  if (client == null) {
    sendJson(res, 404, { error: `OAuth provider "${provider}" is not configured.` }, args.allowOrigin)
    return
  }
  const redirectUri = url.searchParams.get('redirect_uri')?.trim() || undefined
  if (redirectUri != null && !isSupportedOAuthRedirectUri(redirectUri, req, args)) {
    sendJson(res, 400, { error: 'Unsupported OAuth redirect URI.' }, args.allowOrigin)
    return
  }
  const state = createToken()
  store.oauthStates.push({
    state,
    provider,
    redirectUri,
    inviteCode: url.searchParams.get('invite_code') ?? undefined,
    createdAt: now(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  })
  await storeRepository.write(store)
  redirect(
    res,
    buildOAuthAuthorizeUrl({
      client,
      loginHint: url.searchParams.get('login_hint') ?? undefined,
      prompt: url.searchParams.get('prompt') ?? undefined,
      provider,
      redirectUri: callbackUrl(req, args, provider),
      state
    }),
    args.allowOrigin
  )
}

const handleCallback = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  provider: string,
  url: URL
) => {
  const code = url.searchParams.get('code') ?? ''
  const stateToken = url.searchParams.get('state') ?? ''
  const client = resolveOAuthClient(args, store, provider)
  const state = store.oauthStates.find(item => item.state === stateToken && item.provider === provider)
  store.oauthStates = store.oauthStates.filter(item => item.state !== stateToken)
  if (client == null || state == null || Date.parse(state.expiresAt) <= Date.now() || code === '') {
    await storeRepository.write(store)
    sendJson(res, 400, { error: 'Invalid OAuth callback.' }, args.allowOrigin)
    return
  }

  try {
    const profile = await fetchOAuthProfile({
      client,
      code,
      provider,
      redirectUri: callbackUrl(req, args, provider)
    })
    const user = upsertOAuthUser(store, { ...profile, provider }, state.inviteCode)
    const session = createSession(store, user.id, args.sessionTtlMs)
    recordLoginNotificationMessage(req, store, user)
    await storeRepository.write(store)
    if (state.redirectUri != null) {
      redirect(res, withRelayLoginToken(state.redirectUri, session.token, req, args), args.allowOrigin)
      return
    }
    sendJson(res, 200, { token: session.token, user: publicUser(user) }, args.allowOrigin)
  } catch (error) {
    await storeRepository.write(store)
    const message = error instanceof Error ? error.message : String(error)
    if (state.redirectUri != null) {
      try {
        redirect(res, withRelayLoginError(state.redirectUri, message, req, args), args.allowOrigin)
        return
      } catch {}
    }
    sendJson(res, 403, { error: message }, args.allowOrigin)
  }
}

const handleMe = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository
) => {
  const auth = resolveSession(req, store)
  if (auth == null) {
    sendJson(res, 401, { error: 'Authentication required.' }, args.allowOrigin)
    return
  }
  await storeRepository.write(store)
  sendJson(res, 200, {
    session: {
      expiresAt: auth.session.expiresAt,
      lastSeenAt: auth.session.lastSeenAt
    },
    user: publicUser(auth.user)
  }, args.allowOrigin)
}

const handleLogout = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository
) => {
  const token = getBearerToken(req)
  store.sessions = store.sessions.filter(session => session.token !== token)
  await storeRepository.write(store)
  sendJson(res, 200, { ok: true }, args.allowOrigin)
}

export const handleAuthRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url: URL
) => {
  pruneExpiredAuth(store)
  if (req.method === 'GET' && url.pathname === '/api/auth/providers') {
    handleAuthProviders(res, args, store)
    return true
  }
  if (req.method === 'GET' && url.pathname === '/api/auth/login-options') {
    handleLoginOptions(req, res, args, store, url)
    return true
  }
  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    await handleMe(req, res, args, store, storeRepository)
    return true
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    await handleLogout(req, res, args, store, storeRepository)
    return true
  }

  const match = /^\/api\/auth\/oauth\/([^/]+)\/(start|callback)$/.exec(url.pathname)
  if (match == null) return false
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
    return true
  }
  if (match[2] === 'start') {
    await handleStart(req, res, args, store, storeRepository, match[1], url)
  } else {
    await handleCallback(req, res, args, store, storeRepository, match[1], url)
  }
  return true
}
