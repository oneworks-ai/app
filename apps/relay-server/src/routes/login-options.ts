import type { IncomingMessage, ServerResponse } from 'node:http'

import { relayAuthProviderSummaries } from '../auth/sso-provider-registry.js'
import { sendJson } from '../http.js'
import type { RelayServerArgs, RelayStore } from '../types.js'
import { buildRelayLoginPageClientConfig } from './login-page.js'

export const handleAuthProviders = (res: ServerResponse, args: RelayServerArgs, store: RelayStore) => {
  sendJson(res, 200, {
    providers: relayAuthProviderSummaries(args, store)
  }, args.allowOrigin)
}

export const handleLoginOptions = (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  url: URL
) => {
  const config = buildRelayLoginPageClientConfig(
    {
      args,
      providers: relayAuthProviderSummaries(args, store),
      req,
      url
    },
    { nativeClient: true }
  )
  if (config == null) {
    sendJson(res, 400, { error: 'Unsupported login redirect URI.' }, args.allowOrigin, {
      'cache-control': 'no-store'
    })
    return
  }
  sendJson(res, 200, config, args.allowOrigin, { 'cache-control': 'no-store' })
}
