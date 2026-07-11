import type { IncomingMessage } from 'node:http'

import type { RelayServerArgs } from '../types.js'
import { publicRequestBaseUrl } from './request-origin.js'

const configuredWebOrigin = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined
  } catch {
    return undefined
  }
}

const isOneWorksCallback = (url: URL) => (
  (url.protocol === 'oneworks:' || url.protocol === 'one-works:') &&
  url.hostname === 'relay' &&
  url.pathname === '/auth'
)

export const isSupportedLoginRedirectUri = (value: string, args: RelayServerArgs) => {
  try {
    const url = new URL(value)
    if (isOneWorksCallback(url)) return true
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    if (args.loginRedirectOrigins?.includes(url.origin) === true) return true
    const allowedOrigin = configuredWebOrigin(args.allowOrigin)
    if (allowedOrigin != null) return url.origin === allowedOrigin
    return false
  } catch {
    return false
  }
}

export const isSupportedOAuthRedirectUri = (
  value: string,
  req: IncomingMessage,
  args: RelayServerArgs
) => {
  if (isSupportedLoginRedirectUri(value, args)) return true
  try {
    const url = new URL(value)
    const relayBaseUrl = new URL(publicRequestBaseUrl(req, args.publicBaseUrl))
    if (url.origin !== relayBaseUrl.origin || url.pathname !== '/login/complete') return false
    return isSupportedLoginRedirectUri(url.searchParams.get('redirect_uri') ?? '', args)
  } catch {
    return false
  }
}

const withRelayResult = (
  redirectUri: string,
  key: 'relay_error' | 'relay_token',
  value: string,
  req: IncomingMessage,
  args: RelayServerArgs
) => {
  if (!isSupportedOAuthRedirectUri(redirectUri, req, args)) {
    throw new Error('Unsupported OAuth redirect URI.')
  }
  const url = new URL(redirectUri)
  url.hash = new URLSearchParams({ [key]: value }).toString()
  return url.toString()
}

export const withRelayLoginToken = (
  redirectUri: string,
  token: string,
  req: IncomingMessage,
  args: RelayServerArgs
) => withRelayResult(redirectUri, 'relay_token', token, req, args)

export const withRelayLoginError = (
  redirectUri: string,
  message: string,
  req: IncomingMessage,
  args: RelayServerArgs
) => withRelayResult(redirectUri, 'relay_error', message, req, args)
