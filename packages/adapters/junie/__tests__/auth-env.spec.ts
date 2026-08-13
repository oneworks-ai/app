import { Buffer } from 'node:buffer'

import { describe, expect, it, vi } from 'vitest'

import {
  JUNIE_AUTH_ENV_KEYS,
  JUNIE_PROVIDER_AUTH_ENV_KEYS,
  JUNIE_PROVIDER_ROUTING_ENV_KEYS,
  collectJunieAuthEnvironmentValues,
  isJunieAuthEnvironmentKey,
  isJunieRuntimeEnvironmentKey,
  resolveJunieAuthEnvironmentKeys,
  resolveJunieRuntimeEnvironmentKeys,
  scrubJunieAuthEnvironmentForPersistence,
  scrubJunieAuthValuesForPersistence
} from '#~/auth-env.js'

const EXPECTED_AUTH_KEYS = [
  'JUNIE_API_KEY',
  'JUNIE_OPENAI_API_KEY',
  'OPENAI_API_KEY',
  'JUNIE_ANTHROPIC_API_KEY',
  'ANTHROPIC_API_KEY',
  'JUNIE_GOOGLE_API_KEY',
  'GOOGLE_API_KEY',
  'JUNIE_GROK_API_KEY',
  'GROK_API_KEY',
  'JUNIE_OPENROUTER_API_KEY',
  'OPENROUTER_API_KEY',
  'JUNIE_LITELLM_API_KEY',
  'LITELLM_API_KEY'
] as const

