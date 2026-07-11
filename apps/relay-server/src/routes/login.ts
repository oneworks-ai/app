import type { IncomingMessage, ServerResponse } from 'node:http'

import { relayAuthProviderSummaries } from '../auth/sso-provider-registry.js'
import { sendHtml } from '../http.js'
import type { RelayServerArgs, RelayStore } from '../types.js'
import { renderRelayLoginCompletePage, renderRelayLoginPage } from './login-page.js'
import { isSupportedLoginRedirectUri } from './login-redirect.js'

const loginFrameAncestors = (url: URL, args: RelayServerArgs) => {
  const redirectUri = url.searchParams.get('redirect_uri')?.trim() ?? ''
  try {
    const redirectUrl = new URL(redirectUri)
    if (
      (redirectUrl.protocol === 'http:' || redirectUrl.protocol === 'https:') &&
      isSupportedLoginRedirectUri(redirectUri, args)
    ) {
      return redirectUrl.origin
    }
  } catch {
    // Invalid redirects are rendered as an error page and must not be embeddable.
  }
  return "'none'"
}

const loginHtmlHeaders = (url: URL, args: RelayServerArgs) => ({
  'content-security-policy': `frame-ancestors ${loginFrameAncestors(url, args)}`
})

export const handleLoginRoute = (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  url: URL
) => {
  if (req.method !== 'GET') return false

  if (url.pathname === '/login') {
    sendHtml(
      res,
      200,
      renderRelayLoginPage({
        args,
        providers: relayAuthProviderSummaries(args, store),
        req,
        url
      }),
      args.allowOrigin,
      loginHtmlHeaders(url, args)
    )
    return true
  }

  if (url.pathname === '/login/complete') {
    sendHtml(
      res,
      200,
      renderRelayLoginCompletePage({
        args,
        providers: relayAuthProviderSummaries(args, store),
        req,
        url
      }),
      args.allowOrigin,
      loginHtmlHeaders(url, args)
    )
    return true
  }

  return false
}
