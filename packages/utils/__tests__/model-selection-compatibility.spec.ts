import { describe, expect, it } from 'vitest'

import { filterServiceModelsForAdapter, listServiceModels, resolveModelDefaultAdapter } from '#~/model-selection.js'
import type { ModelMetadataConfig, ModelServiceConfig } from '@oneworks/types'

describe('model adapter compatibility', () => {
  it('uses preferred adapter metadata before legacy defaultAdapter', () => {
    const models: Record<string, ModelMetadataConfig> = {
      serviceA: {
        defaultAdapter: 'claude-code',
        preferredAdapter: 'codex'
      },
      serviceB: {
        defaultAdapter: 'codex',
        preferredAdapters: ['claude-code', 'gemini']
      }
    }

    expect(resolveModelDefaultAdapter({
      model: 'serviceA,modelX',
      models
    })).toBe('codex')
    expect(resolveModelDefaultAdapter({
      model: 'serviceB,modelX',
      models
    })).toBe('claude-code')
  })

  it('lets service and model compatibility override adapter inference', () => {
    const routedModelServices: Record<string, ModelServiceConfig> = {
      serviceSupported: {
        apiBaseUrl: 'https://service.example.com/v1/chat/completions',
        apiKey: 'token',
        models: ['plain-model'],
        supportedAdapters: ['codex']
      },
      serviceBlocked: {
        apiBaseUrl: 'https://service.example.com/v1/responses',
        apiKey: 'token',
        models: ['blocked-model'],
        unsupportedAdapters: ['codex']
      },
      modelSupported: {
        apiBaseUrl: 'https://api.moonshot.ai/v1/chat/completions',
        apiKey: 'token',
        models: ['kimi-model']
      },
      modelBlocked: {
        apiBaseUrl: 'https://service.example.com/v1/responses',
        apiKey: 'token',
        models: ['gpt-model']
      }
    }
    const serviceModels = listServiceModels(routedModelServices)

    expect(
      filterServiceModelsForAdapter({
        adapter: 'codex',
        modelServices: routedModelServices,
        models: {
          'modelSupported,kimi-model': {
            supportedAdapters: ['codex']
          },
          'modelBlocked,gpt-model': {
            unsupportedAdapters: ['codex']
          }
        },
        serviceModels
      }).map(entry => entry.selectorValue)
    ).toEqual([
      'serviceSupported,plain-model',
      'modelSupported,kimi-model'
    ])
  })
})
