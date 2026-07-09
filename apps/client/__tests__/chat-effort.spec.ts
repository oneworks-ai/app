import { describe, expect, it } from 'vitest'

import { CHAT_EFFORT_OPTIONS, resolvePreferredChatEffort } from '#~/hooks/chat/use-chat-effort'

describe('chat effort preference', () => {
  it('keeps only explicit effort levels in the slider options', () => {
    expect(CHAT_EFFORT_OPTIONS.map(option => option.value)).toEqual([
      'low',
      'medium',
      'high',
      'max'
    ])
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
})
