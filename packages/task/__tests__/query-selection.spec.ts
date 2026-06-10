import { describe, expect, it } from 'vitest'

import { resolveQuerySelection } from '#~/query-selection.js'

describe('resolveQuerySelection', () => {
  it('prefers defaultModelService when an explicit bare model matches multiple services', () => {
    const selection = resolveQuerySelection({
      mergedConfig: {
        adapters: {
          codex: {},
          'claude-code': {}
        },
        modelServices: {
          gpt: {
            apiBaseUrl: 'https://search.example.com/gpt',
            apiKey: 'token-gpt',
            models: ['gpt-5.4-2026-03-05']
          },
          'gpt-responses': {
            apiBaseUrl: 'https://responses.example.com',
            apiKey: 'token-responses',
            models: ['gpt-5.4-2026-03-05']
          }
        },
        defaultModelService: 'gpt-responses'
      } as any,
      inputModel: 'gpt-5.4-2026-03-05'
    })

    expect(selection.model).toBe('gpt-responses,gpt-5.4-2026-03-05')
  })

  it('infers the adapter from an adapter-prefixed model selector when adapter is omitted', () => {
    const selection = resolveQuerySelection({
      mergedConfig: {
        adapters: {
          codex: {},
          'claude-code': {}
        },
        modelServices: {
          openai: {
            apiBaseUrl: 'https://responses.example.com',
            apiKey: 'token-openai',
            models: ['gpt-5.4']
          }
        },
        defaultAdapter: 'claude-code',
        defaultModelService: 'openai'
      } as any,
      inputModel: 'codex/gpt-5.4'
    })

    expect(selection).toEqual({
      adapter: 'codex',
      model: 'openai,gpt-5.4'
    })
  })

  it('uses codex as the runtime adapter fallback when no project config is present', () => {
    const selection = resolveQuerySelection({
      mergedConfig: {}
    })

    expect(selection).toEqual({
      adapter: 'codex',
      model: undefined
    })
  })
})
