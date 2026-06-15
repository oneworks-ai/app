import { afterEach, describe, expect, it, vi } from 'vitest'

import { readRelayStore } from '../src/server.js'
import type {
  RelayEmailConfig,
  RelayEmailProvider,
  RelayEmailProviderInput,
  RelayEmailRiskConfig,
  RelayTurnstileConfig
} from '../src/types.js'
import { authHeaders, cleanupRelayFixtures, listenRelay, requestJson, requestRaw } from './helpers.js'

vi.mock('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: vi.fn(async input => ({
    allowCredentials: input.allowCredentials ?? [],
    challenge: 'authentication-challenge',
    rpId: input.rpID,
    timeout: input.timeout
  })),
  generateRegistrationOptions: vi.fn(async input => ({
    challenge: 'registration-challenge',
    pubKeyCredParams: [],
    rp: {
      id: input.rpID,
      name: input.rpName
    },
    user: {
      displayName: input.userDisplayName ?? input.userName,
      id: 'test-user-id',
      name: input.userName
    }
  })),
  verifyAuthenticationResponse: vi.fn(async () => ({
    authenticationInfo: {
      credentialBackedUp: true,
      credentialDeviceType: 'multiDevice',
      credentialID: 'credential-1',
      newCounter: 1,
      origin: 'http://127.0.0.1',
      rpID: '127.0.0.1',
      userVerified: true
    },
    verified: true
  })),
  verifyRegistrationResponse: vi.fn(async () => ({
    registrationInfo: {
      attestationObject: new Uint8Array(),
      credential: {
        counter: 0,
        id: 'credential-1',
        publicKey: new Uint8Array([1, 2, 3]),
        transports: ['internal']
      },
      credentialBackedUp: true,
      credentialDeviceType: 'multiDevice',
      credentialType: 'public-key',
      fmt: 'none',
      origin: 'http://127.0.0.1',
      rpID: '127.0.0.1',
      userVerified: true
    },
    verified: true
  }))
}))

afterEach(async () => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  await cleanupRelayFixtures()
})

const defaultRisk = (): RelayEmailRiskConfig => ({
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
})

const emailConfig = (input: {
  provider?: RelayEmailConfig['provider']
  risk?: Partial<RelayEmailRiskConfig>
  turnstile?: Partial<RelayTurnstileConfig>
} = {}): RelayEmailConfig => {
  const risk = defaultRisk()
  return {
    provider: input.provider ?? 'disabled',
    risk: {
      ...risk,
      ...input.risk,
      perDomain: {
        ...risk.perDomain,
        ...input.risk?.perDomain
      },
      perEmail: {
        ...risk.perEmail,
        ...input.risk?.perEmail
      },
      perIp: {
        ...risk.perIp,
        ...input.risk?.perIp
      }
    },
    turnstile: {
      mode: 'off',
      ...input.turnstile
    }
  }
}

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

const sendEmailVerification = async (baseUrl: string, email: string) =>
  await requestJson(baseUrl, '/api/auth/email-verification/send', {
    body: JSON.stringify({
      email,
      purpose: 'email-verification'
    }),
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.44'
    },
    method: 'POST'
  })

const fakeRegistrationResponse = () => ({
  id: 'credential-1',
  rawId: 'credential-1',
  response: {},
  type: 'public-key'
})

const fakeAuthenticationResponse = () => ({
  id: 'credential-1',
  rawId: 'credential-1',
  response: {},
  type: 'public-key'
})

const readLoginConfig = (html: string) => {
  const match = /<script type="application\/json" id="relay-login-config">([^<]+)<\/script>/.exec(html)
  expect(match?.[1]).toBeDefined()
  return JSON.parse(match?.[1] ?? '{}') as {
    emailVerificationSendUrl?: string
    messages?: {
      passkeyTitle?: string
    }
    passkey?: {
      emailVerificationRequired?: boolean
      enabled?: boolean
      loginOptionsUrl?: string
      loginVerifyUrl?: string
      registrationMode?: string
      registerOptionsUrl?: string
      registerVerifyUrl?: string
    }
  }
}

