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

  it('offers Goose only the model-service protocols supported by its declarative provider boundary', () => {
    const modelServices: Record<string, ModelServiceConfig> = {
      chat: {
        apiBaseUrl: 'https://api.example.test/v1/chat/completions',
        apiKey: 'chat-token',
        apiProtocol: 'openai-chat-completions',
        models: ['chat-model']
      },
      anthropic: {
        apiBaseUrl: 'https://api.example.test/v1/messages',
        apiKey: 'anthropic-token',
        apiProtocol: 'anthropic-messages',
        models: ['claude-model']
      },
      responses: {
        apiBaseUrl: 'https://api.example.test/v1/responses',
        apiKey: 'responses-token',
        apiProtocol: 'openai-responses',
        models: ['responses-model']
      }
    }
    const selectors = filterServiceModelsForAdapter({
      adapter: 'goose',
      modelServices,
      serviceModels: listServiceModels(modelServices)
    }).map(entry => entry.selectorValue)

    expect(selectors).toEqual(['chat,chat-model', 'anthropic,claude-model'])
  })

  it('offers Qwen Code only OpenAI Chat Completions routed services', () => {
    const modelServices: Record<string, ModelServiceConfig> = {
      openai: {
        apiBaseUrl: 'https://openai-compatible.example.com/v1',
        apiKey: 'redacted-fixture-value',
        apiProtocol: 'openai-chat-completions',
        provider: 'openai',
        models: ['fixture-openai-model', 'fixture-openai-model-denied']
      },
      anthropic: {
        apiBaseUrl: 'https://anthropic.example.com',
        apiKey: 'redacted-fixture-value',
        apiProtocol: 'anthropic-messages',
        models: ['fixture-anthropic-model']
      },
      gemini: {
        apiBaseUrl: 'https://gemini.example.com',
        apiKey: 'redacted-fixture-value',
        apiProtocol: 'gemini-generate-content',
        models: ['fixture-gemini-model']
      },
      missingProtocol: {
        apiBaseUrl: 'https://openai-compatible.example.com/v1',
        apiKey: 'redacted-fixture-value',
        provider: 'openai',
        models: ['fixture-missing-protocol']
      },
      customProvider: {
        apiBaseUrl: 'https://custom.example.com/v1',
        apiKey: 'redacted-fixture-value',
        apiProtocol: 'openai-chat-completions',
        provider: 'custom',
        models: ['fixture-custom-provider']
      },
      explicitlyUnsupported: {
        apiBaseUrl: 'https://openai-compatible.example.com/v1',
        apiKey: 'redacted-fixture-value',
        apiProtocol: 'openai-chat-completions',
        provider: 'openai',
        models: ['fixture-unsupported'],
        unsupportedAdapters: ['qwen-code']
      },
      codexOnly: {
        apiBaseUrl: 'https://openai-compatible.example.com/v1',
        apiKey: 'redacted-fixture-value',
        apiProtocol: 'openai-chat-completions',
        provider: 'openai',
        models: ['fixture-codex-only'],
        supportedAdapters: ['codex']
      }
    }

    const selectors = filterServiceModelsForAdapter({
      adapter: 'qwen-code',
      modelServices,
      models: {
        'openai,fixture-openai-model': { supportedAdapters: ['qwen-code'] },
        'openai,fixture-openai-model-denied': { unsupportedAdapters: ['qwen-code'] },
        'anthropic,fixture-anthropic-model': { supportedAdapters: ['qwen-code'] },
        'customProvider,fixture-custom-provider': { supportedAdapters: ['qwen-code'] },
        'explicitlyUnsupported,fixture-unsupported': { supportedAdapters: ['qwen-code'] }
      },
      serviceModels: listServiceModels(modelServices)
    }).map(entry => entry.selectorValue)

    expect(selectors).toContain('openai,fixture-openai-model')
    expect(selectors).not.toEqual(expect.arrayContaining([
      'anthropic,fixture-anthropic-model',
      'gemini,fixture-gemini-model',
      'missingProtocol,fixture-missing-protocol',
      'customProvider,fixture-custom-provider',
      'explicitlyUnsupported,fixture-unsupported',
      'codexOnly,fixture-codex-only',
      'openai,fixture-openai-model-denied'
    ]))
  })
})
