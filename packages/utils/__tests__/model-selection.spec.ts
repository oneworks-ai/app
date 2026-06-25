import { describe, expect, it } from 'vitest'

import { flattenModelServices, resolveModelServiceFromMap } from '#~/model-providers.js'
import {
  BUILTIN_NATIVE_ADAPTERS,
  doesModelMatchSelector,
  evaluateAdapterModelRules,
  filterServiceModelsForAdapter,
  listServiceModels,
  mergeAdapterConfigs,
  resolveAdapterConfiguredDefaultModel,
  resolveAdapterModelCompatibility,
  resolveDefaultModelSelection,
  resolveEffectiveEffort,
  resolveModelConfiguredEffort,
  resolveModelDefaultAdapter,
  resolveModelDisplayMetadata,
  resolveModelMetadata,
  resolveModelSelection,
  resolveSelectableAdapterKeys
} from '#~/model-selection.js'
import type { ModelMetadataConfig, ModelServiceConfig } from '@oneworks/types'

const modelServices: Record<string, ModelServiceConfig> = {
  serviceA: {
    apiBaseUrl: 'https://service-a.example.com',
    apiKey: 'token-a',
    models: ['modelX', 'modelAOnly']
  },
  serviceB: {
    apiBaseUrl: 'https://service-b.example.com',
    apiKey: 'token-b',
    models: ['modelX', 'modelBOnly']
  }
}

