import { afterEach, describe, expect, it, vi } from 'vitest'

import { readRelayStore } from '../src/server.js'
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

const stubGoogleProfile = (email: string) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({ access_token: 'provider-token' }), { status: 200 })
      }
      if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
        return new Response(
          JSON.stringify({
            sub: `google-${email}`,
            email,
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

describe('relay server auth routes', () => {
  it('lists configured OAuth providers and creates auth state redirects', async () => {
    const { args, baseUrl } = await listenRelay({
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
    const login = await requestJson(baseUrl, '/api/auth/password-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'PASSWORD@example.com',
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
      passwordEnabled: true,
      provider: 'password',
      role: 'admin'
    })
    expect(JSON.stringify(created.body.user)).not.toContain('passwordHash')
    expect(rejected.response.status).toBe(401)
    expect(rejected.body).toEqual({ error: 'Invalid email or password.' })
    expect(login.response.status).toBe(200)
    expect(login.body.user).toMatchObject({
      email: 'password@example.com',
      provider: 'password',
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
      '/login?redirect_uri=oneworks%3A%2F%2Frelay%2Fauth%3Fworkspace%3D%252Fworkspace%26scope%3Drelay&server_id=prod',
      {
        headers: {
          'accept-language': 'en-US,en;q=0.9'
        }
      }
    )
    const body = await response.text()
    const config = readLoginConfig(body)

    expect(response.status).toBe(200)
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
    expect(config.passwordLoginUrl).toBe('/api/auth/password-login')
    expect(body).toContain(encodeURIComponent('https://relay.example/login/complete'))
    expect(config.redirectUri).toContain('oneworks://relay/auth')
  })

  it('omits empty login page sections for missing local accounts and SSO providers', async () => {
    const { baseUrl } = await listenRelay()
    const redirect = encodeURIComponent('https://app.example/callback')
    const response = await requestRaw(baseUrl, `/login?redirect_uri=${redirect}&lang=zh-CN`)
    const body = await response.text()
    const config = readLoginConfig(body)

    expect(response.status).toBe(200)
    expect(body).toContain('id="relay-login-root"')
    expect(body).not.toContain('data-account-section hidden')
    expect(body).not.toContain('这个浏览器还没有记住任何账号。')
    expect(config.providers).toEqual([])
    expect(config.locale).toBe('zh-CN')
    expect(body).not.toContain('还没有配置可用的 SSO 提供方。')
    expect(body).not.toContain('<div class="relay-login__providers">')
    expect(body).toContain('密码')
    expect(body).toContain('记住账号')
  })

  it('serves localized login completion failures', async () => {
    const { baseUrl } = await listenRelay({ oauth: googleOauth })
    const redirect = encodeURIComponent('https://app.example/callback')
    const response = await requestRaw(baseUrl, `/login/complete?redirect_uri=${redirect}&lang=zh-CN`)
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain('data-complete-title')
    expect(body).toContain('登录失败')
    expect(body).toContain('新账号登录需要邀请码。')
    expect(body).toContain('Invite required.')
  })

  it('localizes the login page from query params and browser language', async () => {
    const { baseUrl } = await listenRelay({ oauth: googleOauth })
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
    expect(zhBody).toContain('使用 google 登录')
    expect(enResponse.status).toBe(200)
    expect(enBody).toContain('<html lang="en">')
    expect(enBody).toContain('Recent accounts')
    expect(enBody).toContain('Sign in with google')
  })
})
