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
  })
})