describe('model selection utilities', () => {
  it('expands model service collections into selectable child services', () => {
    const services: Record<string, ModelServiceConfig> = {
      micu: {
        apiKey: '',
        kind: 'collection',
        management: {
          apiKey: 'management-token',
          endpointKind: 'newapi',
          userId: '42647'
        },
        provider: 'micu',
        profiles: {
          codex: {
            apiBaseUrl: 'https://www.micuapi.ai/v1',
            apiKey: 'model-token',
            models: ['gpt-5.4']
          }
        }
      }
    }

    expect(listServiceModels(services)).toEqual([
      {
        model: 'gpt-5.4',
        selectorValue: 'micu/codex,gpt-5.4',
        serviceKey: 'micu/codex'
      }
    ])
    expect(flattenModelServices(services)['micu/codex']).toMatchObject({
      apiKey: 'model-token',
      provider: 'micu'
    })
    expect(flattenModelServices(services)['micu/codex']?.management).toBeUndefined()
    expect(resolveModelServiceFromMap(services, 'micu/codex')).toMatchObject({
      apiKey: 'model-token',
      provider: 'micu'
    })
  })

  it('keeps legacy collection services selectable while profiles migrate in', () => {
    const services: Record<string, ModelServiceConfig> = {
      relay: {
        apiKey: '',
        kind: 'collection',
        provider: 'micu',
        services: {
          legacy: {
            apiKey: 'model-token',
            models: ['legacy-model']
          }
        }
      }
    }

    expect(listServiceModels(services)).toEqual([
      {
        model: 'legacy-model',
        selectorValue: 'relay/legacy,legacy-model',
        serviceKey: 'relay/legacy'
      }
    ])
  })

  it('resolves exact selector metadata before service-level metadata', () => {
    const models: Record<string, ModelMetadataConfig> = {
      serviceA: { defaultAdapter: 'claude-code' },
      'serviceA,modelX': { defaultAdapter: 'codex' }
    }

    expect(resolveModelDefaultAdapter({
      model: 'serviceA,modelX',
      models
    })).toBe('codex')
    expect(resolveModelMetadata({
      model: 'serviceA,modelAOnly',
      models
    })).toEqual({ defaultAdapter: 'claude-code' })
  })

  it('falls back from exact selector to plain model metadata before service entries', () => {
    const models: Record<string, ModelMetadataConfig> = {
      modelX: { defaultAdapter: 'codex' },
      serviceB: { defaultAdapter: 'claude-code' }
    }

    expect(resolveModelDefaultAdapter({
      model: 'serviceB,modelX',
      models
    })).toBe('codex')
  })

  it('resolves exact selector metadata before plain model and service metadata', () => {
    const models: Record<string, ModelMetadataConfig> = {
      serviceA: { effort: 'low' },
      modelX: { effort: 'medium' },
      'serviceA,modelX': { effort: 'high' }
    }

    expect(resolveModelConfiguredEffort({
      model: 'serviceA,modelX',
      models
    })).toBe('high')
    expect(resolveModelConfiguredEffort({
      model: 'serviceB,modelX',
      models
    })).toBe('medium')
  })

  it('uses display metadata only for exact model matches', () => {
    const models: Record<string, ModelMetadataConfig> = {
      serviceA: {
        title: 'Service Title',
        description: 'Service Description'
      },
      modelX: {
        alias: ['Model X', 'MX'],
        description: 'Shared Description'
      },
      'serviceA,modelAOnly': {
        title: 'Service A Only',
        description: 'Exact Description'
      }
    }

    expect(resolveModelDisplayMetadata({
      model: 'serviceB,modelX',
      models
    })).toEqual({
      aliases: ['Model X', 'MX'],
      title: undefined,
      description: 'Shared Description'
    })

    expect(resolveModelDisplayMetadata({
      model: 'serviceA,modelAOnly',
      models
    })).toEqual({
      aliases: [],
      title: 'Service A Only',
      description: 'Exact Description'
    })

    expect(resolveModelDisplayMetadata({
      model: 'serviceA,modelBOnly',
      models
    })).toBeUndefined()
  })

  it('resolves raw models through the preferred default service', () => {
    const serviceModels = listServiceModels(modelServices)

    expect(resolveModelSelection({
      value: 'modelX',
      serviceModels,
      preferredServiceKey: 'serviceB',
      preserveUnknown: false
    })).toBe('serviceB,modelX')
  })

  it('filters routed services by explicit adapter compatibility', () => {
    const routedModelServices: Record<string, ModelServiceConfig> = {
      responses: {
        apiBaseUrl: 'https://service.example.com/v1/responses',
        apiKey: 'token',
        models: ['gpt-5']
      },
      kimi: {
        apiBaseUrl: 'https://api.moonshot.ai/v1/chat/completions',
        apiKey: 'token',
        models: ['kimi-k2.5']
      },
      explicit: {
        apiBaseUrl: 'https://service.example.com/v1',
        apiKey: 'token',
        models: ['explicit-model'],
        extra: {
          codex: {
            wireApi: 'responses'
          }
        }
      }
    }
    const serviceModels = listServiceModels(routedModelServices)

    expect(
      filterServiceModelsForAdapter({
        adapter: 'codex',
        modelServices: routedModelServices,
        serviceModels
      }).map(entry => entry.selectorValue)
    ).toEqual([
      'responses,gpt-5',
      'explicit,explicit-model'
    ])

    expect(
      filterServiceModelsForAdapter({
        adapter: 'codex',
        modelServices: routedModelServices,
        models: {
          responses: {
            defaultAdapter: 'gemini'
          }
        },
        serviceModels
      }).map(entry => entry.selectorValue)
    ).toEqual([
      'responses,gpt-5',
      'explicit,explicit-model'
    ])

    expect(
      filterServiceModelsForAdapter({
        adapter: 'codex',
        modelServices: routedModelServices,
        models: {
          responses: {
            unsupportedAdapters: ['codex']
          }
        },
        serviceModels
      }).map(entry => entry.selectorValue)
    ).toEqual([
      'explicit,explicit-model'
    ])
  })

  it('falls back to default service first model when no explicit model is configured', () => {
    const serviceModels = listServiceModels(modelServices)

    expect(resolveDefaultModelSelection({
      defaultModelService: 'serviceB',
      serviceModels,
      preserveUnknownDefaultModel: false
    })).toBe('serviceB,modelX')
  })

  it('matches service selectors and exact selectors for routed models', () => {
    expect(doesModelMatchSelector({
      model: 'serviceA,modelX',
      selector: 'serviceA'
    })).toBe(true)
    expect(doesModelMatchSelector({
      model: 'serviceA,modelX',
      selector: 'serviceA,modelX'
    })).toBe(true)
    expect(doesModelMatchSelector({
      model: 'serviceA,modelX',
      selector: 'serviceB'
    })).toBe(false)
  })

  it('prefers adapter defaultModel before global defaults', () => {
    const serviceModels = listServiceModels(modelServices)

    expect(resolveAdapterConfiguredDefaultModel({
      adapterConfig: {
        defaultModel: 'serviceB,modelBOnly'
      },
      serviceModels,
      preferredServiceKey: 'serviceA',
      preserveUnknown: false
    })).toBe('serviceB,modelBOnly')
  })

  it('merges adapter account maps by key instead of replacing the whole accounts object', () => {
    expect(mergeAdapterConfigs(
      {
        codex: {
          defaultAccount: 'work',
          accounts: {
            work: {
              title: 'Work',
              authFile: '<project-home>/.local/work/auth.json'
            }
          }
        }
      },
      {
        codex: {
          accounts: {
            personal: {
              title: 'Personal'
            },
            work: {
              description: 'workspace override'
            }
          }
        }
      }
    )).toEqual({
      codex: {
        defaultAccount: 'work',
        accounts: {
          work: {
            title: 'Work',
            authFile: '<project-home>/.local/work/auth.json',
            description: 'workspace override'
          },
          personal: {
            title: 'Personal'
          }
        }
      }
    })
  })

  it('treats service selectors as valid includeModels rules', () => {
    expect(evaluateAdapterModelRules({
      model: 'serviceA,modelX',
      adapterConfig: {
        includeModels: ['serviceA']
      }
    })).toMatchObject({
      allowed: true
    })

    expect(evaluateAdapterModelRules({
      model: 'serviceB,modelX',
      adapterConfig: {
        includeModels: ['serviceA']
      }
    })).toMatchObject({
      allowed: false,
      reason: 'not_included'
    })
  })

  it('does not let includeModels reject the literal default model', () => {
    expect(evaluateAdapterModelRules({
      model: 'default',
      adapterConfig: {
        includeModels: ['serviceA']
      }
    })).toMatchObject({
      allowed: true
    })
  })

  it('falls back to adapter defaultModel when the selected model is excluded', () => {
    const serviceModels = listServiceModels(modelServices)

    expect(resolveAdapterModelCompatibility({
      adapter: 'codex',
      model: 'serviceA,modelX',
      adapterConfig: {
        defaultModel: 'serviceB,modelBOnly',
        excludeModels: ['serviceA,modelX']
      },
      serviceModels,
      preferredServiceKey: 'serviceA',
      preserveUnknownDefaultModel: false
    })).toMatchObject({
      model: 'serviceB,modelBOnly',
      warning: {
        adapter: 'codex',
        requestedModel: 'serviceA,modelX',
        resolvedModel: 'serviceB,modelBOnly',
        reason: 'excluded'
      }
    })
  })

  it('returns an error when adapter rules reject the model and no defaultModel exists', () => {
    const serviceModels = listServiceModels(modelServices)

    expect(resolveAdapterModelCompatibility({
      adapter: 'codex',
      model: 'serviceB,modelX',
      adapterConfig: {
        includeModels: ['serviceA']
      },
      serviceModels,
      preferredServiceKey: 'serviceA',
      preserveUnknownDefaultModel: false
    })).toMatchObject({
      error: {
        type: 'missing_default_model',
        adapter: 'codex',
        requestedModel: 'serviceB,modelX',
        reason: 'not_included'
      }
    })
  })

  it('resolves effort in explicit > model > adapter > config order', () => {
    expect(resolveEffectiveEffort({
      explicitEffort: 'max',
      model: 'serviceA,modelX',
      adapterConfig: { effort: 'medium' },
      configEffort: 'low',
      models: {
        'serviceA,modelX': { effort: 'high' }
      }
    })).toEqual({
      effort: 'max',
      source: 'explicit'
    })

    expect(resolveEffectiveEffort({
      model: 'serviceA,modelX',
      adapterConfig: { effort: 'medium' },
      configEffort: 'low',
      models: {
        'serviceA,modelX': { effort: 'high' }
      }
    })).toEqual({
      effort: 'high',
      source: 'model'
    })

    expect(resolveEffectiveEffort({
      model: 'serviceA,modelAOnly',
      adapterConfig: { effort: 'medium' },
      configEffort: 'low'
    })).toEqual({
      effort: 'medium',
      source: 'adapter'
    })

    expect(resolveEffectiveEffort({
      configEffort: 'low'
    })).toEqual({
      effort: 'low',
      source: 'config'
    })
  })

  it('resolves selectable adapters as built-ins first and custom adapters second', () => {
    expect(resolveSelectableAdapterKeys({
      configuredAdapters: ['codex', '@scope/adapter-custom'],
      defaultAdapter: 'local-custom'
    })).toEqual([
      ...BUILTIN_NATIVE_ADAPTERS,
      '@scope/adapter-custom',
      'local-custom'
    ])
  })

  it('filters hidden built-in adapters from selectable adapters', () => {
    expect(resolveSelectableAdapterKeys({
      configuredAdapters: ['local-custom'],
      hiddenBuiltinAdapters: ['claude-code', 'gemini']
    })).toEqual([
      'codex',
      'copilot',
      'kimi',
      'opencode',
      'local-custom'
    ])
  })
})
