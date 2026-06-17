import { describe, expect, it } from 'vitest'

import {
  BUILTIN_NATIVE_ADAPTERS,
  DEFAULT_NATIVE_ADAPTER,
  hasRunnableChatModelSelection,
  listServiceModels,
  resolveAdapterForChatModelSelection,
  resolveAdapterModelCompatibility,
  resolveChatAdapterSelection,
  resolveChatModelSelection,
  resolveDefaultChatModelSelection,
  resolveModelForChatAdapterSelection,
  resolveRunnableAdapterKeys,
  resolveSelectableAdapterKeys,
  resolveServiceModelSelector
} from '#~/hooks/chat/model-selector'
import type { AdapterBuiltinModel, ModelMetadataConfig, ModelServiceConfig } from '@oneworks/types'

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

const adapterBuiltinModels: Record<string, AdapterBuiltinModel[]> = {
  codex: [
    {
      value: 'builtin-fast',
      title: 'builtin-fast',
      description: 'Fast builtin model'
    }
  ],
  'claude-code': [
    {
      value: 'sonnet',
      title: 'sonnet',
      description: 'Claude Sonnet'
    }
  ]
}

const modelMetadata: Record<string, ModelMetadataConfig> = {
  serviceA: {
    defaultAdapter: 'claude-code'
  },
  'serviceA,modelX': {
    defaultAdapter: 'codex'
  }
}