describe('relay passkey auth routes', () => {
  it('exposes passkey login config to the localized login page', async () => {
    const { baseUrl } = await listenRelay({
      passkey: {
        emailVerificationRequired: true,
        enabled: true,
        registrationMode: 'email_verified',
        rpName: 'One Works',
        timeoutMs: 60_000
      }
    })
    const response = await requestRaw(
      baseUrl,
      `/login?redirect_uri=${encodeURIComponent('https://app.example/callback')}&lang=en`
    )
    const body = await response.text()
    const config = readLoginConfig(body)

    expect(response.status).toBe(200)
    expect(body).toContain('Sign in or register')
    expect(config.emailVerificationSendUrl).toBe('/api/auth/email-verification/send')
    expect(config.messages).toMatchObject({
      passkeyTitle: 'Sign in or register'
    })
    expect(config.passkey).toMatchObject({
      enabled: true,
      emailVerificationRequired: true,
      loginOptionsUrl: '/api/auth/passkey/login/options',
      loginVerifyUrl: '/api/auth/passkey/login/verify',
      registrationMode: 'email_verified',
      registerOptionsUrl: '/api/auth/passkey/register/options',
      registerVerifyUrl: '/api/auth/passkey/register/verify'
    })
  })

  it('registers and logs in with a verified email when invite gates are disabled', async () => {
    const { provider, sent } = createEmailProvider()
    const { args, baseUrl } = await listenRelay({
      email: emailConfig(),
      emailProvider: provider,
      passkey: {
        emailVerificationRequired: true,
        enabled: true,
        registrationMode: 'email_verified',
        rpName: 'One Works',
        timeoutMs: 60_000
      }
    })

    const email = 'owner@example.com'
    const send = await sendEmailVerification(baseUrl, email)
    const options = await requestJson(baseUrl, '/api/auth/passkey/register/options', {
      body: JSON.stringify({
        code: sent[0]?.code,
        credentialName: 'Laptop',
        email
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    })
    const registration = await requestJson(baseUrl, '/api/auth/passkey/register/verify', {
      body: JSON.stringify({
        credentialName: 'Laptop',
        email,
        response: fakeRegistrationResponse()
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    })
    const registrationUser = registration.body.user as { id: string }
    const loginIdUpdate = await requestJson(baseUrl, '/api/admin/users', {
      body: JSON.stringify({
        id: registrationUser.id,
        loginId: 'owner-login'
      }),
      headers: authHeaders(String(registration.body.token)),
      method: 'PATCH'
    })
    const loginOptions = await requestJson(baseUrl, '/api/auth/passkey/login/options', {
      body: JSON.stringify({ loginId: 'owner-login' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    })
    const login = await requestJson(baseUrl, '/api/auth/passkey/login/verify', {
      body: JSON.stringify({
        loginId: 'owner-login',
        response: fakeAuthenticationResponse()
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    })
    const store = await readRelayStore(args.dataPath)

    expect(send.response.status).toBe(200)
    expect(options.response.status).toBe(200)
    expect(options.body.options).toMatchObject({
      challenge: 'registration-challenge'
    })
    expect(registration.response.status).toBe(200)
    expect(registration.body.user).toMatchObject({
      email,
      provider: 'passkey',
      role: 'owner'
    })
    expect(typeof registration.body.token).toBe('string')
    expect(loginIdUpdate.response.status).toBe(200)
    expect(loginIdUpdate.body.user).toMatchObject({
      email,
      loginId: 'owner-login'
    })
    expect(loginOptions.response.status).toBe(200)
    expect(loginOptions.body.options).toMatchObject({
      challenge: 'authentication-challenge'
    })
    expect(login.response.status).toBe(200)
    expect(login.body.user).toMatchObject({
      email,
      loginId: 'owner-login',
      provider: 'passkey',
      role: 'owner'
    })
    expect(store.users).toHaveLength(1)
    expect(store.passkeys).toHaveLength(1)
    expect(store.passkeys[0]).toMatchObject({
      counter: 1,
      id: 'credential-1',
      name: 'Laptop',
      userId: store.users[0].id
    })
    expect(store.emailRisk.challenges[0]?.verifiedAt).toBeDefined()
    expect(store.passkeyChallenges).toHaveLength(0)
  })

  it('requires and consumes invites when passkey registration is invite gated', async () => {
    const { provider, sent } = createEmailProvider()
    const { args, baseUrl } = await listenRelay({
      email: emailConfig(),
      emailProvider: provider,
      passkey: {
        emailVerificationRequired: true,
        enabled: true,
        registrationMode: 'invite_required',
        rpName: 'One Works',
        timeoutMs: 60_000
      }
    })
    const email = 'member@example.com'
    await sendEmailVerification(baseUrl, email)

    const missingInvite = await requestJson(baseUrl, '/api/auth/passkey/register/options', {
      body: JSON.stringify({
        code: sent[0]?.code,
        email
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    })
    await requestJson(baseUrl, '/api/admin/invites', {
      body: JSON.stringify({
        code: 'passkey-member',
        maxUses: 1,
        role: 'member'
      }),
      headers: authHeaders('admin-token'),
      method: 'POST'
    })
    const options = await requestJson(baseUrl, '/api/auth/passkey/register/options', {
      body: JSON.stringify({
        code: sent[0]?.code,
        credentialName: 'Security Key',
        email,
        inviteCode: 'passkey-member'
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    })
    const registration = await requestJson(baseUrl, '/api/auth/passkey/register/verify', {
      body: JSON.stringify({
        credentialName: 'Security Key',
        email,
        response: fakeRegistrationResponse()
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    })
    const store = await readRelayStore(args.dataPath)

    expect(missingInvite.response.status).toBe(400)
    expect(missingInvite.body).toEqual({
      code: 'invite_required',
      error: 'Invite required.'
    })
    expect(options.response.status).toBe(200)
    expect(registration.response.status).toBe(200)
    expect(registration.body.user).toMatchObject({
      email,
      provider: 'passkey',
      role: 'member'
    })
    expect(store.invites[0]).toMatchObject({
      code: 'passkey-member',
      used: 1
    })
    expect(store.passkeys[0]).toMatchObject({
      id: 'credential-1',
      name: 'Security Key'
    })
  })

  it('can register a new passkey account without email verification when explicitly disabled', async () => {
    const { args, baseUrl } = await listenRelay({
      passkey: {
        emailVerificationRequired: false,
        enabled: true,
        registrationMode: 'email_verified',
        rpName: 'One Works',
        timeoutMs: 60_000
      }
    })
    const email = 'no-code@example.com'
    const options = await requestJson(baseUrl, '/api/auth/passkey/register/options', {
      body: JSON.stringify({
        credentialName: 'Local Passkey',
        email
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    })
    const registration = await requestJson(baseUrl, '/api/auth/passkey/register/verify', {
      body: JSON.stringify({
        credentialName: 'Local Passkey',
        email,
        response: fakeRegistrationResponse()
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    })
    const store = await readRelayStore(args.dataPath)

    expect(options.response.status).toBe(200)
    expect(registration.response.status).toBe(200)
    expect(registration.body.user).toMatchObject({
      email,
      provider: 'passkey',
      role: 'owner'
    })
    expect(store.emailRisk.challenges).toHaveLength(0)
    expect(store.passkeys[0]).toMatchObject({
      id: 'credential-1',
      name: 'Local Passkey'
    })
  })
})
