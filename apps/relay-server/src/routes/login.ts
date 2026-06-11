import type { IncomingMessage, ServerResponse } from 'node:http'

import { relayAuthProviderSummaries } from '../auth/sso-provider-registry.js'
import { sendHtml } from '../http.js'
import type { RelayServerArgs, RelayStore } from '../types.js'
import { renderRelayLoginCompletePage, renderRelayLoginPage } from './login-page.js'

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
      args.allowOrigin
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
      args.allowOrigin
    )
    return true
  }

  return false
}
