/* eslint-disable max-lines -- Auth tests cover shared login, SSO, invite, and password flows together. */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { readRelayStore } from '../src/server.js'
import type { RelayEmailConfig } from '../src/types.js'
import { authHeaders, cleanupRelayFixtures, listenRelay, requestJson, requestRaw } from './helpers.js'

afterEach(async () => {
  vi.unstubAllGlobals()
  await cleanupRelayFixtures()
})

const googleOauth = {
  google: {
    clientId: 'google-client-id',
    clientSecret: 'google-client-secret'
  }
}

const githubOauth = {
  github: {
    clientId: 'github-client-id',
    clientSecret: 'github-client-secret'
  }
}

const feishuOauth = {
  feishu: {
    authorizationUrl: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
    clientId: 'feishu-client-id',
    clientSecret: 'feishu-client-secret',
    displayName: '飞书',
    scope: 'contact:user.email:readonly',
    tokenUrl: 'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
    userInfoUrl: 'https://open.feishu.cn/open-apis/authen/v1/user_info'
  }
}

const stubGoogleProfile = (email: string, options: { emailVerified?: boolean } = {}) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (requestInput: RequestInfo | URL) => {
      const url = String(requestInput)
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'provider-token' }), { status: 200 })
      }
      if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
        return new Response(
          JSON.stringify({
            sub: `google-${email}`,
            email,
            email_verified: options.emailVerified ?? true,
            name: `User ${email}`,
            picture: 'https://example.com/avatar.png'
          }),
          { status: 200 }
        )
      }
      return new Response(JSON.stringify({ error: 'unexpected fetch' }), { status: 500 })
    })
  )
}

const stubGithubProfile = (input: {
  email: string
  id: number
  login: string
}) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (requestInput: RequestInfo | URL) => {
      const url = String(requestInput)
      if (url === 'https://github.com/login/oauth/access_token') {
        return new Response(JSON.stringify({ access_token: 'github-provider-token' }), { status: 200 })
      }
      if (url === 'https://api.github.com/user') {
        return new Response(
          JSON.stringify({
            avatar_url: 'https://github.example/avatar.png',
            id: input.id,
            login: input.login,
            name: input.login
          }),
          { status: 200 }
        )
      }
      if (url === 'https://api.github.com/user/emails') {
        return new Response(
          JSON.stringify([
            {
              email: input.email,
              primary: true,
              verified: true
            }
          ]),
          { status: 200 }
        )
      }
      return new Response(JSON.stringify({ error: 'unexpected fetch' }), { status: 500 })
    })
  )
}

const stubFeishuProfile = (input: {
  email?: string | null
  openId?: string
  tenantKey?: string
  unionId?: string
} = {}) => {
  const requests: Array<{ body: unknown; contentType: string | null; url: string }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (requestInput: RequestInfo | URL, init?: RequestInit) => {
      const url = String(requestInput)
      requests.push({
        body: init?.body,
        contentType: init?.headers instanceof Headers
          ? init.headers.get('content-type')
          : init?.headers != null && !Array.isArray(init.headers)
          ? String((init.headers as Record<string, string>)['content-type'] ?? '')
          : null,
        url
      })
      if (url === 'https://open.feishu.cn/open-apis/authen/v2/oauth/token') {
        return new Response(JSON.stringify({ code: 0, access_token: 'feishu-access-token' }), { status: 200 })
      }
      if (url === 'https://open.feishu.cn/open-apis/authen/v1/user_info') {
        const email = input.email === undefined ? 'owner@feishu.example' : input.email
        return new Response(
          JSON.stringify({
            code: 0,
            msg: 'success',
            data: {
              avatar_url: 'https://feishu.example/avatar.png',
              ...(email == null ? {} : { email }),
              name: 'Feishu Owner',
              open_id: input.openId ?? 'ou-owner',
              tenant_key: input.tenantKey ?? 'tenant-demo',
              union_id: input.unionId ?? 'on-owner'
            }
          }),
          { status: 200 }
        )
      }
      return new Response(JSON.stringify({ error: 'unexpected fetch' }), { status: 500 })
    })
  )
  return requests
}

