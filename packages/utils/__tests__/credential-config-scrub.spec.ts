import { Buffer } from 'node:buffer'

import { describe, expect, it, vi } from 'vitest'

import { scrubCredentialConfigForPersistence } from '#~/credential-config-scrub.js'

describe('credential config persistence scrub', () => {
  it('removes nested key-aware credentials while preserving short, empty, and routing metadata', () => {
    const input = {
      theme: 'dark',
      emptyLabel: '',
      shortCode: 'x',
      tokenBudget: 4096,
      apiKey: 'x',
      nested: {
        password: '',
        region: 'us-east-1',
        byok: {
          openai: 'short-secret',
          anthropic: {
            apiKey: 'credential-v5-nested',
            baseUrl: 'https://example.invalid/v1',
            model: 'model-safe',
            metadata: { region: 'eu-west-1' }
          }
        }
      }
    }

    expect(scrubCredentialConfigForPersistence(input)).toEqual({
      theme: 'dark',
      emptyLabel: '',
      shortCode: 'x',
      tokenBudget: 4096,
      nested: {
        region: 'us-east-1',
        byok: {
          anthropic: {
            baseUrl: 'https://example.invalid/v1',
            model: 'model-safe',
            metadata: { region: 'eu-west-1' }
          }
        }
      }
    })
    expect(input.nested.byok.openai).toBe('short-secret')
    expect(input.nested.byok.anthropic.apiKey).toBe('credential-v5-nested')
  })

  it('scrubs JSON, URI, form, base64, and base64url credential representations', () => {
    const encodedJson = Buffer.from(JSON.stringify({ apiKey: 'credential-v5-base64', region: 'us' })).toString('base64')
    const encodedForm = Buffer.from('token=credential-v5-base64url&region=eu').toString('base64url')
    const output = scrubCredentialConfigForPersistence({
      json: JSON.stringify({ token: 'credential-v5-json', region: 'ap' }),
      uri: 'https://user:password@example.invalid/v1?api_key=credential-v5-uri&region=us',
      form: 'access_token=credential-v5-form&region=eu',
      encodedJson,
      encodedForm,
      raw: 'Authorization: Bearer credential-v5-raw'
    }) as Record<string, string>

    expect(JSON.parse(output.json)).toEqual({ region: 'ap' })
    expect(output.uri).toContain('region=us')
    expect(output.uri).not.toContain('user')
    expect(output.uri).not.toContain('password')
    expect(output.uri).not.toContain('api_key')
    expect(output.form).toBe('region=eu')
    expect(JSON.parse(Buffer.from(output.encodedJson, 'base64').toString('utf8'))).toEqual({ region: 'us' })
    expect(Buffer.from(output.encodedForm, 'base64url').toString('utf8')).toBe('region=eu')
    expect(output).not.toHaveProperty('raw')
    expect(JSON.stringify(output)).not.toContain('credential-v5')
  })

  it('projects Map, Set, Error, arrays, buffers, and object keys without invoking code', () => {
    const getter = vi.fn(() => 'credential-v5-getter')
    const toJson = vi.fn(() => ({ token: 'credential-v5-to-json' }))
    const error = new Error('safe error') as Error & { apiKey?: string; code?: string }
    error.apiKey = 'credential-v5-error'
    error.code = 'SAFE_CODE'
    const objectWithCode = Object.create(null) as Record<string, unknown>
    Object.defineProperty(objectWithCode, 'getter', { enumerable: true, get: getter })
    objectWithCode.toJSON = toJson
    objectWithCode['apiKey=credential-v5-object-key'] = 'must-not-persist'
    objectWithCode.safe = 'visible'
    const shared = { region: 'shared-region', token: 'credential-v5-shared' }

    const output = scrubCredentialConfigForPersistence({
      map: new Map<string, unknown>([
        ['apiKey', 'credential-v5-map'],
        ['region', 'us'],
        ['raw', 'token=credential-v5-map-form&region=eu']
      ]),
      set: new Set(['visible', 'Bearer credential-v5-set']),
      error,
      array: [{ secret: 'credential-v5-array' }, { model: 'safe-model' }],
      buffer: Buffer.from('Authorization: Bearer credential-v5-buffer'),
      objectWithCode,
      sharedFirst: shared,
      sharedSecond: shared
    })

    expect(output).toEqual({
      map: { region: 'us', raw: 'region=eu' },
      set: ['visible'],
      error: { code: 'SAFE_CODE' },
      array: [{}, { model: 'safe-model' }],
      objectWithCode: { safe: 'visible' },
      sharedFirst: { region: 'shared-region' },
      sharedSecond: { region: 'shared-region' }
    })
    expect(getter).not.toHaveBeenCalled()
    expect(toJson).not.toHaveBeenCalled()
    expect(JSON.stringify(output)).not.toContain('credential-v5')
  })
})
