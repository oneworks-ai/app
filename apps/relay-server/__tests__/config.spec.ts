import { afterEach, describe, expect, it, vi } from 'vitest'

import { VERSION, parseRelayServerArgs, printRelayServerHelp } from '../src/server.js'

// eslint-disable-next-line ts/no-require-imports
const relayServerPackage = require('../package.json') as { version: string }

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('relay server config', () => {
  it('uses the package version for public server version output', () => {
    expect(VERSION).toBe(relayServerPackage.version)
  })

  it('parses CLI args and prints help without starting a server', () => {
    vi.stubEnv('ONEWORKS_RELAY_HOST', '0.0.0.0')
    vi.stubEnv('ONEWORKS_RELAY_ADMIN_TOKEN', 'env-admin')

    const args = parseRelayServerArgs([
      '--port',
      '9999',
      '--data',
      './relay.json',
      '--admin-token',
      'cli-admin',
      '--help'
    ])
    const output: string[] = []

    printRelayServerHelp(message => output.push(message))

    expect(args).toMatchObject({
      adminToken: 'cli-admin',
      dataPath: './relay.json',
      help: true,
      host: '0.0.0.0',
      port: 9999
    })
    expect(output.join('')).toContain(`OneWorks Relay Server ${VERSION}`)
  })

  it('parses email delivery risk and Turnstile environment settings', () => {
    vi.stubEnv('ONEWORKS_RELAY_EMAIL_PROVIDER', 'resend')
    vi.stubEnv('ONEWORKS_RELAY_EMAIL_FROM', 'Relay <relay@example.com>')
    vi.stubEnv('ONEWORKS_RELAY_RESEND_API_KEY', 'test-key')
    vi.stubEnv('ONEWORKS_RELAY_EMAIL_TURNSTILE_MODE', 'required')
    vi.stubEnv('ONEWORKS_RELAY_TURNSTILE_SECRET_KEY', 'turnstile-secret')
    vi.stubEnv('ONEWORKS_RELAY_EMAIL_RISK_EMAIL_MAX', '2')
    vi.stubEnv('ONEWORKS_RELAY_EMAIL_RISK_EMAIL_WINDOW_SECONDS', '120')
    vi.stubEnv('ONEWORKS_RELAY_EMAIL_RISK_DAILY_BUDGET', '9')
    vi.stubEnv('ONEWORKS_RELAY_EMAIL_DOMAIN_ALLOWLIST', 'example.com, trusted.test')
    vi.stubEnv('ONEWORKS_RELAY_EMAIL_DOMAIN_BLOCKLIST', 'blocked.test')

    const args = parseRelayServerArgs([])

    expect(args.email).toMatchObject({
      from: 'Relay <relay@example.com>',
      logoUrl: 'https://oneworks.cloud/pwa/pwa-icon-192.png',
      provider: 'resend',
      resendApiKey: 'test-key',
      risk: {
        allowDomains: ['example.com', 'trusted.test'],
        blockDomains: ['blocked.test'],
        dailyBudget: 9,
        perEmail: {
          max: 2,
          windowMs: 120_000
        }
      },
      turnstile: {
        mode: 'required',
        secretKey: 'turnstile-secret'
      }
    })
  })

  it('parses transactional email logo URL overrides', () => {
    expect(parseRelayServerArgs([], {}).email?.logoUrl).toBe('https://oneworks.cloud/pwa/pwa-icon-192.png')
    expect(
      parseRelayServerArgs([], {
        ONEWORKS_RELAY_EMAIL_LOGO_URL: 'https://cdn.example.com/relay-logo.png'
      }).email?.logoUrl
    ).toBe('https://cdn.example.com/relay-logo.png')
    expect(parseRelayServerArgs([], { ONEWORKS_RELAY_EMAIL_LOGO_URL: 'off' }).email?.logoUrl).toBeUndefined()
  })

  it('parses login method and passkey email verification environment settings', () => {
    const args = parseRelayServerArgs([], {
      ONEWORKS_RELAY_DEFAULT_LOGIN_METHOD: 'verification-code',
      ONEWORKS_RELAY_PASSKEY_EMAIL_VERIFICATION_REQUIRED: 'off'
    })

    expect(args.defaultLoginMethod).toBe('verification_code')
    expect(args.passkey).toMatchObject({
      emailVerificationRequired: false
    })
  })
})
