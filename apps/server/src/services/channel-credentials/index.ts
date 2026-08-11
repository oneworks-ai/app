import { parseOpaqueCredentialProviderHandle } from '#~/db/channelIdentities/credential-record.js'
import { getDb } from '#~/db/index.js'

export interface ExecutableChannelCredentialHandle {
  credentialKey: string
  issuerKey: string
  providerId: string
  userId: string
  value: unknown
}

export interface ChannelCredentialProvider {
  id: string
  resolve: (reference: string) => Promise<
    {
      issuerKey: string
      scopes: readonly string[]
      userId: string
      value: unknown
    } | undefined
  >
}

const providers = new Map<string, ChannelCredentialProvider>()

const hasScopes = (granted: readonly string[], required: readonly string[]) => {
  const scopeSet = new Set(granted)
  return required.every(scope => scopeSet.has(scope))
}

export const registerChannelCredentialProvider = (provider: ChannelCredentialProvider) => {
  if (parseOpaqueCredentialProviderHandle(`${provider.id}:provider-check`) == null) {
    throw new Error('channel credential provider id is malformed')
  }
  providers.set(provider.id, provider)
  return () => providers.delete(provider.id)
}

export const clearChannelCredentialProvidersForTest = () => providers.clear()

/** Resolves opaque provider state only for server-side execution after ownership and scope checks. */
export const resolveExecutableChannelCredential = async (input: {
  credentialKey: string
  issuerKey: string
  requiredScopes?: readonly string[]
  userId: string
}): Promise<ExecutableChannelCredentialHandle | undefined> => {
  const credential = getDb().getChannelUserCredential(input.issuerKey, input.userId, input.credentialKey)
  const requiredScopes = input.requiredScopes ?? []
  if (
    credential == null ||
    credential.status !== 'active' ||
    credential.expiresAt != null && credential.expiresAt <= Date.now() ||
    credential.issuerKey !== input.issuerKey ||
    credential.userId !== input.userId ||
    !hasScopes(credential.scopes ?? [], requiredScopes)
  ) return undefined

  const parsed = parseOpaqueCredentialProviderHandle(credential.providerHandle)
  if (parsed == null) return undefined
  const provider = providers.get(parsed.providerId)
  if (provider == null) return undefined

  const resolved = await provider.resolve(parsed.reference).catch(() => undefined)
  if (
    resolved == null ||
    resolved.issuerKey !== input.issuerKey ||
    resolved.userId !== input.userId ||
    !hasScopes(resolved.scopes, requiredScopes)
  ) return undefined

  return {
    credentialKey: input.credentialKey,
    issuerKey: input.issuerKey,
    providerId: parsed.providerId,
    userId: input.userId,
    value: resolved.value
  }
}
