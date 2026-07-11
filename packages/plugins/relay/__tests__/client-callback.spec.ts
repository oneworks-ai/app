import { afterEach, describe, expect, it, vi } from 'vitest'

import { activatePlugin } from '../src/client/index.js'
import {
  RelayLoginOptionsUnavailableError,
  createRelayLoginOptions,
  postRelayLoginJson
} from '../src/client/login-action.js'
import { buildPluginHomeWebLoginRedirectUri, buildWebLoginRedirectUri } from '../src/client/login-callback.js'
import { completeRelayLoginCallback } from '../src/client/react-view.js'
import type { PluginClientContext, PluginReactHost } from '../src/client/types.js'
import { DEFAULT_OFFICIAL_RELAY_SERVER_ID } from '../src/shared/official-services.js'

interface FakeLocation {
  hash: string
  href: string
  pathname: string
  search: string
}

const createReactHost = (): PluginReactHost => ({
  Fragment: Symbol.for('test.fragment'),
  createElement: vi.fn((type, props, ...children) => ({
    children,
    props,
    type
  })),
  useEffect: vi.fn(),
  useMemo: vi.fn(factory => factory()),
  useRef: vi.fn(initialValue => ({ current: initialValue })),
  useState: (initialValue => [
    typeof initialValue === 'function' ? (initialValue as () => unknown)() : initialValue,
    vi.fn()
  ]) as PluginReactHost['useState']
})

const updateLocation = (location: FakeLocation, nextHref: string) => {
  const url = new URL(nextHref)
  location.hash = url.hash
  location.href = url.toString()
  location.pathname = url.pathname
  location.search = url.search
}

const installBrowser = (href: string, input: {
  clientBase?: string
  desktop?: boolean
  open?: ReturnType<typeof vi.fn>
} = {}) => {
  const url = new URL(href)
  const location: FakeLocation = {
    hash: url.hash,
    href,
    pathname: url.pathname,
    search: url.search
  }
  const open = input.open ?? vi.fn(() => ({}))
  vi.stubGlobal('window', {
    history: {
      replaceState: vi.fn((_state: unknown, _title: string, nextHref: string) => updateLocation(location, nextHref))
    },
    location,
    open,
    ...(input.desktop === true ? { oneworksDesktop: {} } : {})
  })
  if (input.clientBase != null) {
    vi.stubGlobal('__ONEWORKS_PROJECT_RUNTIME_ENV__', {
      __ONEWORKS_PROJECT_CLIENT_BASE__: input.clientBase
    })
  }
  vi.stubGlobal('document', {
    addEventListener: vi.fn(),
    createElement: vi.fn(() => ({
      remove: vi.fn(),
      textContent: ''
    })),
    head: {
      appendChild: vi.fn()
    },
    removeEventListener: vi.fn()
  })
  return {
    location,
    open
  }
}

const createClientHarness = async (apiFetch: ReturnType<typeof vi.fn>) => {
  const commands = new Map<string, (payload?: unknown) => unknown | Promise<unknown>>()
  const cleanup = await activatePlugin(
    {
      api: {
        fetch: apiFetch
      },
      commands: {
        register: vi.fn((commandId, handler) => {
          commands.set(commandId, handler)
          return { dispose: vi.fn() }
        })
      },
      react: createReactHost(),
      scope: 'relay',
      slots: {
        register: vi.fn(() => ({ dispose: vi.fn() }))
      },
      views: {
        register: vi.fn(() => ({ dispose: vi.fn() }))
      }
    } satisfies PluginClientContext
  )
  return {
    commands,
    cleanup
  }
}

const statusResponse = () =>
  new Response(
    JSON.stringify({
      accounts: [],
      connection: {
        activeServerId: 'prod',
        state: 'registered'
      },
      servers: [{
        active: true,
        hasToken: true,
        id: 'prod',
        name: 'Production',
        remoteBaseUrl: 'http://127.0.0.1:8788'
      }]
    }),
    {
      headers: { 'content-type': 'application/json' },
      status: 200
    }
  )

