import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createProviderManagementToken,
  getProviderAccountStatus,
  getProviderManagementSnapshot,
  getProviderManagementTokenProfile
} from '#~/services/model-providers/provider-client.js'

describe('model provider client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses USD as the Moonshot international balance fallback currency', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { available_balance: 12.34 } }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    const account = await getProviderAccountStatus({
      apiBaseUrl: 'https://api.moonshot.ai/v1',
      apiKey: 'secret-kimi',
      provider: 'moonshot-intl'
    })

    expect(account).toMatchObject({
      available: 12.34,
      currency: 'USD',
      kind: 'balance'
    })
    expect(fetchMock).toHaveBeenCalledWith('https://api.moonshot.ai/v1/users/me/balance', {
      headers: { Authorization: 'Bearer secret-kimi' }
    })
  })

  it('queries Micu token usage from the New API root', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: true,
          data: {
            total_available: 0,
            total_granted: 0,
            total_used: 0,
            unlimited_quota: true
          },
          message: 'ok'
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const account = await getProviderAccountStatus({
      apiBaseUrl: 'https://www.micuapi.ai/v1',
      apiKey: 'secret-micu',
      provider: 'micu'
    })

    expect(account).toMatchObject({
      currency: 'USD',
      kind: 'quota',
      unlimited: true
    })
    expect(fetchMock).toHaveBeenCalledWith('https://www.micuapi.ai/api/usage/token', {
      headers: { Authorization: 'Bearer secret-micu' }
    })
  })

  it('uses Micu New API management credentials for account balance', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            quota: 100_000_000,
            used_quota: 0
          },
          message: '',
          success: true
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const account = await getProviderAccountStatus({
      apiBaseUrl: 'https://www.micuapi.ai/v1',
      apiKey: 'secret-micu',
      management: {
        apiKey: 'secret-management',
        baseUrl: 'https://www.micuapi.ai',
        endpointKind: 'newapi',
        headers: {
          'New-Api-User': '42647'
        }
      },
      provider: 'micu'
    })

    expect(account).toMatchObject({
      available: 200,
      currency: 'CNY',
      kind: 'balance'
    })
    expect(fetchMock).toHaveBeenCalledWith('https://www.micuapi.ai/api/user/self', {
      headers: {
        Authorization: 'Bearer secret-management',
        'New-Api-User': '42647'
      }
    })
  })

  it('queries Micu New API management snapshot without returning token secrets', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/api/user/self')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { quota: 100_000_000 }, success: true }), { status: 200 })
        )
      }
      if (url.endsWith('/api/user/self/groups')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: ['default', { name: 'vip', ratio: 0.5 }], success: true }), {
            status: 200
          })
        )
      }
      if (url.includes('/api/token/')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                items: [{
                  group: 'default',
                  id: 12,
                  key: 'sensitive-token-value',
                  name: 'codex',
                  remain_quota: 50_000_000,
                  status: 1
                }]
              },
              success: true
            }),
            { status: 200 }
          )
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: 'gpt-5.4' }], success: true }), { status: 200 })
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const snapshot = await getProviderManagementSnapshot({
      apiBaseUrl: 'https://www.micuapi.ai/v1',
      apiKey: '',
      management: {
        apiKey: 'secret-management',
        headers: {
          'New-Api-User': '42647'
        }
      },
      provider: 'micu'
    })

    expect(snapshot.account).toMatchObject({
      available: 200,
      currency: 'CNY',
      kind: 'balance'
    })
    expect(snapshot.groups.map(group => group.id)).toEqual(['default', 'vip'])
    expect(snapshot.models).toEqual([{ id: 'gpt-5.4' }])
    expect(snapshot.tokens).toMatchObject([{
      group: 'default',
      id: '12',
      key: 'sk-sens**********alue',
      name: 'codex',
      remaining: 100,
      status: 1
    }])
    expect(JSON.stringify(snapshot)).not.toContain('sensitive-token-value')
  })

  it('keeps Micu New API management snapshots usable when optional endpoints fail', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/api/user/self')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { quota: 100_000_000 }, success: true }), { status: 200 })
        )
      }
      if (url.includes('/api/token/')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                items: [{
                  id: 12,
                  key: 'sensitive-token-value',
                  name: 'codex'
                }]
              },
              success: true
            }),
            { status: 200 }
          )
        )
      }
      return Promise.resolve(new Response(JSON.stringify({ message: 'not found' }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const snapshot = await getProviderManagementSnapshot({
      apiBaseUrl: 'https://www.micuapi.ai/v1',
      apiKey: '',
      management: {
        apiKey: 'optional-management',
        headers: {
          'New-Api-User': 'optional-user'
        }
      },
      provider: 'micu'
    })

    expect(snapshot.account).toMatchObject({
      available: 200,
      currency: 'CNY',
      kind: 'balance'
    })
    expect(snapshot.groups).toEqual([])
    expect(snapshot.models).toEqual([])
    expect(snapshot.tokens).toMatchObject([{
      id: '12',
      key: 'sk-sens**********alue',
      name: 'codex'
    }])
  })

  it('caches Micu New API management snapshots and invalidates them after token changes', async () => {
    let accountQuota = 100_000_000
    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      const method = options?.method ?? 'GET'
      if (method === 'POST' && url.endsWith('/api/token/')) {
        accountQuota = 150_000_000
        return Promise.resolve(
          new Response(JSON.stringify({ data: { id: 13, name: 'next' }, success: true }), { status: 200 })
        )
      }
      if (url.endsWith('/api/user/self')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { quota: accountQuota }, success: true }), { status: 200 })
        )
      }
      if (url.endsWith('/api/user/self/groups')) {
        return Promise.resolve(new Response(JSON.stringify({ data: ['default'], success: true }), { status: 200 }))
      }
      if (url.includes('/api/token/')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                items: [{
                  id: 12,
                  key: 'sensitive-token-value',
                  name: 'codex'
                }]
              },
              success: true
            }),
            { status: 200 }
          )
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify({ data: [{ id: 'gpt-5.4' }], success: true }), { status: 200 })
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const service = {
      apiBaseUrl: 'https://www.micuapi.ai/v1',
      apiKey: '',
      management: {
        apiKey: 'cache-management',
        headers: {
          'New-Api-User': 'cache-user'
        }
      },
      provider: 'micu'
    } satisfies Parameters<typeof getProviderManagementSnapshot>[0]

    const first = await getProviderManagementSnapshot(service)
    const second = await getProviderManagementSnapshot(service)

    expect(first.account).toMatchObject({ available: 200 })
    expect(second.account).toMatchObject({ available: 200 })
    expect(fetchMock).toHaveBeenCalledTimes(4)

    await createProviderManagementToken(service, { name: 'next' })
    const afterMutation = await getProviderManagementSnapshot(service)

    expect(afterMutation.account).toMatchObject({ available: 300 })
    expect(fetchMock).toHaveBeenCalledTimes(9)
  })

  it('creates Micu New API tokens with converted quota amounts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'ok', success: true }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await createProviderManagementToken(
      {
        apiBaseUrl: 'https://www.micuapi.ai/v1',
        apiKey: '',
        management: {
          apiKey: 'secret-management',
          headers: {
            'New-Api-User': '42647'
          }
        },
        provider: 'micu'
      },
      {
        group: 'default',
        name: 'codex',
        quota: 2,
        unlimited: false
      }
    )

    expect(result).toEqual({ message: 'ok', success: true })
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as Record<string, unknown>
    expect(fetchMock).toHaveBeenCalledWith('https://www.micuapi.ai/api/token/', {
      body: fetchMock.mock.calls[0]?.[1]?.body,
      headers: {
        Authorization: 'Bearer secret-management',
        'Content-Type': 'application/json',
        'New-Api-User': '42647'
      },
      method: 'POST'
    })
    expect(body).toEqual({
      expired_time: -1,
      group: 'default',
      name: 'codex',
      remain_quota: 1_000_000,
      unlimited_quota: false
    })
  })

  it('returns a usable local profile from a New API token detail', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            group: 'default',
            key: 'secret-token-value',
            name: 'codex'
          },
          success: true
        }),
        { status: 200 }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await getProviderManagementTokenProfile(
      {
        apiBaseUrl: 'https://www.micuapi.ai/v1',
        apiKey: '',
        management: {
          apiKey: 'secret-management',
          headers: {
            'New-Api-User': '42647'
          }
        },
        provider: 'micu'
      },
      '12'
    )

    expect(result.profile).toEqual({
      apiKey: 'sk-secret-token-value',
      description: 'New API token group: default',
      extra: {
        group: 'default',
        newapiTokenId: '12'
      },
      title: 'codex'
    })
  })
})
