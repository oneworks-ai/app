import type { RelayOAuthClient, RelayServerArgs, RelayStore } from '../types.js'
import { authProviderSummary, enabledAuthProviders } from './providers.js'
import { relaySsoProviderToOAuthClient } from './sso-provider-metadata.js'

export const resolveOAuthClients = (
  args: Pick<RelayServerArgs, 'oauth'>,
  store: Pick<RelayStore, 'ssoProviders'>
): Record<string, RelayOAuthClient | undefined> => {
  const clients: Record<string, RelayOAuthClient | undefined> = { ...(args.oauth ?? {}) }
  for (const provider of store.ssoProviders) {
    if (clients[provider.id] != null) continue
    clients[provider.id] = relaySsoProviderToOAuthClient(provider)
  }
  return clients
}

export const resolveOAuthClient = (
  args: Pick<RelayServerArgs, 'oauth'>,
  store: Pick<RelayStore, 'ssoProviders'>,
  provider: string
) => resolveOAuthClients(args, store)[provider]

export const enabledRelayAuthProviders = (
  args: Pick<RelayServerArgs, 'oauth'>,
  store: Pick<RelayStore, 'ssoProviders'>
) => enabledAuthProviders(resolveOAuthClients(args, store))

export const relayAuthProviderSummaries = (
  args: Pick<RelayServerArgs, 'oauth'>,
  store: Pick<RelayStore, 'ssoProviders'>
) => {
  const clients = resolveOAuthClients(args, store)
  return enabledAuthProviders(clients).map(id => authProviderSummary(id, clients))
}