describe('chat model selector helpers', () => {
  it('keeps duplicate model names unique by selector value', () => {
    const serviceModels = listServiceModels(modelServices)
    const selectors = serviceModels
      .filter(entry => entry.model === 'modelX')
      .map(entry => entry.selectorValue)

    expect(selectors).toEqual(['serviceA,modelX', 'serviceB,modelX'])
    expect(new Set(selectors).size).toBe(2)
  })

  it('includes provider catalog models when a service omits models', () => {
    expect(listServiceModels({
      kimi: {
        provider: 'moonshot-cn',
        apiKey: 'token',
        models: []
      }
    })).toEqual([
      {
        serviceKey: 'kimi',
        model: 'kimi-k2.7-code',
        selectorValue: 'kimi,kimi-k2.7-code'
      },
      {
        serviceKey: 'kimi',
        model: 'kimi-k2.6',
        selectorValue: 'kimi,kimi-k2.6'
      },
      {
        serviceKey: 'kimi',
        model: 'kimi-k2.5',
        selectorValue: 'kimi,kimi-k2.5'
      },
      {
        serviceKey: 'kimi',
        model: 'kimi-k2-0905-preview',
        selectorValue: 'kimi,kimi-k2-0905-preview'
      },
      {
        serviceKey: 'kimi',
        model: 'kimi-k2',
        selectorValue: 'kimi,kimi-k2'
      }
    ])
  })

  it('honors a configured default model that is already service-qualified', () => {
    const serviceModels = listServiceModels(modelServices)

    expect(resolveDefaultChatModelSelection({
      defaultModel: 'serviceA,modelX',
      defaultModelService: 'serviceB',
      serviceModels
    })).toBe('serviceA,modelX')
  })

  it('resolves a raw default model through the configured default service first', () => {
    const serviceModels = listServiceModels(modelServices)

    expect(resolveDefaultChatModelSelection({
      defaultModel: 'modelX',
      defaultModelService: 'serviceB',
      serviceModels
    })).toBe('serviceB,modelX')
  })

  it('upgrades legacy raw persisted values to the canonical selector', () => {
    const serviceModels = listServiceModels(modelServices)

    expect(resolveChatModelSelection({
      value: 'modelX',
      defaultModelService: 'serviceB',
      serviceModels
    })).toBe('serviceB,modelX')
  })

  it('keeps builtin adapter models unprefixed', () => {
    const serviceModels = listServiceModels(modelServices)

    expect(resolveChatModelSelection({
      value: 'builtin-fast',
      builtinModels: ['builtin-fast'],
      defaultModelService: 'serviceA',
      serviceModels
    })).toBe('builtin-fast')
  })

  it('routes duplicate-name models through the selected service when already canonical', () => {
    const serviceModels = listServiceModels(modelServices)

    expect(resolveChatModelSelection({
      value: 'serviceB,modelX',
      defaultModelService: 'serviceA',
      serviceModels
    })).toBe('serviceB,modelX')
  })

  it('uses the default service first model before builtin fallback when only defaultModelService is configured', () => {
    const serviceModels = listServiceModels(modelServices)

    expect(resolveDefaultChatModelSelection({
      defaultModelService: 'serviceB',
      builtinModels: ['builtin-fast'],
      serviceModels
    })).toBe('serviceB,modelX')
  })

  it('falls back to the first matching service when no default service is provided', () => {
    const serviceModels = listServiceModels(modelServices)

    expect(resolveServiceModelSelector({
      value: 'modelX',
      serviceModels
    })).toBe('serviceA,modelX')
  })

  it('resolves adapter by exact model selector metadata before service metadata', () => {
    expect(resolveAdapterForChatModelSelection({
      model: 'serviceA,modelX',
      availableAdapters: ['claude-code', 'codex'],
      defaultAdapter: 'claude-code',
      adapterBuiltinModels,
      modelMetadata
    })).toBe('codex')

    expect(resolveAdapterForChatModelSelection({
      model: 'serviceA,modelAOnly',
      availableAdapters: ['claude-code', 'codex'],
      defaultAdapter: 'codex',
      adapterBuiltinModels,
      modelMetadata
    })).toBe('claude-code')
  })

  it('falls back to a builtin-compatible adapter when no routed selector metadata exists', () => {
    expect(resolveAdapterForChatModelSelection({
      model: 'sonnet',
      availableAdapters: ['codex', 'claude-code'],
      defaultAdapter: 'codex',
      adapterBuiltinModels,
      modelMetadata: {}
    })).toBe('claude-code')
  })

  it('uses adapter-level default model before global defaults', () => {
    const serviceModels = listServiceModels(modelServices)

    expect(resolveModelForChatAdapterSelection({
      adapter: 'codex',
      adapters: {
        codex: {
          defaultModel: 'serviceB,modelBOnly'
        }
      },
      defaultModel: 'serviceA,modelAOnly',
      defaultModelService: 'serviceA',
      builtinModels: ['builtin-fast'],
      fallbackBuiltinModels: ['builtin-fast', 'sonnet'],
      serviceModels
    })).toBe('serviceB,modelBOnly')
  })

  it('switches to adapter defaultModel when includeModels excludes the current service', () => {
    const serviceModels = listServiceModels(modelServices)

    expect(resolveAdapterModelCompatibility({
      adapter: 'codex',
      model: 'serviceB,modelBOnly',
      adapterConfig: {
        defaultModel: 'serviceA,modelAOnly',
        includeModels: ['serviceA']
      },
      serviceModels,
      preferredServiceKey: 'serviceA',
      preserveUnknownDefaultModel: false
    })).toMatchObject({
      model: 'serviceA,modelAOnly',
      warning: {
        adapter: 'codex',
        requestedModel: 'serviceB,modelBOnly',
        resolvedModel: 'serviceA,modelAOnly',
        reason: 'not_included'
      }
    })
  })

  it('validates adapter selections against the available adapter list', () => {
    expect(resolveChatAdapterSelection({
      value: 'missing',
      availableAdapters: ['codex', 'claude-code'],
      defaultAdapter: 'claude-code'
    })).toBe('claude-code')
  })

  it('uses codex as the selectable default adapter when no config default exists', () => {
    expect(resolveChatAdapterSelection({
      availableAdapters: ['claude-code', DEFAULT_NATIVE_ADAPTER, 'gemini']
    })).toBe(DEFAULT_NATIVE_ADAPTER)
  })

  it('keeps builtin-compatible model routing on the matching adapter order', () => {
    expect(resolveAdapterForChatModelSelection({
      model: 'default',
      availableAdapters: ['claude-code', DEFAULT_NATIVE_ADAPTER],
      adapterBuiltinModels: {
        'claude-code': [
          {
            value: 'default',
            title: 'Default',
            description: 'Default native model'
          }
        ],
        [DEFAULT_NATIVE_ADAPTER]: [
          {
            value: 'default',
            title: 'Default',
            description: 'Default native model'
          }
        ]
      },
      modelMetadata: {}
    })).toBe('claude-code')
  })

  it('allows native adapter defaults when no model service is configured', () => {
    expect(hasRunnableChatModelSelection({
      availableAdapters: ['codex'],
      serviceModels: []
    })).toBe(true)
  })

  it('still blocks startup when neither adapters nor models are available', () => {
    expect(hasRunnableChatModelSelection({
      availableAdapters: [],
      serviceModels: []
    })).toBe(false)
  })

  it('falls back to codex as the runnable adapter for an empty project', () => {
    expect(resolveRunnableAdapterKeys([])).toEqual(['codex'])
  })

  it('keeps configured adapters instead of appending the runtime fallback', () => {
    expect(resolveRunnableAdapterKeys(['claude-code'])).toEqual(['claude-code'])
  })

  it('offers every built-in adapter for frontend selection by default', () => {
    expect(resolveSelectableAdapterKeys({})).toEqual([...BUILTIN_NATIVE_ADAPTERS])
  })

  it('places configured custom adapters after built-in adapters', () => {
    expect(resolveSelectableAdapterKeys({
      configuredAdapters: ['codex', '@scope/adapter-custom', 'local-custom']
    })).toEqual([
      ...BUILTIN_NATIVE_ADAPTERS,
      '@scope/adapter-custom',
      'local-custom'
    ])
  })

  it('filters hidden built-in adapters without hiding configured custom adapters', () => {
    expect(resolveSelectableAdapterKeys({
      configuredAdapters: ['local-custom'],
      hiddenBuiltinAdapters: ['codex', 'gemini']
    })).toEqual([
      'claude-code',
      'copilot',
      'kimi',
      'opencode',
      'local-custom'
    ])
  })

  it('keeps a native fallback if every built-in adapter is hidden and no custom adapter is configured', () => {
    expect(resolveSelectableAdapterKeys({
      hiddenBuiltinAdapters: BUILTIN_NATIVE_ADAPTERS
    })).toEqual(['codex'])
  })
})
