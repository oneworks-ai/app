import { describe, expect, it } from 'vitest'

import { CODEX_SHARED_MODEL_SERVICE_KEY, createCodexSharedModelService } from '#~/codex-shared-model-service.js'
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
        apiBaseUrl: 'https://service.example.com/v1',
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

  it('offers Codex shared models to Grok while hiding unsupported Gemini protocols', () => {
    const modelServices: Record<string, ModelServiceConfig> = {
      [CODEX_SHARED_MODEL_SERVICE_KEY]: createCodexSharedModelService({
        builtinModels: [{
          value: 'gpt-5.4',
          title: 'GPT-5.4',
          description: 'Shared Codex model'
        }]
      }),
      gemini: {
        apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'token',
        apiProtocol: 'gemini-generate-content',
        models: ['gemini-3'],
        supportedAdapters: ['grok']
      }
    }

    const selectors = filterServiceModelsForAdapter({
      adapter: 'grok',
      modelServices,
      serviceModels: listServiceModels(modelServices)
    }).map(entry => entry.selectorValue)

    expect(selectors).toContain(`${CODEX_SHARED_MODEL_SERVICE_KEY},gpt-5.4`)
    expect(selectors).not.toContain('gemini,gemini-3')
  })
})
