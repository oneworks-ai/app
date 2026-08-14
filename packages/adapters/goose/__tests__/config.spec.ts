import { describe, expect, it } from 'vitest'

import { adapterConfigContribution, gooseAdapterConfigSchema } from '../src/config-schema'

describe('goose adapter config contribution', () => {
  it('registers the goose key and validates native CLI/runtime fields', () => {
    expect(adapterConfigContribution.adapterKey).toBe('goose')
    expect(gooseAdapterConfigSchema.parse({
      cli: {
        source: 'managed',
        version: '1.46.0',
        variant: 'standard',
        autoInstall: false,
        prepareOnInstall: true
      },
      provider: 'anthropic',
      mode: 'approve',
      inheritNativeAuth: true
    })).toEqual(expect.objectContaining({
      provider: 'anthropic',
      mode: 'approve',
      inheritNativeAuth: true
    }))
  })

  it('does not expose npm package/path fields for the official-release installer', () => {
    const parsed = gooseAdapterConfigSchema.safeParse({
      cli: { package: '@untrusted/goose', npmPath: '/tmp/npm' }
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.cli).not.toHaveProperty('package')
      expect(parsed.data.cli).not.toHaveProperty('npmPath')
    }
  })
})
