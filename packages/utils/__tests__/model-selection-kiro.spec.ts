import { describe, expect, it } from 'vitest'

import { filterServiceModelsForAdapter, listServiceModels } from '#~/model-selection.js'
import type { ModelServiceConfig } from '@oneworks/types'

const modelServices: Record<string, ModelServiceConfig> = {
  serviceA: {
    apiBaseUrl: 'https://service-a.example.com',
    apiKey: 'token-a',
    models: ['modelX', 'modelAOnly'],
    supportedAdapters: ['codex', 'grok', 'pi', 'cursor']
  },
  serviceB: {
    apiBaseUrl: 'https://service-b.example.com',
    apiKey: 'token-b',
    models: ['modelX', 'modelBOnly'],
    supportedAdapters: ['codex', 'grok', 'pi', 'cursor']
  }
}

describe('kiro model selection utilities', () => {
  it('fails model-service compatibility closed without changing other adapters', () => {
    const serviceModels = listServiceModels(modelServices)
    expect(filterServiceModelsForAdapter({
      adapter: 'kiro',
      modelServices,
      models: {
        'serviceA,modelX': { supportedAdapters: ['kiro'] }
      },
      serviceModels
    })).toEqual([])

    for (const adapter of ['codex', 'grok', 'pi', 'cursor']) {
      expect(filterServiceModelsForAdapter({
        adapter,
        modelServices,
        serviceModels
      })).toHaveLength(serviceModels.length)
    }
  })
})
