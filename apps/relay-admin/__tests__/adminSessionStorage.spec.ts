import { afterEach, describe, expect, it, vi } from 'vitest'

const createStorage = (): Storage => {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key)
    },
    setItem: (key: string, value: string) => {
      values.set(key, value)
    }
  }
}

const installWindow = (href: string) => {
  const url = new URL(href)
  const localStorage = createStorage()
  const assign = vi.fn()
  const replaceState = vi.fn()
  vi.stubGlobal('document', { title: 'Relay Admin' })
  vi.stubGlobal('window', {
    history: {
      replaceState,
      state: { page: 'admin' }
    },
    localStorage,
    location: {
      assign,
      href: url.toString(),
      origin: url.origin
    }
  })
  return { assign, localStorage, replaceState }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('admin session storage', () => {
  it('consumes relay login callback tokens and clears them from the URL', async () => {
    const { localStorage, replaceState } = installWindow('http://127.0.0.1:8788/admin#relay_token=session-1')
    const { readInitialAdminSession } = await import('../src/features/auth/adminSessionStorage')

    expect(readInitialAdminSession()).toEqual({ token: 'session-1' })
    expect(localStorage.getItem('oneworks-relay-admin-session-token')).toBe('session-1')
    expect(replaceState).toHaveBeenCalledWith({ page: 'admin' }, 'Relay Admin', '/admin')
  })

  it('builds a login URL that returns to the cleaned admin route', async () => {
    installWindow('http://127.0.0.1:8788/admin/users?relay_token=old#relay_error=bad')
    const { buildAdminLoginUrl } = await import('../src/features/auth/adminSessionStorage')

    expect(buildAdminLoginUrl()).toBe('/login?redirect_uri=http%3A%2F%2F127.0.0.1%3A8788%2Fadmin%2Fusers')
  })

  it('redirects missing admin sessions to the login page', async () => {
    const { assign } = installWindow('http://127.0.0.1:8788/admin/users')
    const { redirectToAdminLogin } = await import('../src/features/auth/adminSessionStorage')

    redirectToAdminLogin()

    expect(assign).toHaveBeenCalledWith('/login?redirect_uri=http%3A%2F%2F127.0.0.1%3A8788%2Fadmin%2Fusers')
  })

  it('stores recent admin accounts for local switching and logout', async () => {
    const { localStorage } = installWindow('http://127.0.0.1:8788/admin/users')
    const {
      listAdminSessionAccounts,
      removeAdminSessionAccount,
      saveAdminSession,
      selectAdminSessionAccount
    } = await import('../src/features/auth/adminSessionStorage')

    saveAdminSession('owner-token', {
      email: 'owner@example.com',
      id: 'owner-1',
      name: 'Owner',
      role: 'owner'
    })
    saveAdminSession('admin-token', {
      email: 'admin@example.com',
      id: 'admin-1',
      name: 'Admin',
      role: 'admin'
    })

    expect(listAdminSessionAccounts().map(account => account.user.email)).toEqual([
      'admin@example.com',
      'owner@example.com'
    ])
    expect(selectAdminSessionAccount('owner-token')?.user.email).toBe('owner@example.com')
    expect(localStorage.getItem('oneworks-relay-admin-session-token')).toBe('owner-token')

    expect(removeAdminSessionAccount('owner-token').map(account => account.user.email)).toEqual([
      'admin@example.com'
    ])
    expect(localStorage.getItem('oneworks-relay-admin-session-token')).toBeNull()
  })

  it('uses remembered login account avatars for admin sessions without avatars', async () => {
    const { localStorage } = installWindow('http://127.0.0.1:8788/admin/profile')
    localStorage.setItem(
      'oneWorks.relayLogin.accounts:http://127.0.0.1:8788',
      JSON.stringify([{
        avatarUrl: 'https://example.com/avatar.png',
        email: 'owner@example.com',
        name: 'Owner',
        provider: 'google-sso',
        updatedAt: '2026-06-09T00:00:00.000Z'
      }])
    )
    const {
      listAdminSessionAccounts,
      saveAdminSession,
      selectAdminSessionAccount
    } = await import('../src/features/auth/adminSessionStorage')

    saveAdminSession('owner-token', {
      email: 'owner@example.com',
      id: 'owner-1',
      name: 'Owner',
      provider: 'google-sso',
      role: 'owner'
    })

    expect(listAdminSessionAccounts()[0]?.user.avatarUrl).toBe('https://example.com/avatar.png')
    expect(selectAdminSessionAccount('owner-token')?.user.avatarUrl).toBe('https://example.com/avatar.png')
  })
})
