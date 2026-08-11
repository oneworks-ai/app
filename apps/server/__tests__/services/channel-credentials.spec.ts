import { afterEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '#~/db/index.js'
import {
  clearChannelCredentialProvidersForTest,
  registerChannelCredentialProvider,
  resolveExecutableChannelCredential
} from '#~/services/channel-credentials/index.js'

vi.mock('#~/db/index.js', () => ({ getDb: vi.fn() }))

afterEach(() => clearChannelCredentialProvidersForTest())

describe('executable channel credentials', () => {
  it('fails closed for a missing provider, malformed handle, or owner mismatch', async () => {
    vi.mocked(getDb).mockReturnValue({
      getChannelUserCredential: vi.fn(() => ({
        credentialKey: 'lark-user',
        expiresAt: null,
        issuerKey: 'lark:product-team',
        providerHandle: 'keychain:credential-42',
        scopes: ['im:message:send'],
        status: 'active',
        userId: 'user-1'
      }))
    } as any)
    expect(
      await resolveExecutableChannelCredential({
        credentialKey: 'lark-user',
        issuerKey: 'lark:product-team',
        userId: 'user-1'
      })
    ).toBeUndefined()

    registerChannelCredentialProvider({
      id: 'keychain',
      resolve: vi.fn().mockResolvedValue({
        issuerKey: 'lark:other-team',
        scopes: ['im:message:send'],
        userId: 'user-1',
        value: { handle: 'native' }
      })
    })
    expect(
      await resolveExecutableChannelCredential({
        credentialKey: 'lark-user',
        issuerKey: 'lark:product-team',
        userId: 'user-1'
      })
    ).toBeUndefined()
  })

  it('returns a provider-owned handle only when issuer, user, and scope all match', async () => {
    vi.mocked(getDb).mockReturnValue({
      getChannelUserCredential: vi.fn(() => ({
        credentialKey: 'lark-user',
        expiresAt: null,
        issuerKey: 'lark:product-team',
        providerHandle: 'keychain:credential-42',
        scopes: ['im:message:send'],
        status: 'active',
        userId: 'user-1'
      }))
    } as any)
    registerChannelCredentialProvider({
      id: 'keychain',
      resolve: vi.fn().mockResolvedValue({
        issuerKey: 'lark:product-team',
        scopes: ['im:message:send'],
        userId: 'user-1',
        value: { native: 'handle' }
      })
    })

    await expect(resolveExecutableChannelCredential({
      credentialKey: 'lark-user',
      issuerKey: 'lark:product-team',
      requiredScopes: ['im:message:send'],
      userId: 'user-1'
    })).resolves.toEqual(expect.objectContaining({ providerId: 'keychain', value: { native: 'handle' } }))
  })
})
