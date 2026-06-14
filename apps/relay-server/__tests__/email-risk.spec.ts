import { afterEach, describe, expect, it, vi } from 'vitest'

import { readRelayStore } from '../src/server.js'
import type {
  RelayEmailConfig,
  RelayEmailProvider,
  RelayEmailProviderInput,
  RelayEmailRiskConfig,
  RelayTurnstileConfig
} from '../src/types.js'
import { cleanupRelayFixtures, listenRelay, requestJson } from './helpers.js'

afterEach(async () => {
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

const sendEmailVerification = async (
  baseUrl: string,
  input: {
    acceptLanguage?: string
    email: string
    ip?: string
    locale?: string
    purpose?: string
    turnstileToken?: string
  }
) =>
  await requestJson(baseUrl, '/api/auth/email-verification/send', {
    body: JSON.stringify({
      email: input.email,
      locale: input.locale,
      purpose: input.purpose,
      turnstileToken: input.turnstileToken
    }),
    headers: {
      ...(input.acceptLanguage == null ? {} : { 'accept-language': input.acceptLanguage }),
      'content-type': 'application/json',
      'x-forwarded-for': input.ip ?? '203.0.113.10'
    },
    method: 'POST'
  })

describe('relay email send risk controls', () => {
  it('reuses an active TTL challenge without calling the provider again', async () => {
    const { provider, sent } = createEmailProvider()
    const { args, baseUrl } = await listenRelay({
      email: emailConfig(),
      emailProvider: provider
    })

    const first = await sendEmailVerification(baseUrl, { email: 'new-user@example.com' })
    const second = await sendEmailVerification(baseUrl, { email: 'new-user@example.com' })
    const store = await readRelayStore(args.dataPath)

    expect(first.response.status).toBe(200)
    expect(second.response.status).toBe(200)
    expect(provider.sendVerificationCode).toHaveBeenCalledTimes(1)
    expect(sent[0]).toMatchObject({
      email: 'new-user@example.com',
      locale: 'en',
      purpose: 'email-verification'
    })
    expect(sent[0]?.code).toMatch(/^\d{6}$/)
    expect(store.emailRisk.challenges).toHaveLength(1)
    expect(store.emailRisk.challenges[0]).not.toHaveProperty('email')
    expect(store.emailRisk.challenges[0]).toMatchObject({
      domain: 'example.com',
      providerMessageId: 'email-1',
      sendCount: 1
    })
  })

  it('passes the page locale to the email provider with Accept-Language fallback', async () => {
    const bodyLocaleProvider = createEmailProvider()
    const bodyLocaleRelay = await listenRelay({
      email: emailConfig({
        risk: {
          codeTtlMs: 1
        }
      }),
      emailProvider: bodyLocaleProvider.provider
    })

    await sendEmailVerification(bodyLocaleRelay.baseUrl, {
      acceptLanguage: 'en-US,en;q=0.9',
      email: 'zh-page@example.com',
      locale: 'zh-CN'
    })
    expect(bodyLocaleProvider.sent[0]).toMatchObject({
      email: 'zh-page@example.com',
      locale: 'zh-CN'
    })
    await cleanupRelayFixtures()

    const headerLocaleProvider = createEmailProvider()
    const headerLocaleRelay = await listenRelay({
      email: emailConfig(),
      emailProvider: headerLocaleProvider.provider
    })

    await sendEmailVerification(headerLocaleRelay.baseUrl, {
      acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.5',
      email: 'zh-header@example.com'
    })
    expect(headerLocaleProvider.sent[0]).toMatchObject({
      email: 'zh-header@example.com',
      locale: 'zh-CN'
    })
  })

  it('rate limits new sends for the same email after the active challenge expires', async () => {
    const { provider } = createEmailProvider()
    const { baseUrl } = await listenRelay({
      email: emailConfig({
        risk: {
          codeTtlMs: 1,
          perEmail: {
            max: 1,
            windowMs: 60 * 60 * 1000
          }
        }
      }),
      emailProvider: provider
    })

    const first = await sendEmailVerification(baseUrl, { email: 'same@example.com' })
    await new Promise(resolve => setTimeout(resolve, 5))
    const limited = await sendEmailVerification(baseUrl, { email: 'same@example.com' })

    expect(first.response.status).toBe(200)
    expect(limited.response.status).toBe(429)
    expect(limited.response.headers.get('retry-after')).toBe('3600')
    expect(limited.body).toEqual({
      code: 'email_send_rejected',
      error: 'Unable to send email right now.'
    })
    expect(JSON.stringify(limited.body)).not.toContain('same@example.com')
    expect(provider.sendVerificationCode).toHaveBeenCalledTimes(1)
  })

  it('rate limits sends for the same IP before the provider is called', async () => {
    const { provider } = createEmailProvider()
    const { baseUrl } = await listenRelay({
      email: emailConfig({
        risk: {
          perIp: {
            max: 1,
            windowMs: 60 * 1000
          }
        }
      }),
      emailProvider: provider
    })

    const first = await sendEmailVerification(baseUrl, {
      email: 'one@example.com',
      ip: '198.51.100.7'
    })
    const limited = await sendEmailVerification(baseUrl, {
      email: 'two@example.com',
      ip: '198.51.100.7'
    })

    expect(first.response.status).toBe(200)
    expect(limited.response.status).toBe(429)
    expect(provider.sendVerificationCode).toHaveBeenCalledTimes(1)
  })

  it('blocks disposable and configured domains while allowing explicit domain overrides only for domain policy', async () => {
    const blockedProvider = createEmailProvider()
    const blocked = await listenRelay({
      email: emailConfig(),
      emailProvider: blockedProvider.provider
    })
    const disposable = await sendEmailVerification(blocked.baseUrl, {
      email: 'temp@mailinator.com'
    })

    expect(disposable.response.status).toBe(400)
    expect(disposable.body).toEqual({
      code: 'email_send_rejected',
      error: 'Unable to send email right now.'
    })
    expect(blockedProvider.provider.sendVerificationCode).toHaveBeenCalledTimes(0)
    await cleanupRelayFixtures()

    const allowedProvider = createEmailProvider()
    const allowed = await listenRelay({
      email: emailConfig({
        risk: {
          allowDomains: ['mailinator.com'],
          blockDomains: ['mailinator.com'],
          perDomain: {
            max: 1,
            windowMs: 60 * 1000
          }
        }
      }),
      emailProvider: allowedProvider.provider
    })
    const first = await sendEmailVerification(allowed.baseUrl, {
      email: 'one@mailinator.com',
      ip: '203.0.113.20'
    })
    const limited = await sendEmailVerification(allowed.baseUrl, {
      email: 'two@mailinator.com',
      ip: '203.0.113.21'
    })

    expect(first.response.status).toBe(200)
    expect(limited.response.status).toBe(429)
    expect(allowedProvider.provider.sendVerificationCode).toHaveBeenCalledTimes(1)
  })

  it('enforces the global daily email budget across addresses and IPs', async () => {
    const { provider } = createEmailProvider()
    const { baseUrl } = await listenRelay({
      email: emailConfig({
        risk: {
          dailyBudget: 1
        }
      }),
      emailProvider: provider
    })

    const first = await sendEmailVerification(baseUrl, {
      email: 'first@example.com',
      ip: '198.51.100.10'
    })
    const limited = await sendEmailVerification(baseUrl, {
      email: 'second@example.com',
      ip: '198.51.100.11'
    })

    expect(first.response.status).toBe(200)
    expect(limited.response.status).toBe(429)
    expect(provider.sendVerificationCode).toHaveBeenCalledTimes(1)
  })

  it('requires successful Turnstile verification before risk state or provider calls', async () => {
    const { provider } = createEmailProvider()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 }))
    )
    const { args, baseUrl } = await listenRelay({
      email: emailConfig({
        turnstile: {
          mode: 'required',
          secretKey: 'turnstile-secret'
        }
      }),
      emailProvider: provider
    })

    const missing = await sendEmailVerification(baseUrl, {
      email: 'turnstile@example.com'
    })
    const failed = await sendEmailVerification(baseUrl, {
      email: 'turnstile@example.com',
      turnstileToken: 'bad-token'
    })
    const store = await readRelayStore(args.dataPath)

    expect(missing.response.status).toBe(400)
    expect(failed.response.status).toBe(400)
    expect(missing.body).toEqual(failed.body)
    expect(provider.sendVerificationCode).toHaveBeenCalledTimes(0)
    expect(store.emailRisk.buckets).toEqual([])
    expect(store.emailRisk.challenges).toEqual([])
  })

  it('fails closed when Turnstile is required but not configured', async () => {
    const { provider } = createEmailProvider()
    const { baseUrl } = await listenRelay({
      email: emailConfig({
        provider: 'resend',
        risk: {
          disposableBlocklist: false
        },
        turnstile: {
          mode: 'required'
        }
      }),
      emailProvider: provider
    })

    const response = await sendEmailVerification(baseUrl, {
      email: 'missing-turnstile@example.com',
      turnstileToken: 'token'
    })

    expect(response.response.status).toBe(503)
    expect(response.body).toEqual({
      code: 'email_send_unavailable',
      error: 'Unable to send email right now.'
    })
    expect(provider.sendVerificationCode).toHaveBeenCalledTimes(0)
  })
})
