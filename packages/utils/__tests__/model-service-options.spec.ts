import { afterEach, describe, expect, it } from 'vitest'

import {
  installModelProviderCatalog,
  resetModelProviderCatalog,
  resolveModelProviderIdentity,
  resolveModelServiceApiProtocol,
  resolveModelServiceBilling,
  resolveModelServiceCodingPlan,
  resolveModelServiceConfig,
  resolveModelServiceDescription,
  resolveModelServiceHomepageUrl,
  resolveModelServicePlanProtocolBaseUrl
} from '#~/model-providers.js'
import { filterServiceModelsForAdapter, listServiceModelOptions, listServiceModels } from '#~/model-selection.js'
import type { ModelServiceConfig } from '@oneworks/types'

describe('model service options', () => {
  afterEach(() => resetModelProviderCatalog())

  it('can replace bundled provider metadata with a validated managed catalog', () => {
    installModelProviderCatalog({
      schemaVersion: 1,
      providers: [{ id: 'managed', title: 'Managed provider', category: 'official' }],
      hostMatchers: [{ provider: 'managed', hosts: ['managed.example.com'] }]
    })

    expect(resolveModelProviderIdentity({ apiBaseUrl: 'https://managed.example.com/v1' }).provider).toBe('managed')
    expect(resolveModelServiceDescription({ provider: 'deepseek' })).toBeUndefined()
  })

  it('resolves official provider defaults without explicit apiBaseUrl', () => {
    const result = resolveModelServiceConfig({
      provider: 'moonshot-cn',
      apiKey: 'token'
    })

    expect(result.issues).toEqual([])
    expect(result.service?.apiBaseUrl).toBe('https://api.moonshot.cn/v1')
    expect(result.service?.apiProtocol).toBe('openai-chat-completions')
    expect(result.service?.providerDefinition?.title).toBe('Moonshot China')
    expect(resolveModelServiceHomepageUrl(result.service)).toBe('https://platform.kimi.com')
  })

  it('resolves common official providers without protocol or host configuration', () => {
    expect(resolveModelServiceConfig({ provider: 'openai', apiKey: 'token' }).service).toMatchObject({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiProtocol: 'openai-responses'
    })
    expect(resolveModelServiceConfig({ provider: 'anthropic', apiKey: 'token' }).service).toMatchObject({
      apiBaseUrl: 'https://api.anthropic.com/v1',
      apiProtocol: 'anthropic-messages'
    })
    expect(resolveModelServiceConfig({ provider: 'google-gemini', apiKey: 'token' }).service).toMatchObject({
      apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiProtocol: 'openai-chat-completions'
    })
  })

  it('keeps explicit protocol and host overrides ahead of provider defaults', () => {
    expect(
      resolveModelServiceConfig({
        provider: 'anthropic',
        apiBaseUrl: 'https://gateway.example.test/v1/responses',
        apiProtocol: 'openai-responses',
        apiKey: 'token'
      }).service
    ).toMatchObject({
      apiBaseUrl: 'https://gateway.example.test/v1/responses',
      apiProtocol: 'openai-responses'
    })
  })

  it('pairs coding-plan protocol overrides with their matching endpoint', () => {
    expect(
      resolveModelServiceConfig({
        provider: 'qwen-coding-plan',
        apiProtocol: 'anthropic-messages',
        apiKey: 'token'
      }).service
    ).toMatchObject({
      apiBaseUrl: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
      apiProtocol: 'anthropic-messages'
    })
  })

  it('resolves explicit wire protocols before legacy hints and URL inference', () => {
    expect(resolveModelServiceApiProtocol({
      apiProtocol: 'anthropic-messages',
      apiBaseUrl: 'https://example.test/v1/responses',
      extra: { codex: { wireApi: 'chat' } }
    })).toBe('anthropic-messages')
    expect(resolveModelServiceApiProtocol({
      extra: { codex: { wireApi: 'chat' } }
    })).toBe('openai-chat-completions')
    expect(resolveModelServiceApiProtocol({
      apiBaseUrl: 'https://example.test/v1/responses'
    })).toBe('openai-responses')
    expect(() =>
      resolveModelServiceApiProtocol({
        apiProtocol: 'openai-compatible'
      } as unknown as ModelServiceConfig)
    ).toThrow(/Unsupported model service apiProtocol/)
  })

  it('resolves configured descriptions before provider default descriptions', () => {
    expect(resolveModelServiceDescription({
      provider: 'deepseek',
      apiKey: 'token'
    })).toBe('Official DeepSeek OpenAI-compatible API service.')

    expect(resolveModelServiceDescription({
      provider: 'deepseek',
      description: 'Workspace DeepSeek',
      apiKey: 'token'
    })).toBe('Workspace DeepSeek')
  })

  it('lists provider catalog models when modelServices omit models', () => {
    expect(
      listServiceModels({
        kimi: {
          provider: 'moonshot-cn',
          apiKey: 'token',
          models: []
        }
      }).map(option => option.model)
    ).toEqual([
      'kimi-k2.7-code',
      'kimi-k2.6',
      'kimi-k2.5',
      'kimi-k2-0905-preview',
      'kimi-k2'
    ])
  })

  it('merges official provider catalog models with fetched service models', () => {
    expect(listServiceModels({
      kimi: {
        provider: 'moonshot-intl',
        apiKey: 'token',
        models: ['moonshot-v1-128k-vision-preview', 'kimi-k2.6', 'kimi-k2.7-code']
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
      },
      {
        serviceKey: 'kimi',
        model: 'moonshot-v1-128k-vision-preview',
        selectorValue: 'kimi,moonshot-v1-128k-vision-preview'
      }
    ])
  })

  it('uses the current DeepSeek catalog before legacy aliases', () => {
    expect(
      listServiceModels({
        deepseek: {
          provider: 'deepseek',
          apiKey: 'token'
        }
      }).map(option => option.model)
    ).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-chat',
      'deepseek-reasoner'
    ])
  })

  it('lists Claude Code compatible official provider defaults first', () => {
    expect(
      listServiceModels({
        qwen: {
          provider: 'qwen',
          apiKey: 'token'
        },
        zhipu: {
          provider: 'zhipu',
          apiKey: 'token'
        },
        minimax: {
          provider: 'minimax',
          apiKey: 'token'
        }
      }).map(option => option.selectorValue)
    ).toEqual([
      'qwen,qwen3.7-max',
      'qwen,qwen3.7-plus',
      'qwen,qwen3.6-flash',
      'qwen,qwen3.5-plus',
      'qwen,qwen3-coder-next',
      'qwen,qwen3-coder-plus',
      'zhipu,glm-5.2[1m]',
      'zhipu,glm-5.2',
      'zhipu,glm-4.7',
      'zhipu,glm-4.5-air',
      'minimax,MiniMax-M3'
    ])
  })

  it('resolves official coding plan defaults without calling model list APIs', () => {
    const result = resolveModelServiceConfig({
      provider: 'qwen-coding-plan',
      apiKey: 'sk-sp-token'
    })

    expect(result.issues).toEqual([])
    expect(result.service?.apiBaseUrl).toBe('https://coding.dashscope.aliyuncs.com/v1')
    expect(result.service?.providerDefinition?.title).toBe('Alibaba Coding Plan')
    expect(resolveModelServiceBilling(result.service)).toMatchObject({
      kind: 'coding_plan',
      keyKind: 'coding_plan_key',
      quotaUnit: 'request',
      allowedUse: 'coding_tools_only'
    })
    expect(resolveModelServicePlanProtocolBaseUrl(result.service, 'anthropic')).toBe(
      'https://coding.dashscope.aliyuncs.com/apps/anthropic'
    )
    expect(resolveModelServiceCodingPlan(result.service)?.defaultModels?.slice(0, 3)).toEqual([
      'qwen3.7-plus',
      'qwen3.6-plus',
      'kimi-k2.5'
    ])
  })

  it('detects dedicated coding plan providers from endpoint hosts and paths', () => {
    expect(
      resolveModelProviderIdentity({
        apiBaseUrl: 'https://api.kimi.com/coding/v1',
        apiKey: 'token'
      }).provider
    ).toBe('kimi-code')

    expect(
      resolveModelProviderIdentity({
        apiBaseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
        apiKey: 'token'
      }).provider
    ).toBe('zhipu-coding-plan')

    expect(
      resolveModelProviderIdentity({
        apiBaseUrl: 'https://qianfan.baidubce.com/anthropic/coding',
        apiKey: 'token'
      }).provider
    ).toBe('baidu-qianfan-coding-plan')
  })

  it('merges coding plan catalog models with explicit service models', () => {
    expect(
      listServiceModels({
        kimiCode: {
          provider: 'kimi-code',
          apiKey: 'token',
          models: ['kimi-for-coding', 'kimi-custom']
        }
      }).map(option => option.selectorValue)
    ).toEqual([
      'kimiCode,kimi-for-coding',
      'kimiCode,kimi-custom'
    ])
  })

  it('reports unresolved custom services without apiBaseUrl', () => {
    const result = resolveModelServiceConfig({ apiKey: 'token' })

    expect(result.service).toBeUndefined()
    expect(result.issues).toEqual([{
      type: 'missing_api_base_url',
      path: ['apiBaseUrl'],
      message: 'Model service requires apiBaseUrl unless provider supplies a default base URL.'
    }])
  })

  it('builds service model options with provider defaults and icon fallback', () => {
    expect(listServiceModelOptions({
      modelServices: {
        kimi: { provider: 'moonshot-cn', apiKey: 'token' },
        relay: {
          title: 'Internal Relay',
          icon: 'material:hub',
          apiBaseUrl: 'https://relay.example.com/v1',
          apiKey: 'token',
          models: ['relay-model']
        }
      },
      models: {
        'kimi,kimi-k2.7-code': { title: 'Kimi K2.7 Code', icon: 'builtin:kimi-k2' },
        'relay-model': { icon: 'https://relay.example.com/model.svg' }
      }
    })).toEqual([
      {
        serviceKey: 'kimi',
        model: 'kimi-k2.7-code',
        selectorValue: 'kimi,kimi-k2.7-code',
        serviceTitle: 'Moonshot China',
        modelTitle: 'Kimi K2.7 Code',
        serviceIcon: { kind: 'builtin', id: 'moonshot' },
        modelIcon: { kind: 'builtin', id: 'kimi-k2' }
      },
      {
        serviceKey: 'kimi',
        model: 'kimi-k2.6',
        selectorValue: 'kimi,kimi-k2.6',
        serviceTitle: 'Moonshot China',
        serviceIcon: { kind: 'builtin', id: 'moonshot' },
        modelIcon: undefined
      },
      {
        serviceKey: 'kimi',
        model: 'kimi-k2.5',
        selectorValue: 'kimi,kimi-k2.5',
        serviceTitle: 'Moonshot China',
        serviceIcon: { kind: 'builtin', id: 'moonshot' },
        modelIcon: undefined
      },
      {
        serviceKey: 'kimi',
        model: 'kimi-k2-0905-preview',
        selectorValue: 'kimi,kimi-k2-0905-preview',
        serviceTitle: 'Moonshot China',
        serviceIcon: { kind: 'builtin', id: 'moonshot' },
        modelIcon: undefined
      },
      {
        serviceKey: 'kimi',
        model: 'kimi-k2',
        selectorValue: 'kimi,kimi-k2',
        serviceTitle: 'Moonshot China',
        serviceIcon: { kind: 'builtin', id: 'moonshot' },
        modelIcon: undefined
      },
      {
        serviceKey: 'relay',
        model: 'relay-model',
        selectorValue: 'relay,relay-model',
        serviceTitle: 'Internal Relay',
        serviceIcon: { kind: 'material', name: 'hub' },
        modelIcon: { kind: 'url', url: 'https://relay.example.com/model.svg' }
      }
    ])
  })

  it('leaves model icon empty so selectors can fall back to the service icon', () => {
    expect(
      listServiceModelOptions({
        modelServices: {
          kimi: { provider: 'moonshot-cn', apiKey: 'token' }
        }
      })[0]
    ).toMatchObject({
      serviceIcon: { kind: 'builtin', id: 'moonshot' },
      modelIcon: undefined
    })
  })

  it('exposes provider-only official services to codex through catalog protocol defaults', () => {
    const providerOnlyServices: Record<string, ModelServiceConfig> = {
      kimi: { provider: 'moonshot-cn', apiKey: 'token' }
    }
    const serviceModels = listServiceModels(providerOnlyServices)

    expect(
      filterServiceModelsForAdapter({
        adapter: 'codex',
        modelServices: providerOnlyServices,
        serviceModels
      }).map(entry => entry.selectorValue)
    ).toEqual([
      'kimi,kimi-k2.7-code',
      'kimi,kimi-k2.6',
      'kimi,kimi-k2.5',
      'kimi,kimi-k2-0905-preview',
      'kimi,kimi-k2'
    ])
  })

  it('exposes only the currently supported DeepSeek Responses model to codex', () => {
    const deepseekServices: Record<string, ModelServiceConfig> = {
      deepseek: { provider: 'deepseek', apiKey: 'token' }
    }
    const serviceModels = listServiceModels(deepseekServices)

    expect(
      filterServiceModelsForAdapter({
        adapter: 'codex',
        modelServices: deepseekServices,
        serviceModels
      }).map(entry => entry.selectorValue)
    ).toEqual(['deepseek,deepseek-v4-flash'])
  })

  it('keeps legacy chat wire services available through the Codex Responses translator', () => {
    const codexCompatibleServices: Record<string, ModelServiceConfig> = {
      kimi: {
        provider: 'moonshot-cn',
        apiKey: 'token',
        extra: {
          codex: {
            wireApi: 'chat'
          }
        }
      }
    }
    const serviceModels = listServiceModels(codexCompatibleServices)

    expect(
      filterServiceModelsForAdapter({
        adapter: 'codex',
        modelServices: codexCompatibleServices,
        serviceModels
      }).map(entry => entry.selectorValue)
    ).toEqual([
      'kimi,kimi-k2.7-code',
      'kimi,kimi-k2.6',
      'kimi,kimi-k2.5',
      'kimi,kimi-k2-0905-preview',
      'kimi,kimi-k2'
    ])
  })
})
