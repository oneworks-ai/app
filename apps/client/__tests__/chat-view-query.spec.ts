import { describe, expect, it } from 'vitest'

import { normalizeChatView } from '#~/hooks/chat/use-chat-view'

describe('chat view query normalization', () => {
  it('gates the unfinished timeline view behind the experiment flag', () => {
    expect(normalizeChatView('timeline')).toBe('history')
    expect(normalizeChatView('timeline', { enableTimelineView: false })).toBe('history')
    expect(normalizeChatView('timeline', { enableTimelineView: true })).toBe('timeline')
  })

  it('downgrades removed settings view links to history', () => {
    expect(normalizeChatView('settings', { enableTimelineView: true })).toBe('history')
    expect(normalizeChatView('unknown', { enableTimelineView: true })).toBe('history')
  })
})
