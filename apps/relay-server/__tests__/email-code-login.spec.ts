import { afterEach, describe, expect, it, vi } from 'vitest'

import { readRelayStore } from '../src/server.js'
import { writeRelayStore } from '../src/store.js'
import type { RelayEmailProvider, RelayEmailProviderInput } from '../src/types.js'
import { authHeaders, cleanupRelayFixtures, listenRelay, requestJson, requestRaw } from './helpers.js'

afterEach(async () => {
  vi.unstubAllGlobals()
  await cleanupRelayFixtures()
})

const emailConfig = () => ({
  provider: 'resend' as const,
  risk: {
    allowDomains: [],
    blockDomains: [],
    codeTtlMs: 10 * 60 * 1000,
    dailyBudget: 500,
    disposableBlocklist: true,
    enabled: true,
    monthlyBudget: 10_000,
    perDomain: {
      max: 100,
      windowMs: 60 * 60 * 1000
    },
    perEmail: {
      max: 3,
      windowMs: 60 * 60 * 1000
    },
    perIp: {
      max: 30,
      windowMs: 60 * 60 * 1000
    },
    resendCooldownMs: 60 * 1000
  },
  turnstile: {
    mode: 'off' as const
  }
})

const createEmailProvider = () => {
  const sent: RelayEmailProviderInput[] = []
  const provider: RelayEmailProvider = {
    sendVerificationCode: vi.fn(async input => {
      sent.push(input)
      return { messageId: `email-${sent.length}` }
    })
  }
  return {
    provider,
    sent
  }
}

const readLoginConfig = (html: string) => {
  const match = /<script type="application\/json" id="relay-login-config">([^<]+)<\/script>/.exec(html)
  expect(match?.[1]).toBeDefined()
  return JSON.parse(match?.[1] ?? '{}') as {
    emailCodeLoginUrl?: string
    loginMethods?: {
      default?: string
      enabled?: string[]
    }
  }
}

describe('relay email verification code login', () => {
  it('creates login sessions for existing users', async () => {
    const { provider, sent } = createEmailProvider()
    const { args, baseUrl } = await listenRelay({
      email: emailConfig(),
      emailProvider: provider
    })
    await requestJson(baseUrl, '/api/admin/users', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({
        email: 'code-login@example.com',
        loginId: 'code-user',
        name: 'Code Login',
        role: 'member'
      })
    })
    const send = await requestJson(baseUrl, '/api/auth/email-verification/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        loginId: 'code-user',
        purpose: 'login'
      })
    })
    const rejected = await requestJson(baseUrl, '/api/auth/email-code-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: '000000',
        loginId: 'code-user'
      })
    })
    const login = await requestJson(baseUrl, '/api/auth/email-code-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: sent[0]?.code,
        loginId: 'code-user'
      })
    })
    const token = String(login.body.token)
    const me = await requestJson(baseUrl, '/api/auth/me', {
      headers: authHeaders(token)
    })
    const store = await readRelayStore(args.dataPath)

    expect(send.response.status).toBe(200)
    expect(sent[0]).toMatchObject({
      email: 'code-login@example.com',
      purpose: 'login'
    })
    expect(rejected.response.status).toBe(401)
    expect(rejected.body).toEqual({
      code: 'invalid_email_code',
      error: 'Invalid email or verification code.'
    })
    expect(login.response.status).toBe(200)
    expect(login.body.user).toMatchObject({
      email: 'code-login@example.com',
      loginId: 'code-user',
      role: 'member'
    })
    expect(me.response.status).toBe(200)
    expect(me.body.user).toMatchObject({ email: 'code-login@example.com' })
    expect(store.emailRisk.challenges[0]?.verifiedAt).toBeDefined()
  })

  it('does not send login codes for SSO-only accounts with the same email', async () => {
    const { provider, sent } = createEmailProvider()
    const { args, baseUrl } = await listenRelay({
      email: emailConfig(),
      emailProvider: provider
    })
    const store = await readRelayStore(args.dataPath)
    store.users.push({
      createdAt: '2026-01-01T00:00:00.000Z',
      email: 'sso-only@example.com',
      id: 'sso-user',
      loginId: 'sso-only',
      name: 'SSO Only',
      provider: 'google',
      providerUserId: 'google-sso-only',
      role: 'member'
    })
    await writeRelayStore(args.dataPath, store)

    const send = await requestJson(baseUrl, '/api/auth/email-verification/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'sso-only@example.com',
        purpose: 'login'
      })
    })
    const login = await requestJson(baseUrl, '/api/auth/email-code-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: '000000',
        email: 'sso-only@example.com'
      })
    })

    expect(send.response.status).toBe(400)
    expect(send.body).toEqual({
      code: 'email_required',
      error: 'Email required.'
    })
    expect(sent).toEqual([])
    expect(login.response.status).toBe(400)
    expect(login.body).toEqual({
      code: 'email_required',
      error: 'Email required.'
    })
  })

  it('adds email code to the login method config when enabled', async () => {
    const { provider } = createEmailProvider()
    const { baseUrl } = await listenRelay({
      allowOrigin: 'https://app.example',
      defaultLoginMethod: 'verification_code',
      email: emailConfig(),
      emailProvider: provider
    })
    const response = await requestRaw(
      baseUrl,
      `/login?redirect_uri=${encodeURIComponent('https://app.example/callback')}&lang=en`
    )
    const config = readLoginConfig(await response.text())

    expect(response.status).toBe(200)
    expect(config.emailCodeLoginUrl).toBe('/api/auth/email-code-login')
    expect(config.loginMethods).toEqual({
      default: 'verification_code',
      enabled: ['password', 'passkey', 'verification_code']
    })
  })
})
