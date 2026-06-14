import { afterEach, describe, expect, it, vi } from 'vitest'

import { createResendRelayEmailProvider } from '../src/email/provider.js'
import { buildRelayEmailPayload } from '../src/email/template.js'
import type { RelayEmailConfig, RelayEmailRiskConfig } from '../src/types.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
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

const emailConfig = (): RelayEmailConfig => ({
  from: 'One Works <verify@mail.oneworks.cloud>',
  logoUrl: 'https://oneworks.cloud/pwa/pwa-icon-192.png',
  provider: 'resend',
  resendApiKey: 'test-resend-key',
  risk: defaultRisk(),
  turnstile: {
    mode: 'off'
  }
})

const parseJsonBody = (body: unknown): Record<string, unknown> => {
  expect(typeof body).toBe('string')
  return JSON.parse(body as string) as Record<string, unknown>
}

describe('relay email provider', () => {
  it('builds a standardized text and HTML verification email', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T08:00:00.000Z'))

    const payload = buildRelayEmailPayload(
      {
        code: '123456',
        email: 'member@example.com',
        expiresAt: '2026-06-14T08:10:00.000Z',
        purpose: 'login'
      },
      { logoUrl: 'https://oneworks.cloud/pwa/pwa-icon-192.png' }
    )

    expect(payload.subject).toBe('One Works sign-in code')
    expect(payload.text).toContain('One Works')
    expect(payload.text).toContain('Sign in to One Works')
    expect(payload.text).toContain('Verification code: 123456')
    expect(payload.text).toContain('This code expires in 10 minutes.')
    expect(payload.text).toContain('Never share this code with anyone.')
    expect(payload.text).toContain('https://oneworks.cloud/')
    expect(payload.text).toContain('https://oneworks.cloud/docs/')
    expect(payload.text).toContain('support@oneworks.cloud')
    expect(payload.html).toContain('<!doctype html>')
    expect(payload.html).toContain('<html lang="en">')
    expect(payload.html).toContain('One Works')
    expect(payload.html).not.toContain('OneWorks Relay')
    expect(payload.html).toContain('<img src="https://oneworks.cloud/pwa/pwa-icon-192.png"')
    expect(payload.html).toContain('alt="One Works"')
    expect(payload.html).toContain('Sign in to One Works')
    expect(payload.html).toContain('Verification code')
    expect(payload.html).toContain('1 2 3 4 5 6')
    expect(payload.html).toContain('This code expires in 10 minutes.')
    expect(payload.html).toContain('href="https://oneworks.cloud/"')
    expect(payload.html).toContain('href="https://oneworks.cloud/docs/"')
    expect(payload.html).toContain('href="mailto:support@oneworks.cloud"')
  })

  it('builds localized Chinese verification emails', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T08:00:00.000Z'))

    const payload = buildRelayEmailPayload({
      code: '123456',
      email: 'member@example.com',
      expiresAt: '2026-06-14T08:10:00.000Z',
      locale: 'zh-CN',
      purpose: 'login'
    })

    expect(payload.subject).toBe('One Works 登录验证码')
    expect(payload.text).toContain('登录 One Works')
    expect(payload.text).toContain('验证码: 123456')
    expect(payload.text).toContain('验证码将在 10 分钟后过期。')
    expect(payload.text).toContain('官网: https://oneworks.cloud/')
    expect(payload.html).toContain('<html lang="zh-CN">')
    expect(payload.html).toContain('登录 One Works')
    expect(payload.html).toContain('验证码')
    expect(payload.html).toContain('官网')
    expect(payload.html).toContain('文档')
    expect(payload.html).toContain('支持')
  })

  it('escapes dynamic email template content in HTML', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T08:00:00.000Z'))

    const payload = buildRelayEmailPayload({
      code: '12<3&4',
      email: 'member@example.com',
      expiresAt: '2026-06-14T08:01:00.000Z',
      purpose: 'email-verification'
    })

    expect(payload.text).toContain('Verification code: 12<3&4')
    expect(payload.html).toContain('1 2 &lt; 3 &amp; 4')
    expect(payload.html).not.toContain('12<3&4')
  })

  it('sends both HTML and text payloads through Resend', async () => {
    let requestBody: Record<string, unknown> | undefined
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = parseJsonBody(init?.body)
      return new Response(JSON.stringify({ id: 'email-message-1' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = createResendRelayEmailProvider(emailConfig())
    const result = await provider.sendVerificationCode({
      code: '654321',
      email: 'member@example.com',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      purpose: 'email-verification'
    })

    expect(result).toEqual({ messageId: 'email-message-1' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST'
      })
    )
    expect(requestBody).toMatchObject({
      from: 'One Works <verify@mail.oneworks.cloud>',
      subject: 'One Works verification code',
      text: expect.stringContaining('Verification code: 654321'),
      to: ['member@example.com']
    })
    expect(requestBody?.html).toEqual(expect.stringContaining('6 5 4 3 2 1'))
    expect(requestBody?.html).toEqual(expect.stringContaining('Verify your email address'))
    expect(requestBody?.html).toEqual(expect.not.stringContaining('OneWorks Relay'))
    expect(requestBody?.html).toEqual(expect.stringContaining('https://oneworks.cloud/pwa/pwa-icon-192.png'))
  })
})
