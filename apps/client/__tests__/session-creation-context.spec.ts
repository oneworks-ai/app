import { describe, expect, it } from 'vitest'

import {
  hasPersistedSessionCreationTarget,
  shouldUsePendingSessionCreationContext
} from '#~/hooks/chat/session-creation-context'

describe('session creation context', () => {
  it('keeps pending context for the empty new-session placeholder', () => {
    expect(hasPersistedSessionCreationTarget(undefined)).toBe(false)
    expect(hasPersistedSessionCreationTarget({ id: '' })).toBe(false)
    expect(shouldUsePendingSessionCreationContext({ id: '' })).toBe(true)
  })

  it('clears pending context once a real session id exists', () => {
    expect(hasPersistedSessionCreationTarget({ id: 'session-1' })).toBe(true)
    expect(shouldUsePendingSessionCreationContext({ id: 'session-1' })).toBe(false)
  })
})
