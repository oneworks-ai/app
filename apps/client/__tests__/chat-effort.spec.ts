import { describe, expect, it } from 'vitest'

import { resolveAdapterModelRuntimeCapabilities } from '#~/hooks/chat/model-runtime-capabilities'
import { CHAT_EFFORT_OPTIONS, resolvePreferredChatEffort } from '#~/hooks/chat/use-chat-effort'

describe('chat effort preference', () => {
  it('keeps only explicit effort levels in the slider options', () => {
    expect(CHAT_EFFORT_OPTIONS.map(option => option.value)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultra'
    ])
  })

  it('uses model metadata for supported efforts and Fast availability', () => {
    expect(resolveAdapterModelRuntimeCapabilities({
      adapter: 'codex',
      model: 'gpt-next',
      adapterBuiltinModels: {
        codex: [{
          value: 'gpt-next',
          title: 'GPT Next',
          description: 'Next Codex model',
          defaultEffort: 'high',
          supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
          serviceTiers: [{ id: 'priority', name: 'Fast', description: 'Faster responses' }]
        }]
      }
    })).toEqual({
      defaultEffort: 'high',
      supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      supportsFastMode: true
    })
  })

  it('does not expose native Fast mode for routed model services', () => {
    expect(
      resolveAdapterModelRuntimeCapabilities({
        adapter: 'codex',
        model: 'openai,gpt-next',
        adapterBuiltinModels: {
          codex: [{
            value: 'gpt-next',
            title: 'GPT Next',
            description: 'Next Codex model',
            serviceTiers: [{ id: 'priority', name: 'Fast', description: 'Faster responses' }]
          }]
        }
      }).supportsFastMode
    ).toBe(false)
  })

  it('prefers the last explicit selection over configured effort', () => {
    expect(resolvePreferredChatEffort({
      configuredEffort: 'low',
      storedEffort: 'high'
    })).toBe('high')
  })

  it('uses configured effort when there is no explicit stored selection', () => {
    expect(resolvePreferredChatEffort({
      configuredEffort: 'max',
      storedEffort: 'default'
    })).toBe('max')
  })

  it('falls back to medium when neither source is explicit', () => {
    expect(resolvePreferredChatEffort({
      configuredEffort: 'default',
      storedEffort: undefined
    })).toBe('medium')
  })

  it('clamps stored and configured values to the selected model capabilities', () => {
    expect(resolvePreferredChatEffort({
      configuredEffort: 'ultra',
      storedEffort: 'max',
      fallbackEffort: 'high',
      supportedEfforts: ['low', 'medium', 'high']
    })).toBe('high')
  })
})