const loginOptionMessages = {
  confirmPasswordPlaceholder: '确认密码',
  confirmPasswordRequired: '请确认密码',
  continueWithRegistration: '完成注册',
  emailPlaceholder: '邮箱或账号名',
  invalidCredentials: '账号或密码无效',
  inviteCodePlaceholder: '邀请码',
  inviteRequired: '请输入邀请码',
  passkeyCodePlaceholder: '验证码',
  passkeySendCode: '发送验证码',
  passkeyTitle: '使用 Passkey',
  passwordMinLength: '密码至少 8 位',
  passwordMismatch: '两次密码不一致',
  passwordPlaceholder: '密码',
  recentAccounts: '最近账号',
  rememberAccount: '记住账号',
  signInMode: '登录',
  signInWithPassword: '使用密码登录',
  signInWithSso: '使用 SSO 登录',
  signingIn: '登录中...',
  useLoginMethodPasskey: '使用 Passkey',
  useLoginMethodPassword: '使用密码',
  useLoginMethodVerificationCode: '使用验证码',
  verificationCodeSignIn: '使用验证码登录'
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('relay plugin client login callbacks', () => {
  it('loads server-owned login methods for the native client page', async () => {
    installBrowser('http://127.0.0.1:5173/ui/session/abc', { clientBase: '/ui' })
    const apiFetch = vi.fn(async (path: string) => {
      if (path === 'relay/login-url') {
        return new Response(
          JSON.stringify({
            loginUrl:
              'http://127.0.0.1:8788/login?redirect_uri=http%3A%2F%2F127.0.0.1%3A5173%2Fui%2Fplugins%2Frelay%2Fhome%3FrelayLogin%3D1&scope=relay&server_id=prod',
            remoteBaseUrl: 'http://127.0.0.1:8788',
            serverId: 'prod'
          }),
          { headers: { 'content-type': 'application/json' } }
        )
      }
      if (path === 'relay/login-options') {
        return new Response(
          JSON.stringify({
            options: {
              emailCodeLoginUrl: '/api/auth/email-code-login',
              emailVerificationSendUrl: '/api/auth/email-verification/send',
              inviteLoginUrl: '/api/auth/invite-login',
              locale: 'zh-CN',
              loginMethods: { default: 'password', enabled: ['password', 'passkey'] },
              messages: loginOptionMessages,
              passwordLoginUrl: '/api/auth/password-login',
              providers: [{
                id: 'google',
                label: '使用 Google 登录',
                startUrl: 'http://127.0.0.1:8788/api/auth/oauth/google/start'
              }],
              redirectUri: 'http://127.0.0.1:5173/ui/plugins/relay/home?relayLogin=1'
            }
          }),
          { headers: { 'content-type': 'application/json' } }
        )
      }
      return statusResponse()
    })
    const directFetch = vi.fn(async () => {
      throw new Error('The Relay client must not fetch the remote login API directly.')
    })
    vi.stubGlobal('fetch', directFetch)

    const result = await createRelayLoginOptions(
      { api: { fetch: apiFetch }, scope: 'relay' } as PluginClientContext,
      { forcePluginHomeRedirect: true, serverId: 'prod' }
    )

    expect(result.options.loginMethods.enabled).toEqual(['password', 'passkey'])
    expect(result.options.providers[0].id).toBe('google')
    expect(apiFetch).toHaveBeenCalledWith('relay/login-options', expect.objectContaining({ method: 'POST' }))
    expect(directFetch).not.toHaveBeenCalled()
  })

  it('falls back to the hosted login page for partial capability responses', async () => {
    installBrowser('http://127.0.0.1:5173/ui/session/abc', { clientBase: '/ui' })
    const apiFetch = vi.fn(async (path: string) => {
      if (path === 'relay/login-url') {
        return new Response(JSON.stringify({
          loginUrl:
            'http://127.0.0.1:8788/login?redirect_uri=http%3A%2F%2F127.0.0.1%3A5173%2Fui%2Fplugins%2Frelay%2Fhome%3FrelayLogin%3D1',
          remoteBaseUrl: 'http://127.0.0.1:8788',
          serverId: 'prod'
        }))
      }
      if (path === 'relay/login-options') {
        return new Response(JSON.stringify({
          options: {
            loginMethods: { default: 'password', enabled: ['password'] },
            providers: []
          }
        }))
      }
      return statusResponse()
    })
    const directFetch = vi.fn(async () => {
      throw new Error('The Relay client must not fetch the remote login API directly.')
    })
    vi.stubGlobal('fetch', directFetch)

    await expect(createRelayLoginOptions(
      { api: { fetch: apiFetch }, scope: 'relay' } as PluginClientContext,
      { forcePluginHomeRedirect: true, serverId: 'prod' }
    )).rejects.toMatchObject({
      loginUrl: expect.stringContaining('/login?'),
      name: RelayLoginOptionsUnavailableError.name
    })
    expect(directFetch).not.toHaveBeenCalled()
  })

  it('posts native password login through the scoped API without hiding server errors', async () => {
    const apiFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          code: 'registration_required',
          error: 'Invalid email or password.'
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 409
        }
      )
    )

    await expect(postRelayLoginJson(
      { api: { fetch: apiFetch } } as PluginClientContext,
      'prod',
      'password-login',
      { loginId: 'owner', password: 'wrong' }
    )).rejects.toMatchObject({
      code: 'registration_required',
      message: 'Invalid email or password.'
    })
    expect(apiFetch).toHaveBeenCalledWith(
      'relay/native-login',
      expect.objectContaining({
        body: JSON.stringify({
          action: 'password-login',
          body: { loginId: 'owner', password: 'wrong' },
          serverId: 'prod'
        }),
        method: 'POST'
      })
    )
  })

  it('builds the current Web plugin route as redirect_uri', () => {
    installBrowser('http://127.0.0.1:5173/plugins/relay/home?lang=zh-CN#relay_token=old')

    expect(buildWebLoginRedirectUri('prod')).toBe(
      'http://127.0.0.1:5173/plugins/relay/home?lang=zh-CN&relayLogin=1&relayLoginServerId=prod'
    )
  })

  it('builds the plugin home route as redirect_uri for global login commands', () => {
    installBrowser('http://127.0.0.1:5173/ui/session/abc?drawer=1', { clientBase: '/ui' })

    expect(buildPluginHomeWebLoginRedirectUri('relay', DEFAULT_OFFICIAL_RELAY_SERVER_ID)).toBe(
      `http://127.0.0.1:5173/ui/plugins/relay/home?relayLogin=1&relayLoginServerId=${DEFAULT_OFFICIAL_RELAY_SERVER_ID}`
    )
  })

  it('opens the default official relay login from the global login command', async () => {
    const open = vi.fn(() => ({}))
    installBrowser('http://127.0.0.1:5173/ui/session/abc', { clientBase: '/ui', open })
    const apiFetch = vi.fn(async (path: string) => {
      if (path === 'relay/login-url') {
        return new Response(JSON.stringify({ loginUrl: 'http://127.0.0.1:8788/login' }), {
          headers: { 'content-type': 'application/json' }
        })
      }
      return statusResponse()
    })
    const { cleanup, commands } = await createClientHarness(apiFetch)

    const result = await commands.get('login')?.()

    expect(apiFetch).toHaveBeenCalledWith('relay/login-url', expect.objectContaining({ method: 'POST' }))
    expect(open).toHaveBeenCalledWith('http://127.0.0.1:8788/login', '_blank', 'noopener,noreferrer')
    expect(result).toEqual({
      loginUrl: 'http://127.0.0.1:8788/login',
      remoteBaseUrl: 'http://127.0.0.1:8788',
      serverId: 'prod'
    })
    cleanup.dispose()
  })

  it('refreshes account chrome after persisting a login callback', async () => {
    installBrowser('http://127.0.0.1:5173/ui/plugins/relay/home#relay_token=demo')
    const calls: string[] = []
    const apiFetch = vi.fn(async () => {
      calls.push('callback')
      return new Response(JSON.stringify({ accounts: [] }), {
        headers: { 'content-type': 'application/json' }
      })
    })
    const onLoginComplete = vi.fn(() => {
      calls.push('refresh')
    })

    await completeRelayLoginCallback(
      { api: { fetch: apiFetch } } as PluginClientContext,
      { serverId: 'local', token: 'demo-token' },
      onLoginComplete
    )

    expect(apiFetch).toHaveBeenCalledWith('relay/login-callback', expect.objectContaining({ method: 'POST' }))
    expect(onLoginComplete).toHaveBeenCalledOnce()
    expect(calls).toEqual(['callback', 'refresh'])
  })
})
