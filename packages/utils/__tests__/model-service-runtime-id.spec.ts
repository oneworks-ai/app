import { describe, expect, it } from 'vitest'

import type { ModelServiceConfig } from '@oneworks/types'

import { buildModelServiceRuntimeId, flattenModelServices, resolveModelServiceFromMap } from '#~/model-providers.js'

describe('model service runtime id', () => {
  it('keeps legacy keys and creates collision-safe ids for Profile selectors', () => {
    expect(buildModelServiceRuntimeId('deepseek-2')).toBe('deepseek-2')
    expect(buildModelServiceRuntimeId('deepseek/work')).toMatch(/^deepseek-work-[a-f0-9]{8}$/u)
    expect(buildModelServiceRuntimeId('deepseek/work')).not.toBe(buildModelServiceRuntimeId('deepseek-work'))
  })

  it('gives an exact standalone key precedence over a colliding Profile selector', () => {
    const services: Record<string, ModelServiceConfig> = {
      relay: {
        kind: 'collection',
        provider: 'micu',
        profiles: {
          work: { apiKey: 'profile-token' }
        }
      },
      'relay/work': {
        apiBaseUrl: 'https://standalone.example.com/v1',
        apiKey: 'standalone-token'
      }
    }

    expect(resolveModelServiceFromMap(services, 'relay/work')?.apiKey).toBe('standalone-token')
    expect(flattenModelServices(services)['relay/work']?.apiKey).toBe('standalone-token')
  })
})
