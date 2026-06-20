import { describe, expect, it } from 'vitest'

import { parseModelServiceQueryImport } from '#~/components/config/modelServiceQueryImport'

describe('model service query import', () => {
  it('parses JSON model service configs from query params', () => {
    const params = new URLSearchParams({
      modelServiceKey: 'Kimi Code',
      modelServiceConfig: JSON.stringify({
        provider: 'kimi-code',
        apiKey: 'secret',
        models: ['kimi-for-coding']
      })
    })

    expect(parseModelServiceQueryImport(params)).toEqual({
      key: 'kimi-code',
      service: {
        provider: 'kimi-code',
        apiKey: 'secret',
        models: ['kimi-for-coding']
      }
    })
  })

  it('parses direct model service params on the modelServices tab', () => {
    const params = new URLSearchParams({
      tab: 'modelServices',
      provider: 'openai',
      api_key: 'secret',
      base_url: 'https://api.openai.com/v1',
      model: 'gpt-5'
    })

    expect(parseModelServiceQueryImport(params)).toEqual({
      key: 'openai',
      service: {
        provider: 'openai',
        apiKey: 'secret',
        apiBaseUrl: 'https://api.openai.com/v1',
        models: ['gpt-5']
      }
    })
  })

  it('parses direct params when an explicit import action is present', () => {
    const params = new URLSearchParams({
      action: 'createModelService',
      title: 'Custom Gateway',
      apiBaseUrl: 'https://gateway.example.com/v1',
      models: 'model-a, model-b'
    })

    expect(parseModelServiceQueryImport(params)).toEqual({
      key: 'custom-gateway',
      service: {
        title: 'Custom Gateway',
        apiKey: '',
        apiBaseUrl: 'https://gateway.example.com/v1',
        models: ['model-a', 'model-b']
      }
    })
  })

  it('ignores unrelated query params', () => {
    expect(parseModelServiceQueryImport(new URLSearchParams({ tab: 'general', provider: 'openai' }))).toBeUndefined()
  })
})