const readLoginConfig = (html: string) => {
  const match = /<script type="application\/json" id="relay-login-config">([^<]+)<\/script>/.exec(html)
  expect(match?.[1]).toBeDefined()
  return JSON.parse(match?.[1] ?? '{}') as {
    inviteLoginUrl?: string
    locale?: 'en' | 'zh-CN'
    messages?: {
      confirmPasswordPlaceholder?: string
      passwordMismatch?: string
      passwordMinLength?: string
      passwordPlaceholder?: string
      registerWithInvite?: string
      signInMode?: string
      signInWithPassword?: string
    }
    passwordLoginUrl?: string
    providers?: Array<{
      icon?: string
      id?: string
      label?: string
      startUrl?: string
    }>
    redirectUri?: string
  }
}

const startGoogleFlow = async (baseUrl: string, input: {
  loginHint?: string
  prompt?: string
  redirectUri?: string
} = {}) => {
  const search = new URLSearchParams()
  if (input.redirectUri != null) search.set('redirect_uri', input.redirectUri)
  if (input.loginHint != null) search.set('login_hint', input.loginHint)
  if (input.prompt != null) search.set('prompt', input.prompt)
  const response = await requestRaw(baseUrl, `/api/auth/oauth/google/start?${search.toString()}`, {
    redirect: 'manual'
  })

  expect(response.status).toBe(302)
  return response.headers.get('location') ?? ''
}

const startGithubFlow = async (baseUrl: string, input: {
  inviteCode?: string
} = {}) => {
  const search = new URLSearchParams()
  if (input.inviteCode != null) search.set('invite_code', input.inviteCode)
  const response = await requestRaw(baseUrl, `/api/auth/oauth/github/start?${search.toString()}`, {
    redirect: 'manual'
  })

  expect(response.status).toBe(302)
  return response.headers.get('location') ?? ''
}

