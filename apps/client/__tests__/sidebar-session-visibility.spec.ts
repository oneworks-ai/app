import { describe, expect, it } from 'vitest'

import type { Session } from '@oneworks/core'

import { isMessageVersionSession, isSidebarVisibleSession } from '#~/components/sidebar/session-visibility'

const createSession = (session: Partial<Session> & Pick<Session, 'id'>): Session => ({
  createdAt: 1,
  ...session
})

describe('sidebar session visibility', () => {
  it('hides message version sessions from the sidebar', () => {
    const session = createSession({
      id: 'edit-session',
      messageBranchGroupId: 'group-1',
      messageBranchAction: 'edit',
      parentSessionId: 'root-session'
    })

    expect(isMessageVersionSession(session)).toBe(true)
    expect(isSidebarVisibleSession(session)).toBe(false)
  })

  it('keeps regular child sessions visible', () => {
    const session = createSession({
      id: 'regular-child',
      parentSessionId: 'root-session'
    })

    expect(isMessageVersionSession(session)).toBe(false)
    expect(isSidebarVisibleSession(session)).toBe(true)
  })
})