describe('junie authentication environment persistence boundary', () => {
  it('uses one complete classifier for provider selection and persistence', () => {
    expect(JUNIE_AUTH_ENV_KEYS).toEqual(EXPECTED_AUTH_KEYS)
    expect(Object.keys(JUNIE_PROVIDER_AUTH_ENV_KEYS)).toEqual([
      'openai',
      'anthropic',
      'google',
      'xai',
      'openrouter',
      'copilot',
      'litellm'
    ])
    expect(resolveJunieAuthEnvironmentKeys('anthropic')).toEqual([
      'JUNIE_API_KEY',
      'JUNIE_ANTHROPIC_API_KEY',
      'ANTHROPIC_API_KEY'
    ])
    expect(resolveJunieAuthEnvironmentKeys('copilot')).toEqual(['JUNIE_API_KEY'])
    expect(resolveJunieRuntimeEnvironmentKeys('litellm')).toEqual([
      'JUNIE_API_KEY',
      'JUNIE_LITELLM_API_KEY',
      'LITELLM_API_KEY',
      'JUNIE_LITELLM_URL'
    ])
    expect(JUNIE_PROVIDER_ROUTING_ENV_KEYS.litellm).toEqual(['JUNIE_LITELLM_URL'])
    expect(EXPECTED_AUTH_KEYS.every(isJunieAuthEnvironmentKey)).toBe(true)
    expect(isJunieAuthEnvironmentKey('openai_api_key')).toBe(true)
    expect(isJunieAuthEnvironmentKey('JUNIE_LITELLM_URL')).toBe(false)
    expect(isJunieRuntimeEnvironmentKey('JUNIE_LITELLM_URL')).toBe(true)
    expect(isJunieAuthEnvironmentKey('AZURE_OPENAI_API_KEY')).toBe(false)
  })

  it('removes every supported key and encoded echo without mutating live env metadata', () => {
    const credentialEntries = Object.fromEntries(
      EXPECTED_AUTH_KEYS.map(key => [key, `credential-v6-${key.toLowerCase()}`])
    )
    const primarySecret = credentialEntries.JUNIE_API_KEY
    const input = {
      PATH: '/usr/bin',
      LANG: 'C.UTF-8',
      HTTPS_PROXY: 'https://proxy.example.invalid',
      __ONEWORKS_PROJECT_CTX_ID__: 'ctx-v6',
      JUNIE_LITELLM_URL: 'https://litellm.example.invalid/v1',
      ...credentialEntries,
      rawEcho: `prefix:${primarySecret}:suffix`,
      jsonEcho: JSON.stringify({ JUNIE_API_KEY: primarySecret, region: 'us' }),
      uriEcho: `https://example.invalid?v=${encodeURIComponent(primarySecret)}&region=eu`,
      formEcho: `OPENAI_API_KEY=${credentialEntries.OPENAI_API_KEY}&region=ap`,
      base64Echo: Buffer.from(JSON.stringify({ echo: primarySecret, region: 'ca' })).toString('base64'),
      base64urlEcho: Buffer.from(primarySecret).toString('base64url')
    }

    const output = scrubJunieAuthEnvironmentForPersistence(input)
    const persisted = JSON.stringify(output)
    for (const [key, value] of Object.entries(credentialEntries)) {
      expect(output).not.toHaveProperty(key)
      expect(persisted).not.toContain(value)
      expect(input).toHaveProperty(key, value)
    }
    expect(output).toMatchObject({
      PATH: '/usr/bin',
      LANG: 'C.UTF-8',
      HTTPS_PROXY: 'https://proxy.example.invalid',
      __ONEWORKS_PROJECT_CTX_ID__: 'ctx-v6',
      JUNIE_LITELLM_URL: 'https://litellm.example.invalid/v1'
    })
    expect(JSON.parse(String(output.jsonEcho))).toEqual({ region: 'us' })
    expect(String(output.uriEcho)).toContain('region=eu')
    expect(output.formEcho).toBe('region=ap')
    expect(JSON.parse(Buffer.from(String(output.base64Echo), 'base64').toString('utf8'))).toEqual({
      echo: '[REDACTED]',
      region: 'ca'
    })
    expect(Buffer.from(String(output.base64urlEcho), 'base64url').toString('utf8')).toBe('[REDACTED]')
  })

  it('scrubs object, Error, Map, Set, key, and shared-reference surfaces without invoking code', () => {
    const secret = 'credential-v6-object-surface'
    const getter = vi.fn(() => secret)
    const toJSON = vi.fn(() => ({ JUNIE_API_KEY: secret }))
    const object = Object.create(null) as Record<string, unknown>
    Object.defineProperty(object, 'getter', { enumerable: true, get: getter })
    object.toJSON = toJSON
    object[`echo-${secret}`] = 'hidden'
    object.region = 'us'
    const error = Object.assign(new Error(secret), { echo: secret, code: 'SAFE' })
    const shared = { echo: secret, region: 'shared' }
    const input = {
      map: new Map([['JUNIE_API_KEY', secret], ['region', 'eu'], ['echo', secret]]),
      set: new Set(['visible', secret]),
      error,
      object,
      sharedFirst: shared,
      sharedSecond: shared,
      shortSafe: 'x',
      emptySafe: ''
    }

    const output = scrubJunieAuthValuesForPersistence(input, [secret, 'x', ''])
    expect(output).toEqual({
      map: { region: 'eu', echo: '[REDACTED]' },
      set: ['visible', '[REDACTED]'],
      error: { echo: '[REDACTED]', code: 'SAFE' },
      object: { region: 'us' },
      sharedFirst: { echo: '[REDACTED]', region: 'shared' },
      sharedSecond: { echo: '[REDACTED]', region: 'shared' },
      shortSafe: 'x',
      emptySafe: ''
    })
    expect(getter).not.toHaveBeenCalled()
    expect(toJSON).not.toHaveBeenCalled()
    expect(JSON.stringify(output)).not.toContain(secret)
  })

  it('removes every long secret copy from mixed URL, form, JSON, and base64 representations', () => {
    const first = 'credential-v7-first:/?#[]@!$&'
    const second = 'credential-v7-second:+,;='
    const short = 'tiny'
    const mixedUrl = `https://user:${encodeURIComponent(first)}@example.invalid/route/${
      encodeURIComponent(first)
    }?JUNIE_API_KEY=${encodeURIComponent(second)}&keep=visible#fragment-${encodeURIComponent(second)}`
    const mixedForm = `JUNIE_OPENAI_API_KEY=${encodeURIComponent(first)}&note=prefix-${
      encodeURIComponent(second)
    }-suffix&keep=form`
    const encoded = Buffer.from(JSON.stringify({
      mixedUrl,
      echo: second,
      keep: 'encoded'
    })).toString('base64')
    const input = {
      mixedUrl,
      mixedForm,
      encoded,
      json: JSON.stringify({ mixedUrl, mixedForm, keep: 'json' }),
      shortMixedUrl: `https://example.invalid/${short}?JUNIE_API_KEY=${short}#${short}`
    }
    const snapshot = structuredClone(input)

    const output = scrubJunieAuthValuesForPersistence(input, [first, second, short]) as typeof input
    const persisted = JSON.stringify(output)
    for (const secret of [first, second]) {
      expect(persisted).not.toContain(secret)
      expect(persisted).not.toContain(encodeURIComponent(secret))
    }
    expect(output.mixedUrl).toContain('/route/[REDACTED]')
    expect(output.mixedUrl).toContain('keep=visible')
    expect(output.mixedUrl).toContain('#fragment-[REDACTED]')
    expect(output.mixedForm).toBe('note=prefix-[REDACTED]-suffix&keep=form')
    expect(JSON.parse(Buffer.from(output.encoded, 'base64').toString('utf8'))).toEqual({
      mixedUrl: expect.stringContaining('/route/[REDACTED]'),
      echo: '[REDACTED]',
      keep: 'encoded'
    })
    expect(JSON.parse(output.json)).toMatchObject({ keep: 'json' })
    expect(output.shortMixedUrl).toContain(`/${short}`)
    expect(output.shortMixedUrl).not.toContain('JUNIE_API_KEY')
    expect(output.shortMixedUrl).toContain(`#${short}`)
    expect(input).toEqual(snapshot)
  })

  it('collects only exact supported non-empty string values', () => {
    expect(collectJunieAuthEnvironmentValues({
      JUNIE_API_KEY: 'one',
      openai_api_key: 'two',
      ANTHROPIC_API_KEY: '',
      GOOGLE_API_KEY: null,
      AZURE_OPENAI_API_KEY: 'unrelated'
    })).toEqual(['one', 'two'])
  })
})
