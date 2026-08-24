import { describe, expect, it } from 'vitest'

import { resolveCopilotModelConfig } from '#~/runtime/shared.js'

import { makeCtx } from './runtime-test-helpers'

describe('resolveCopilotModelConfig', () => {
  it('normalizes chat completions provider base URLs for routed services', () => {
    const { ctx } = makeCtx({
      configs: [{
        modelServices: {
          kimi: {
            apiBaseUrl: 'https://api.moonshot.oo/v1/chat/completions',
            apiKey: 'kimi-key'
          }
        }
      }, undefined]
    })

    expect(resolveCopilotModelConfig(ctx, 'kimi,kimi-k2.5')).toMatchObject({
      cliModel: 'kimi-k2.5',
      providerEnv: {
        COPILOT_PROVIDER_BASE_URL: 'https://api.moonshot.oo/v1',
        COPILOT_PROVIDER_API_KEY: 'kimi-key',
        COPILOT_PROVIDER_MODEL_ID: 'kimi-k2.5',
        COPILOT_PROVIDER_WIRE_MODEL: 'kimi-k2.5',
        COPILOT_PROVIDER_TYPE: 'openai'
      }
    })
  })

  it('routes a Provider Profile with its own API key', () => {
    const { ctx } = makeCtx({
      configs: [{
        modelServices: {
          deepseek: {
            kind: 'collection',
            provider: 'deepseek',
            profiles: {
              work: { apiKey: 'work-key' }
            }
          }
        }
      }, undefined]
    })

    expect(resolveCopilotModelConfig(ctx, 'deepseek/work,deepseek-chat')).toMatchObject({
      cliModel: 'deepseek-chat',
      routedServiceKey: 'deepseek/work',
      providerEnv: {
        COPILOT_PROVIDER_API_KEY: 'work-key',
        COPILOT_PROVIDER_BASE_URL: 'https://api.deepseek.com'
      }
    })
  })

  it('normalizes responses provider base URLs when wireApi is responses', () => {
    const { ctx } = makeCtx({
      configs: [{
        modelServices: {
          openai: {
            apiBaseUrl: 'https://example.test/v1/responses',
            apiProtocol: 'openai-responses',
            apiKey: 'test-key'
          }
        }
      }, undefined]
    })

    expect(resolveCopilotModelConfig(ctx, 'openai,gpt-5')).toMatchObject({
      providerEnv: {
        COPILOT_PROVIDER_BASE_URL: 'https://example.test/v1',
        COPILOT_PROVIDER_WIRE_API: 'responses'
      }
    })
  })

  it('rejects protocols that the Copilot provider bridge cannot represent', () => {
    const { ctx } = makeCtx({
      configs: [{
        modelServices: {
          anthropic: {
            apiBaseUrl: 'https://api.anthropic.com/v1',
            apiProtocol: 'anthropic-messages',
            apiKey: 'secret'
          }
        }
      }, undefined]
    })

    expect(() => resolveCopilotModelConfig(ctx, 'anthropic,claude-sonnet'))
      .toThrow(/does not support anthropic-messages/)
  })

  it('uses provider default base URLs for routed services without apiBaseUrl', () => {
    const { ctx } = makeCtx({
      configs: [{
        modelServices: {
          kimi: {
            provider: 'moonshot-cn',
            apiKey: 'kimi-key'
          }
        }
      }, undefined]
    })

    expect(resolveCopilotModelConfig(ctx, 'kimi,kimi-k2')).toMatchObject({
      cliModel: 'kimi-k2',
      providerEnv: {
        COPILOT_PROVIDER_BASE_URL: 'https://api.moonshot.cn/v1',
        COPILOT_PROVIDER_API_KEY: 'kimi-key'
      }
    })
  })
})