describe('relay server auth routes', () => {
  it('lists configured OAuth providers and creates auth state redirects', async () => {
    const { args, baseUrl } = await listenRelay({
      allowOrigin: 'https://app.example',
      oauth: googleOauth,
      publicBaseUrl: 'https://relay.example'
    })
    const providers = await requestJson(baseUrl, '/api/auth/providers')
    const location = await startGoogleFlow(baseUrl, {
      loginHint: 'owner@example.com',
      prompt: 'select_account',
      redirectUri: 'https://app.example/callback'
    })
    const store = await readRelayStore(args.dataPath)

    expect(providers.body).toEqual({
      providers: [{ id: 'google' }]
    })
    expect(location).toContain('https://accounts.google.com/o/oauth2/v2/auth')
    expect(location).toContain('client_id=google-client-id')
    expect(location).toContain('login_hint=owner%40example.com')
    expect(location).toContain('prompt=select_account')
    expect(location).toContain(encodeURIComponent('https://relay.example/api/auth/oauth/google/callback'))
    expect(store.oauthStates).toHaveLength(1)
    expect(store.oauthStates[0]).toMatchObject({
      provider: 'google',
      redirectUri: 'https://app.example/callback'
    })
  })

  it('exposes the current login methods and SSO choices for native clients', async () => {
    const { baseUrl } = await listenRelay({ allowOrigin: 'https://app.example', oauth: googleOauth })
    const redirectUri = 'https://app.example/plugins/relay/home?relayLogin=1'
    const response = await requestRaw(
      baseUrl,
      `/api/auth/login-options?redirect_uri=${encodeURIComponent(redirectUri)}&server_id=prod&lang=zh-CN`
    )
    const config = await response.json() as {
      loginMethods?: { default?: string; enabled?: string[] }
      passwordLoginUrl?: string
      providers?: Array<{ id?: string; startUrl?: string }>
    }

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(config.loginMethods).toEqual({
      default: 'password',
      enabled: ['password', 'passkey']
    })
    expect(config.passwordLoginUrl).toBe('/api/auth/password-login')
    expect(config.providers).toEqual([expect.objectContaining({
      id: 'google',
      startUrl: expect.stringContaining('/api/auth/oauth/google/start')
    })])
    const providerStartUrl = new URL(String(config.providers?.[0].startUrl))
    const completionUrl = new URL(String(providerStartUrl.searchParams.get('redirect_uri')))
    expect(completionUrl.searchParams.get('redirect_uri')).toBe(redirectUri)
  })

  it('omits native email-code login when the service requires Turnstile', async () => {
    const { baseUrl } = await listenRelay({
      defaultLoginMethod: 'verification_code',
      email: {
        provider: 'disabled',
        turnstile: { mode: 'required' }
      } as RelayEmailConfig,
      emailProvider: { sendVerificationCode: async () => ({}) }
    })
    const redirectUri = 'http://127.0.0.1:5173/plugins/relay/home?relayLogin=1'
    const response = await requestRaw(
      baseUrl,
      `/api/auth/login-options?redirect_uri=${encodeURIComponent(redirectUri)}`
    )
    const config = await response.json() as {
      loginMethods?: { default?: string; enabled?: string[] }
    }

    expect(response.status).toBe(200)
    expect(config.loginMethods).toEqual({ default: 'password', enabled: ['password', 'passkey'] })
  })

  it('rejects OAuth redirects outside configured Client callbacks', async () => {
    const { args, baseUrl } = await listenRelay({
      allowOrigin: 'https://app.example',
      oauth: googleOauth
    })
    const attacker = await requestRaw(
      baseUrl,
      `/api/auth/oauth/google/start?redirect_uri=${encodeURIComponent('https://attacker.example/callback')}`,
      { redirect: 'manual' }
    )
    const wrongSchemeTarget = await requestRaw(
      baseUrl,
      `/api/auth/oauth/google/start?redirect_uri=${encodeURIComponent('oneworks://attacker/auth')}`,
      { redirect: 'manual' }
    )
    const clientCallback = await requestRaw(
      baseUrl,
      `/api/auth/oauth/google/start?redirect_uri=${encodeURIComponent('oneworks://relay/auth?scope=relay')}`,
      { redirect: 'manual' }
    )

    expect(attacker.status).toBe(400)
    expect(wrongSchemeTarget.status).toBe(400)
    expect(clientCallback.status).toBe(302)
    expect((await readRelayStore(args.dataPath)).oauthStates).toHaveLength(1)
  })

  it('creates an owner session from the first OAuth login and authorizes admin routes', async () => {
    const { args, baseUrl } = await listenRelay({ oauth: googleOauth })
    await startGoogleFlow(baseUrl)
    const state = (await readRelayStore(args.dataPath)).oauthStates[0].state
    stubGoogleProfile('owner@example.com')

    const callback = await requestJson(baseUrl, `/api/auth/oauth/google/callback?code=ok&state=${state}`)
    const token = String(callback.body.token)
    const me = await requestJson(baseUrl, '/api/auth/me', {
      headers: {
        authorization: `Bearer ${token}`
      }
    })
    const invite = await requestJson(baseUrl, '/api/admin/invites', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ code: 'owned-invite', role: 'member' })
    })

    expect(callback.response.status).toBe(200)
    expect(callback.body.user).toMatchObject({
      email: 'owner@example.com',
      provider: 'google',
      role: 'owner'
    })
    expect(me.response.status).toBe(200)
    expect(me.body.user).toMatchObject({
      email: 'owner@example.com',
      role: 'owner'
    })
    expect(invite.response.status).toBe(200)
    expect(invite.body.invite).toMatchObject({ code: 'owned-invite' })
  })

  it('requires an invite for additional OAuth users', async () => {
    const { args, baseUrl } = await listenRelay({ oauth: googleOauth })
    await startGoogleFlow(baseUrl)
    const firstState = (await readRelayStore(args.dataPath)).oauthStates[0].state
    stubGoogleProfile('owner@example.com')
    await requestJson(baseUrl, `/api/auth/oauth/google/callback?code=ok&state=${firstState}`)

    await startGoogleFlow(baseUrl)
    const secondState = (await readRelayStore(args.dataPath)).oauthStates[0].state
    stubGoogleProfile('second@example.com')
    const callback = await requestJson(baseUrl, `/api/auth/oauth/google/callback?code=ok&state=${secondState}`)

    expect(callback.response.status).toBe(403)
    expect(callback.body).toEqual({ error: 'Invite required.' })
  })

  it('keeps same-email SSO logins as separate users across providers', async () => {
    const { args, baseUrl } = await listenRelay({
      oauth: {
        ...googleOauth,
        ...githubOauth
      }
    })
    await startGoogleFlow(baseUrl)
    const googleState = (await readRelayStore(args.dataPath)).oauthStates[0].state
    stubGoogleProfile('same@example.com')
    const googleCallback = await requestJson(baseUrl, `/api/auth/oauth/google/callback?code=ok&state=${googleState}`)
    const ownerToken = String(googleCallback.body.token)
    await requestJson(baseUrl, '/api/admin/invites', {
      method: 'POST',
      headers: authHeaders(ownerToken),
      body: JSON.stringify({ code: 'github-same-email', role: 'member' })
    })

    await startGithubFlow(baseUrl, { inviteCode: 'github-same-email' })
    const githubState = (await readRelayStore(args.dataPath)).oauthStates[0].state
    stubGithubProfile({
      email: 'same@example.com',
      id: 12_345,
      login: 'same-login'
    })
    const githubCallback = await requestJson(baseUrl, `/api/auth/oauth/github/callback?code=ok&state=${githubState}`)
    const store = await readRelayStore(args.dataPath)
    const githubUser = githubCallback.body.user as { id: string }
    const googleUser = googleCallback.body.user as { id: string }

    expect(googleCallback.response.status).toBe(200)
    expect(githubCallback.response.status).toBe(200)
    expect(githubCallback.body.user).toMatchObject({
      email: 'same@example.com',
      loginId: 'same-login',
      provider: 'github',
      role: 'member'
    })
    expect(githubUser.id).not.toBe(googleUser.id)
    expect(store.users).toHaveLength(2)
    expect(store.users.map(user => user.email)).toEqual(['same@example.com', 'same@example.com'])
    expect(store.authIdentities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: 'google',
        providerUserId: 'google-same@example.com',
        userId: googleUser.id
      }),
      expect.objectContaining({
        provider: 'github',
        providerUserId: '12345',
        userId: githubUser.id
      })
    ]))
  })

  it('rejects OAuth profiles without a verified email', async () => {
    const { args, baseUrl } = await listenRelay({ oauth: googleOauth })
    await startGoogleFlow(baseUrl)
    const state = (await readRelayStore(args.dataPath)).oauthStates[0].state
    stubGoogleProfile('owner@example.com', { emailVerified: false })

    const callback = await requestJson(baseUrl, `/api/auth/oauth/google/callback?code=ok&state=${state}`)

    expect(callback.response.status).toBe(403)
    expect(callback.body).toEqual({ error: 'OAuth profile did not include a verified email address.' })
  })

  it('creates a Feishu SSO user from Feishu user_info without treating email as verified', async () => {
    const { args, baseUrl } = await listenRelay({
      oauth: feishuOauth,
      publicBaseUrl: 'http://127.0.0.1:8788'
    })
    const start = await requestRaw(baseUrl, '/api/auth/oauth/feishu/start', { redirect: 'manual' })
    const state = (await readRelayStore(args.dataPath)).oauthStates[0].state
    const requests = stubFeishuProfile()

    const callback = await requestJson(baseUrl, `/api/auth/oauth/feishu/callback?code=ok&state=${state}`)
    const store = await readRelayStore(args.dataPath)
    const tokenRequest = requests.find(request => request.url.endsWith('/oauth/token'))

    expect(start.status).toBe(302)
    expect(start.headers.get('location')).toContain('https://accounts.feishu.cn/open-apis/authen/v1/authorize')
    expect(start.headers.get('location')).toContain('client_id=feishu-client-id')
    expect(start.headers.get('location')).toContain('scope=contact%3Auser.email%3Areadonly')
    expect(start.headers.get('location')).toContain(
      encodeURIComponent('http://127.0.0.1:8788/api/auth/oauth/feishu/callback')
    )
    expect(tokenRequest?.contentType).toBe('application/json; charset=utf-8')
    expect(JSON.parse(String(tokenRequest?.body))).toMatchObject({
      client_id: 'feishu-client-id',
      client_secret: 'feishu-client-secret',
      code: 'ok',
      grant_type: 'authorization_code',
      redirect_uri: 'http://127.0.0.1:8788/api/auth/oauth/feishu/callback'
    })
    expect(callback.response.status).toBe(200)
    expect(callback.body.user).toMatchObject({
      avatarUrl: 'https://feishu.example/avatar.png',
      email: 'owner@feishu.example',
      name: 'Feishu Owner',
      provider: 'feishu',
      role: 'owner'
    })
    expect(store.authIdentities).toEqual([expect.objectContaining({
      email: 'owner@feishu.example',
      emailVerified: false,
      provider: 'feishu',
      providerUserId: 'tenant-demo:on-owner'
    })])
  })

  it('creates a Feishu SSO user with a local placeholder email when Feishu omits email', async () => {
    const { args, baseUrl } = await listenRelay({
      oauth: feishuOauth,
      publicBaseUrl: 'http://127.0.0.1:8788'
    })
    await requestRaw(baseUrl, '/api/auth/oauth/feishu/start', { redirect: 'manual' })
    const state = (await readRelayStore(args.dataPath)).oauthStates[0].state
    stubFeishuProfile({ email: null })

    const callback = await requestJson(baseUrl, `/api/auth/oauth/feishu/callback?code=ok&state=${state}`)
    const store = await readRelayStore(args.dataPath)
    const user = store.users[0]

    expect(callback.response.status).toBe(200)
    expect(callback.body.user).toMatchObject({
      name: 'Feishu Owner',
      provider: 'feishu',
      role: 'owner'
    })
    expect(user.email).toMatch(/^feishu-[a-f0-9]{16}@feishu\.relay\.invalid$/)
    expect(user.loginId).toMatch(/^feishu-[a-f0-9]{16}$/)
    expect(store.authIdentities).toEqual([expect.objectContaining({
      email: user.email,
      emailVerified: false,
      provider: 'feishu',
      providerUserId: 'tenant-demo:on-owner'
    })])
  })

  it('creates email invite login sessions and enforces max uses with the invite role', async () => {
    const { args, baseUrl } = await listenRelay()
    const invite = await requestJson(baseUrl, '/api/admin/invites', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ code: 'email-admin', maxUses: 1, role: 'admin' })
    })
    const login = await requestJson(baseUrl, '/api/auth/invite-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'new-user@example.com',
        inviteCode: 'email-admin',
        name: 'New User'
      })
    })
    const token = String(login.body.token)
    const me = await requestJson(baseUrl, '/api/auth/me', {
      headers: {
        authorization: `Bearer ${token}`
      }
    })
    const blocked = await requestJson(baseUrl, '/api/auth/invite-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'second-user@example.com',
        inviteCode: 'email-admin'
      })
    })
    const store = await readRelayStore(args.dataPath)

    expect(invite.response.status).toBe(200)
    expect(invite.body.invite).toMatchObject({ code: 'email-admin', maxUses: 1, role: 'admin', used: 0 })
    expect(login.response.status).toBe(200)
    expect(login.body.user).toMatchObject({
      email: 'new-user@example.com',
      name: 'New User',
      provider: 'invite',
      role: 'admin'
    })
    expect(me.response.status).toBe(200)
    expect(me.body.user).toMatchObject({ email: 'new-user@example.com', role: 'admin' })
    expect(blocked.response.status).toBe(403)
    expect(blocked.body).toEqual({ error: 'Invite required.' })
    expect(store.invites[0]).toMatchObject({ code: 'email-admin', used: 1 })
  })

  it('creates password login sessions for users with stored passwords', async () => {
    const { args, baseUrl } = await listenRelay()
    const created = await requestJson(baseUrl, '/api/admin/users', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({
        email: 'password@example.com',
        loginId: 'password-user',
        name: 'Password User',
        password: 'correct-password',
        role: 'admin'
      })
    })
    const rejected = await requestJson(baseUrl, '/api/auth/password-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'password@example.com',
        password: 'wrong-password'
      })
    })
    const missing = await requestJson(baseUrl, '/api/auth/password-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'missing@example.com',
        password: 'missing-password'
      })
    })
    const login = await requestJson(baseUrl, '/api/auth/password-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'PASSWORD@example.com',
        password: 'correct-password'
      })
    })
    const loginById = await requestJson(baseUrl, '/api/auth/password-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        loginId: 'password-user',
        password: 'correct-password'
      })
    })
    const token = String(login.body.token)
    const me = await requestJson(baseUrl, '/api/auth/me', {
      headers: authHeaders(token)
    })
    const store = await readRelayStore(args.dataPath)

    expect(created.response.status).toBe(200)
    expect(created.body.user).toMatchObject({
      email: 'password@example.com',
      loginId: 'password-user',
      passwordEnabled: true,
      provider: 'password',
      role: 'admin'
    })
    expect(JSON.stringify(created.body.user)).not.toContain('passwordHash')
    expect(rejected.response.status).toBe(401)
    expect(rejected.body).toEqual({ error: 'Invalid email or password.' })
    expect(missing.response.status).toBe(401)
    expect(missing.body).toEqual({ code: 'registration_required', error: 'Invite required.' })
    expect(login.response.status).toBe(200)
    expect(login.body.user).toMatchObject({
      email: 'password@example.com',
      provider: 'password',
      role: 'admin'
    })
    expect(loginById.response.status).toBe(200)
    expect(loginById.body.user).toMatchObject({
      email: 'password@example.com',
      loginId: 'password-user',
      role: 'admin'
    })
    expect(me.response.status).toBe(200)
    expect(me.body.user).toMatchObject({ email: 'password@example.com', role: 'admin' })
    expect(store.users[0].passwordHash).toMatch(/^scrypt\$/)
    expect(JSON.stringify(store.users[0])).not.toContain('correct-password')
  })

  it('creates invite registrations with passwords and allows later password login', async () => {
    const { args, baseUrl } = await listenRelay()
    await requestJson(baseUrl, '/api/admin/invites', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ code: 'register-admin', maxUses: 1, role: 'admin' })
    })
    const registered = await requestJson(baseUrl, '/api/auth/invite-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'registered@example.com',
        inviteCode: 'register-admin',
        password: 'register-password'
      })
    })
    const passwordLogin = await requestJson(baseUrl, '/api/auth/password-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'registered@example.com',
        password: 'register-password'
      })
    })
    const store = await readRelayStore(args.dataPath)

    expect(registered.response.status).toBe(200)
    expect(registered.body.user).toMatchObject({
      email: 'registered@example.com',
      provider: 'password',
      role: 'admin'
    })
    expect(JSON.stringify(registered.body.user)).not.toContain('passwordHash')
    expect(passwordLogin.response.status).toBe(200)
    expect(passwordLogin.body.user).toMatchObject({
      email: 'registered@example.com',
      provider: 'password',
      role: 'admin'
    })
    expect(store.users[0]).toMatchObject({
      email: 'registered@example.com',
      provider: 'password'
    })
    expect(store.users[0].passwordHash).toMatch(/^scrypt\$/)
    expect(store.invites[0]).toMatchObject({ code: 'register-admin', used: 1 })
  })

  it('upgrades existing users from invite login without downgrading higher roles', async () => {
    const { baseUrl } = await listenRelay()
    await requestJson(baseUrl, '/api/admin/users', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ email: 'member@example.com', name: 'Member', role: 'member' })
    })
    await requestJson(baseUrl, '/api/admin/invites', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ code: 'upgrade-admin', maxUses: 2, role: 'admin' })
    })
    const upgraded = await requestJson(baseUrl, '/api/auth/invite-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'member@example.com', invite_code: 'upgrade-admin' })
    })
    await requestJson(baseUrl, '/api/admin/invites', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ code: 'viewer-invite', maxUses: 1, role: 'viewer' })
    })
    const notDowngraded = await requestJson(baseUrl, '/api/auth/invite-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'member@example.com', inviteCode: 'viewer-invite' })
    })

    expect(upgraded.response.status).toBe(200)
    expect(upgraded.body.user).toMatchObject({ email: 'member@example.com', role: 'admin' })
    expect(notDowngraded.response.status).toBe(200)
    expect(notDowngraded.body.user).toMatchObject({ email: 'member@example.com', role: 'admin' })
  })

  it('redirects login page OAuth failures back to the completion page', async () => {
    const { args, baseUrl } = await listenRelay({ oauth: googleOauth })
    await startGoogleFlow(baseUrl)
    const firstState = (await readRelayStore(args.dataPath)).oauthStates[0].state
    stubGoogleProfile('owner@example.com')
    await requestJson(baseUrl, `/api/auth/oauth/google/callback?code=ok&state=${firstState}`)

    const finalRedirect = 'http://127.0.0.1/plugin/relay/callback'
    const completionRedirect = `${baseUrl}/login/complete?redirect_uri=${encodeURIComponent(finalRedirect)}`
    await startGoogleFlow(baseUrl, { redirectUri: completionRedirect })
    const secondState = (await readRelayStore(args.dataPath)).oauthStates[0].state
    stubGoogleProfile('second@example.com')
    const callback = await requestRaw(baseUrl, `/api/auth/oauth/google/callback?code=ok&state=${secondState}`, {
      redirect: 'manual'
    })
    const location = callback.headers.get('location') ?? ''
    const error = new URLSearchParams(new URL(location).hash.replace(/^#/, '')).get('relay_error')

    expect(callback.status).toBe(302)
    expect(location).toContain(`${baseUrl}/login/complete`)
    expect(error).toBe('Invite required.')
  })

  it('serves a login page that routes OAuth through login completion', async () => {
    const { baseUrl } = await listenRelay({
      oauth: googleOauth,
      publicBaseUrl: 'https://relay.example'
    })
    const response = await requestRaw(
      baseUrl,
      '/login?redirect_uri=oneworks%3A%2F%2Frelay%2Fauth%3Fworkspace%3D%252Fworkspace%26scope%3Drelay&server_id=prod&login_method=passkey',
      {
        headers: {
          'accept-language': 'en-US,en;q=0.9'
        }
      }
    )
    const body = await response.text()
    const config = readLoginConfig(body)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'none'")
    expect(body).toContain('id="relay-login-root"')
    expect(body).toContain('/admin/assets/favicon-dark.svg')
    expect(body).toContain('/admin/assets/favicon-light.svg')
    expect(body).toContain('src="/admin/assets/login.js"')
    expect(body).toContain('Recent accounts')
    expect(body).not.toContain('data-account-section hidden')
    expect(body).not.toContain('This browser has not remembered any accounts')
    expect(body).toContain('Remember account')
    expect(body).toContain('Password')
    expect(body).toContain('Create account')
    expect(body).toContain('Confirm password')
    expect(body).toContain('Invite code')
    expect(body).not.toContain('data-invite-login-form')
    expect(body).toContain('Sign in with SSO')
    expect(body).not.toContain('Choose an account')
    expect(body).not.toContain('href="/login?redirect_uri=')
    expect(body).not.toContain('relay-login__account-card')
    expect(body).not.toContain('relay-login__locale')
    expect(body).not.toContain('<nav')
    expect(body).not.toContain('relay-login__brand')
    expect(body).not.toContain('relay-login__panel')
    expect(body).toContain('data-relay-login-background-loader')
    expect(body).not.toContain('data-relay-login-icon-loader')
    expect(body).not.toContain('background-size: 14px 14px')
    expect(body).not.toContain('background-size: auto, 38px 38px, 38px 38px')
    expect(body).toContain('--primary-color: #e23f12')
    expect(body).not.toContain('--relay-accent: #1f8f5f')
    expect(body).toContain("canvasClassName: 'relay-login__backdrop-canvas'")
    expect(body).toContain('fullscreen: true')
    expect(body).not.toContain("size: '100%'")
    expect(config.providers).toEqual([expect.objectContaining({
      icon: 'google',
      id: 'google',
      startUrl: expect.stringContaining('/api/auth/oauth/google/start')
    })])
    expect(config.messages).toMatchObject({
      confirmPasswordPlaceholder: 'Confirm password',
      passwordMismatch: 'The passwords do not match.',
      passwordMinLength: 'Password must be at least 8 characters.',
      passwordPlaceholder: 'Password',
      registerWithInvite: 'Create account',
      signInMode: 'Sign in',
      signInWithPassword: 'Sign in'
    })
    expect(config.inviteLoginUrl).toBe('/api/auth/invite-login')
    expect(config.locale).toBe('en')
    expect(config.loginMethods.default).toBe('passkey')
    expect(config.passwordLoginUrl).toBe('/api/auth/password-login')
    expect(body).toContain(encodeURIComponent('https://relay.example/login/complete'))
    expect(config.redirectUri).toContain('oneworks://relay/auth')
  })

  it('marks GitHub login providers with the GitHub icon', async () => {
    const { baseUrl } = await listenRelay({ allowOrigin: 'https://app.example', oauth: githubOauth })
    const response = await requestRaw(baseUrl, '/login?redirect_uri=https%3A%2F%2Fapp.example%2Fcallback')
    const config = readLoginConfig(await response.text())

    expect(response.status).toBe(200)
    expect(config.providers).toEqual([expect.objectContaining({
      icon: 'github',
      id: 'github',
      startUrl: expect.stringContaining('/api/auth/oauth/github/start')
    })])
  })

  it('marks 飞书 login providers with the Feishu icon', async () => {
    const { baseUrl } = await listenRelay({ allowOrigin: 'https://app.example', oauth: feishuOauth })
    const response = await requestRaw(baseUrl, '/login?redirect_uri=https%3A%2F%2Fapp.example%2Fcallback')
    const config = readLoginConfig(await response.text())

    expect(response.status).toBe(200)
    expect(config.providers).toEqual([expect.objectContaining({
      icon: 'feishu',
      id: 'feishu',
      startUrl: expect.stringContaining('/api/auth/oauth/feishu/start')
    })])
  })

  it('omits empty login page sections for missing local accounts and SSO providers', async () => {
    const { baseUrl } = await listenRelay({ allowOrigin: 'https://app.example' })
    const redirect = encodeURIComponent('https://app.example/callback')
    const response = await requestRaw(baseUrl, `/login?redirect_uri=${redirect}&lang=zh-CN`)
    const body = await response.text()
    const config = readLoginConfig(body)

    expect(response.status).toBe(200)
    expect(body).toContain('id="relay-login-root"')
    expect(body).not.toContain('data-account-section hidden')
    expect(body).not.toContain('这个浏览器还没有记住任何账号。')
    expect(config.providers).toEqual([])
    expect(response.headers.get('content-security-policy')).toBe('frame-ancestors https://app.example')
    expect(config.locale).toBe('zh-CN')
    expect(body).not.toContain('还没有配置可用的 SSO 提供方。')
    expect(body).not.toContain('<div class="relay-login__providers">')
    expect(body).toContain('密码')
    expect(body).toContain('记住账号')
  })

  it('rejects login iframe ancestors outside the configured Web app origin', async () => {
    const { baseUrl } = await listenRelay({ allowOrigin: 'https://oneworks.example' })
    const allowedRedirect = encodeURIComponent('https://oneworks.example/plugins/relay/home')
    const unknownRedirect = encodeURIComponent('https://unknown.example/plugins/relay/home')

    const allowed = await requestRaw(baseUrl, `/login?redirect_uri=${allowedRedirect}`)
    const unknown = await requestRaw(baseUrl, `/login?redirect_uri=${unknownRedirect}`)

    expect(allowed.headers.get('content-security-policy')).toBe('frame-ancestors https://oneworks.example')
    expect(unknown.headers.get('content-security-policy')).toBe("frame-ancestors 'none'")
  })

  it('serves localized login completion failures', async () => {
    const { baseUrl } = await listenRelay({ allowOrigin: 'https://app.example', oauth: googleOauth })
    const redirect = encodeURIComponent('https://app.example/callback')
    const response = await requestRaw(baseUrl, `/login/complete?redirect_uri=${redirect}&lang=zh-CN`)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain('data-complete-title')
    expect(body).toContain('登录失败')
    expect(body).toContain('新账号登陆需要邀请码。')
    expect(body).toContain('Invite required.')
  })

  it('localizes the login page from query params and browser language', async () => {
    const { baseUrl } = await listenRelay({ allowOrigin: 'https://app.example', oauth: googleOauth })
    const redirect = encodeURIComponent('https://app.example/callback')
    const zhResponse = await requestRaw(baseUrl, `/login?redirect_uri=${redirect}`, {
      headers: {
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.5'
      }
    })
    const zhBody = await zhResponse.text()
    const enResponse = await requestRaw(baseUrl, `/login?redirect_uri=${redirect}&lang=en`, {
      headers: {
        'accept-language': 'zh-CN,zh;q=0.9'
      }
    })
    const enBody = await enResponse.text()

    expect(zhResponse.status).toBe(200)
    expect(zhBody).toContain('<html lang="zh-CN">')
    expect(zhBody).toContain('最近账号')
    expect(zhBody).not.toContain('这个浏览器还没有记住任何账号。')
    expect(zhBody).toContain('记住账号')
    expect(zhBody).toContain('使用 google 登陆')
    expect(enResponse.status).toBe(200)
    expect(enBody).toContain('<html lang="en">')
    expect(enBody).toContain('Recent accounts')
    expect(enBody).toContain('Sign in with google')
  })
})
