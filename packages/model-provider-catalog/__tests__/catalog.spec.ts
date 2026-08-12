import { describe, expect, it } from 'vitest'

import { MODEL_PROVIDER_CATALOG, MODEL_PROVIDER_DEFINITIONS, validateModelProviderCatalog } from '#~/index.js'

describe('model provider catalog', () => {
  it('has unique provider ids and valid host matcher references', () => {
    expect(validateModelProviderCatalog(MODEL_PROVIDER_CATALOG)).toBe(MODEL_PROVIDER_CATALOG)
    expect(new Set(MODEL_PROVIDER_DEFINITIONS.map(provider => provider.id)).size)
      .toBe(MODEL_PROVIDER_DEFINITIONS.length)
  })

  it('rejects incompatible schemas and dangling host matchers', () => {
    expect(() => validateModelProviderCatalog({ ...MODEL_PROVIDER_CATALOG, schemaVersion: 2 }))
      .toThrow('Unsupported model provider catalog schema')
    expect(() =>
      validateModelProviderCatalog({
        ...MODEL_PROVIDER_CATALOG,
        hostMatchers: [{ provider: 'missing', hosts: ['example.com'] }]
      })
    ).toThrow('unknown provider: missing')
    expect(() =>
      validateModelProviderCatalog({
        ...MODEL_PROVIDER_CATALOG,
        providers: [{
          id: 'invalid',
          title: 'Invalid',
          category: 'custom',
          defaultApiProtocol: 'openai-compatible'
        }]
      })
    ).toThrow('invalid provider definitions')
  })

  it('keeps provider protocol defaults paired with their catalog base URLs', () => {
    expect(MODEL_PROVIDER_DEFINITIONS.find(provider => provider.id === 'openai')).toMatchObject({
      defaultApiBaseUrl: 'https://api.openai.com/v1',
      defaultApiProtocol: 'openai-responses'
    })
    expect(MODEL_PROVIDER_DEFINITIONS.find(provider => provider.id === 'anthropic')).toMatchObject({
      defaultApiBaseUrl: 'https://api.anthropic.com/v1',
      defaultApiProtocol: 'anthropic-messages'
    })
    expect(MODEL_PROVIDER_DEFINITIONS.find(provider => provider.id === 'google-gemini')).toMatchObject({
      defaultApiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      defaultApiProtocol: 'openai-chat-completions'
    })
  })

  it('keeps Moonshot and Kimi Code as distinct official brands', () => {
    expect(MODEL_PROVIDER_DEFINITIONS.find(provider => provider.id === 'moonshot-intl')?.icon)
      .toEqual({ kind: 'builtin', id: 'moonshot' })
    expect(MODEL_PROVIDER_DEFINITIONS.find(provider => provider.id === 'kimi-code')?.icon)
      .toEqual({ kind: 'builtin', id: 'kimi' })
  })
})
