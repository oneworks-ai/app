import { afterEach, describe, expect, it, vi } from 'vitest'

import { generateDefaultCCRConfigJSON, resolveDefaultClaudeCodeRouterPort } from '../src/ccr/config'

describe('generateDefaultCCRConfigJSON', () => {
  const baseUserConfig = {
    defaultModelService: 'gpt-responses',
    defaultModel: 'gpt-5.2-codex-2026-01-14',
    modelServices: {
      'gpt-responses': {
        apiBaseUrl: 'http://aidp.bytedance.net/api/modelhub/online/responses',
        apiKey: 'test-key',
        models: ['gpt-5.2-codex-2026-01-14']
      }
    }
  }

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('appends configured query params to CCR provider URLs', () => {
    const raw = generateDefaultCCRConfigJSON({
      cwd: '/tmp/project',
      userConfig: {
        defaultModelService: 'gpt-responses',
        defaultModel: 'gpt-5.2-codex-2026-01-14',
        modelServices: {
          'gpt-responses': {
            apiBaseUrl: 'http://aidp.bytedance.net/api/modelhub/online/responses',
            apiKey: 'test-key',
            models: ['gpt-5.2-codex-2026-01-14'],
            extra: {
              codex: {
                queryParams: {
                  ak: 'test-key'
                }
              }
            }
          }
        }
      }
    })

    const config = JSON.parse(raw) as {
      Providers: Array<{ name: string; api_base_url: string }>
      Router: { default: string }
    }

    expect(config.Providers).toMatchObject([
      {
        name: 'gpt-responses',
        api_base_url: 'http://aidp.bytedance.net/api/modelhub/online/responses?ak=test-key'
      }
    ])
    expect(config.Router.default).toBe('gpt-responses,gpt-5.2-codex-2026-01-14')
  })

  it('keeps provider URLs unchanged when no query params are configured', () => {
    const raw = generateDefaultCCRConfigJSON({
      cwd: '/tmp/project',
      userConfig: {
        defaultModelService: 'gpt',
        defaultModel: 'gpt-5.4-2026-03-05',
        modelServices: {
          gpt: {
            apiBaseUrl: 'https://search.bytedance.net/gpt/openapi/online/v2/crawl',
            apiKey: 'test-key',
            models: ['gpt-5.4-2026-03-05']
          }
        }
      }
    })

    const config = JSON.parse(raw) as {
      Providers: Array<{ name: string; api_base_url: string }>
    }

    expect(config.Providers).toMatchObject([
      {
        name: 'gpt',
        api_base_url: 'https://search.bytedance.net/gpt/openapi/online/v2/crawl'
      }
    ])
  })

  it('uses chat completions endpoints for provider registry API roots in CCR', () => {
    const raw = generateDefaultCCRConfigJSON({
      cwd: '/tmp/project',
      userConfig: {
        defaultModelService: 'kimi',
        defaultModel: 'kimi-k2',
        modelServices: {
          kimi: {
            provider: 'moonshot-cn',
            apiKey: 'kimi-key'
          }
        }
      }
    })

    const config = JSON.parse(raw) as {
      Providers: Array<{ name: string; api_base_url: string }>
      Router: { default: string }
    }

    expect(config.Providers).toMatchObject([
      {
        name: 'kimi',
        api_base_url: 'https://api.moonshot.cn/v1/chat/completions'
      }
    ])
    expect(config.Router.default).toBe('kimi,kimi-k2')
  })

  it('keeps CCR provider routing on chat completions when only the catalog has a Responses default', () => {
    const raw = generateDefaultCCRConfigJSON({
      cwd: '/tmp/project',
      userConfig: {
        defaultModelService: 'openai',
        defaultModel: 'gpt-5.4',
        modelServices: {
          openai: {
            provider: 'openai',
            apiKey: 'openai-key',
            models: ['gpt-5.4']
          }
        }
      }
    })

    const config = JSON.parse(raw) as {
      Providers: Array<{ api_base_url: string; transformer?: unknown }>
    }

    expect(config.Providers[0]).toMatchObject({
      api_base_url: 'https://api.openai.com/v1/chat/completions'
    })
    expect(config.Providers[0]?.transformer).toBeUndefined()
  })

  it('uses the Responses endpoint and transformer when CCR is explicitly configured for Responses', () => {
    const raw = generateDefaultCCRConfigJSON({
      cwd: '/tmp/project',
      userConfig: {
        defaultModelService: 'openai',
        defaultModel: 'gpt-5.4',
        modelServices: {
          openai: {
            provider: 'openai',
            apiProtocol: 'openai-responses',
            apiKey: 'openai-key',
            models: ['gpt-5.4']
          }
        }
      }
    })

    const config = JSON.parse(raw) as {
      Providers: Array<{ api_base_url: string; transformer?: { use?: unknown[] } }>
    }

    expect(config.Providers[0]).toMatchObject({
      api_base_url: 'https://api.openai.com/v1/responses',
      transformer: { use: ['openai-responses'] }
    })
  })

  it('persists only environment placeholders for the runtime Codex shared provider', () => {
    const raw = generateDefaultCCRConfigJSON({
      cwd: '/tmp/project',
      selectedModel: 'oneworks-codex,gpt-5.4',
      config: {
        modelServices: {
          'oneworks-codex': {
            apiProtocol: 'openai-chat-completions',
            apiBaseUrl: 'http://127.0.0.1:9876/api/internal/codex-shared-model/v1',
            apiKey: 'runtime-only-secret',
            models: ['gpt-5.4']
          }
        }
      }
    })

    const config = JSON.parse(raw) as {
      ONEWORKS_RUNTIME_MODEL_CAPABILITY_REVISION?: string
      Providers: Array<Record<string, unknown>>
    }

    expect(config.Providers[0]).toMatchObject({
      name: 'oneworks-codex',
      api_base_url: '$' + '{__ONEWORKS_PROJECT_CODEX_SHARED_MODEL_UPSTREAM_URL__}',
      api_key: '$' + '{__ONEWORKS_PROJECT_CODEX_SHARED_MODEL_TOKEN__}'
    })
    expect(config.ONEWORKS_RUNTIME_MODEL_CAPABILITY_REVISION).toMatch(/^[a-f0-9]{64}$/)
    expect(raw).not.toContain('runtime-only-secret')
    expect(raw).not.toContain('127.0.0.1:9876')
  })

  it('expands Provider Profiles into independent CCR providers', () => {
    const raw = generateDefaultCCRConfigJSON({
      cwd: '/tmp/project',
      userConfig: {
        defaultModelService: 'deepseek/work',
        defaultModel: 'deepseek-chat',
        modelServices: {
          deepseek: {
            kind: 'collection',
            provider: 'deepseek',
            profiles: {
              personal: { apiKey: 'personal-key' },
              work: { apiKey: 'work-key' }
            }
          }
        }
      }
    })

    const config = JSON.parse(raw) as {
      Providers: Array<{ name: string; api_key: string }>
      Router: { default: string }
    }
    expect(config.Providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'deepseek/personal', api_key: 'personal-key' }),
      expect.objectContaining({ name: 'deepseek/work', api_key: 'work-key' })
    ]))
    expect(config.Router.default).toBe('deepseek/work,deepseek-chat')
  })

  it('uses chat completions endpoints for Coding Plan OpenAI-compatible roots in CCR', () => {
    const raw = generateDefaultCCRConfigJSON({
      cwd: '/tmp/project',
      userConfig: {
        defaultModelService: 'qwen-coding',
        defaultModel: 'qwen3.7-plus',
        modelServices: {
          'qwen-coding': {
            provider: 'qwen-coding-plan',
            apiKey: 'sk-sp-token'
          }
        }
      }
    })

    const config = JSON.parse(raw) as {
      Providers: Array<{ name: string; api_base_url: string }>
      Router: { default: string }
    }

    expect(config.Providers).toMatchObject([
      {
        name: 'qwen-coding',
        api_base_url: 'https://coding.dashscope.aliyuncs.com/v1/chat/completions'
      }
    ])
    expect(config.Router.default).toBe('qwen-coding,qwen3.7-plus')
  })

  it('does not append chat completions when an endpoint is already configured', () => {
    const raw = generateDefaultCCRConfigJSON({
      cwd: '/tmp/project',
      userConfig: {
        defaultModelService: 'kimi',
        defaultModel: 'kimi-k2',
        modelServices: {
          kimi: {
            provider: 'moonshot-cn',
            apiBaseUrl: 'https://api.moonshot.cn/v1/chat/completions',
            apiKey: 'kimi-key',
            models: ['kimi-k2']
          }
        }
      }
    })

    const config = JSON.parse(raw) as {
      Providers: Array<{ name: string; api_base_url: string }>
    }

    expect(config.Providers[0]?.api_base_url).toBe('https://api.moonshot.cn/v1/chat/completions')
  })

  it('maps model service timeout to CCR API_TIMEOUT_MS and prefers the default service when values differ', () => {
    const raw = generateDefaultCCRConfigJSON({
      cwd: '/tmp/project',
      userConfig: {
        defaultModelService: 'fast',
        defaultModel: 'gpt-5.4-mini',
        modelServices: {
          fast: {
            apiBaseUrl: 'https://example.test/fast/chat/completions',
            apiKey: 'fast-key',
            models: ['gpt-5.4-mini'],
            timeoutMs: 120000
          },
          slow: {
            apiBaseUrl: 'https://example.test/slow/chat/completions',
            apiKey: 'slow-key',
            models: ['gpt-5.4'],
            timeoutMs: 600000
          }
        }
      }
    })

    const config = JSON.parse(raw) as {
      API_TIMEOUT_MS?: number
    }

    expect(config.API_TIMEOUT_MS).toBe(120000)
  })

  it('resolves configured model aliases from models metadata back to the exact model', () => {
    const raw = generateDefaultCCRConfigJSON({
      cwd: '/tmp/project',
      userConfig: {
        defaultModelService: 'gateway',
        defaultModel: 'gpt-5.4',
        models: {
          'gateway,gpt-5.4-2026-03-05': {
            alias: ['gpt-5.4']
          }
        },
        modelServices: {
          gateway: {
            apiBaseUrl: 'https://example.test/chat/completions',
            apiKey: 'gateway-key',
            models: ['gpt-5.4-2026-03-05']
          }
        }
      }
    })

    const config = JSON.parse(raw) as {
      Router: { default: string }
    }

    expect(config.Router.default).toBe('gateway,gpt-5.4-2026-03-05')
  })

  it('preserves explicit CCR router network options', () => {
    const raw = generateDefaultCCRConfigJSON({
      cwd: '/tmp/project',
      userConfig: baseUserConfig,
      adapterOptions: {
        ccrOptions: {
          PORT: '4123',
          APIKEY: 'router-key'
        }
      }
    })

    const config = JSON.parse(raw) as {
      PORT?: string
      APIKEY?: string
    }

    expect(config.PORT).toBe('4123')
    expect(config.APIKEY).toBe('router-key')
  })

  it('assigns a stable workspace-specific CCR port when none is configured', () => {
    const cwd = '/tmp/project-alpha'
    const raw = generateDefaultCCRConfigJSON({
      cwd,
      userConfig: baseUserConfig
    })

    const config = JSON.parse(raw) as {
      PORT?: string
    }

    expect(config.PORT).toBe(String(resolveDefaultClaudeCodeRouterPort(cwd)))
    expect(config.PORT).not.toBe('3456')
  })

  it('adds a maxtoken transformer for model service maxOutputTokens without clobbering existing transformers', () => {
    const raw = generateDefaultCCRConfigJSON({
      cwd: '/tmp/project',
      userConfig: {
        defaultModelService: 'gateway',
        defaultModel: 'gpt-5.4',
        modelServices: {
          gateway: {
            apiBaseUrl: 'https://example.test/chat/completions',
            apiKey: 'gateway-key',
            models: ['gpt-5.4'],
            maxOutputTokens: 8192,
            extra: {
              claudeCodeRouterTransformer: {
                use: ['openrouter']
              }
            }
          }
        }
      }
    })

    const config = JSON.parse(raw) as {
      Providers: Array<{ transformer?: { use?: unknown[] } }>
    }

    expect(config.Providers[0]?.transformer?.use).toEqual([
      'openrouter',
      ['maxtoken', { max_tokens: 8192 }]
    ])
  })

  it('injects built-in transformers by default', () => {
    const raw = generateDefaultCCRConfigJSON({
      cwd: '/tmp/project',
      userConfig: baseUserConfig
    })

    const config = JSON.parse(raw) as {
      transformers: Array<{ path: string }>
    }

    expect(config.transformers.some(item => item.path.endsWith('logger.ts'))).toBe(true)
    expect(config.transformers.some(item => item.path.endsWith('openai-polyfill.ts'))).toBe(true)
    expect(config.transformers.some(item => item.path.endsWith('gemini-open-router-polyfill.ts'))).toBe(true)
    expect(config.transformers.some(item => item.path.endsWith('kimi-thinking-polyfill.ts'))).toBe(true)
  })

  it('allows disabling logger transformer explicitly', () => {
    const raw = generateDefaultCCRConfigJSON({
      cwd: '/tmp/project',
      userConfig: baseUserConfig,
      adapterOptions: {
        ccrTransformers: {
          logger: false
        }
      }
    })

    const config = JSON.parse(raw) as {
      transformers: Array<{ path: string }>
    }

    expect(config.transformers.some(item => item.path.endsWith('logger.ts'))).toBe(false)
  })

  it('ignores invalid sibling services when an explicit model selects a valid service', () => {
    const raw = generateDefaultCCRConfigJSON({
      cwd: '/tmp/project',
      selectedModel: 'selected,gpt-5',
      config: {
        modelServices: {
          sibling: {
            apiBaseUrl: 'http://127.0.0.1:$' + '{UNRESOLVED_PORT}/v1',
            models: ['sibling-model']
          },
          selected: {
            apiProtocol: 'openai-responses',
            apiBaseUrl: 'http://127.0.0.1:8787/internal/v1',
            apiKey: 'selected-key',
            models: ['gpt-5']
          }
        }
      }
    })

    const config = JSON.parse(raw) as {
      Providers: Array<{ name: string; api_base_url: string }>
      Router: { default: string }
    }

    expect(config.Providers).toEqual([
      expect.objectContaining({
        name: 'selected',
        api_base_url: 'http://127.0.0.1:8787/internal/v1/responses'
      })
    ])
    expect(config.Router.default).toBe('selected,gpt-5')
  })

  it('rejects an invalid explicitly selected service URL', () => {
    expect(() =>
      generateDefaultCCRConfigJSON({
        cwd: '/tmp/project',
        selectedModel: 'selected,gpt-5',
        config: {
          modelServices: {
            selected: {
              apiBaseUrl: 'http://127.0.0.1:$' + '{UNRESOLVED_PORT}/v1',
              models: ['gpt-5']
            }
          }
        }
      })
    ).toThrow('Invalid URL')
  })
})
