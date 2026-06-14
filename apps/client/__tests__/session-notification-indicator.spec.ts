import { describe, expect, it } from 'vitest'

import type { Session } from '@oneworks/core'

import {
  getSessionNotificationFingerprint,
  isSessionNotificationMarkedRead,
  resolveSessionNotificationIndicator
} from '../src/components/chat/session-notification-indicator'

const makeSession = (overrides: Partial<Session>): Session => ({
  createdAt: 1,
  id: 'session-1',
  ...overrides
})

describe('session notification indicator', () => {
  it('uses animated primary state while the session is running', () => {
    expect(resolveSessionNotificationIndicator(makeSession({ status: 'running' }))).toEqual({
      animated: true,
      status: 'running',
      tone: 'primary'
    })
  })

  it('uses warning and error tones for actionable or failed sessions', () => {
    expect(resolveSessionNotificationIndicator(makeSession({ status: 'waiting_input' }))).toEqual({
      status: 'waiting_input',
      tone: 'warning'
    })
    expect(resolveSessionNotificationIndicator(makeSession({ status: 'failed' }))).toEqual({
      status: 'failed',
      tone: 'error'
    })
  })

  it('only shows completed notifications until the current result is read', () => {
    const session = makeSession({ lastMessage: 'done', messageCount: 2, status: 'completed' })
    const marker = {
      fingerprint: getSessionNotificationFingerprint(session),
      sessionId: session.id
    }

    expect(resolveSessionNotificationIndicator(session)).toEqual({
      status: 'completed',
      tone: 'primary'
    })
    expect(isSessionNotificationMarkedRead(session, marker)).toBe(true)
    expect(resolveSessionNotificationIndicator(session, { completedRead: true })).toBeNull()
  })
})
