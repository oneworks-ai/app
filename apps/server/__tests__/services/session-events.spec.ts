import type { Session, SessionStatus, WSEvent } from '@oneworks/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '#~/db/index.js'
import { applySessionEvent } from '#~/services/session/events.js'

vi.mock('#~/db/index.js', () => ({
  getDb: vi.fn()
}))

describe('applySessionEvent terminal status', () => {
  let session: Session
  const broadcast = vi.fn()
  const onSessionUpdated = vi.fn()
  const saveMessage = vi.fn(() => true)
  const getSessionStatus = vi.fn(() => session.status)
  const getSession = vi.fn(() => session)
  const updateSession = vi.fn((_id: string, updates: Partial<Session>) => {
    session = { ...session, ...updates }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    session = {
      id: 'session-1',
      createdAt: 1,
      messageCount: 0,
      status: 'terminated',
      title: 'Session'
    }
    vi.mocked(getDb).mockReturnValue({
      getSession,
      getSessionStatus,
      saveMessage,
      updateSession
    } as any)
  })

  it.each<SessionStatus>(['failed', 'terminated'])(
    'persists and broadcasts a late fatal error without replacing %s',
    (status) => {
      session = { ...session, status }
      const event: WSEvent = {
        type: 'error',
        data: { message: 'late runtime error', fatal: true },
        message: 'late runtime error'
      }

      applySessionEvent(session.id, event, { broadcast, onSessionUpdated })

      expect(saveMessage).toHaveBeenCalledWith(session.id, event)
      expect(getSessionStatus).toHaveBeenCalledWith(session.id)
      expect(updateSession).not.toHaveBeenCalled()
      expect(onSessionUpdated).not.toHaveBeenCalled()
      expect(broadcast).toHaveBeenCalledWith(event)
      expect(session.status).toBe(status)
    }
  )

  it('allows a new running turn to report a fatal failure', () => {
    session = { ...session, status: 'running' }
    const event: WSEvent = {
      type: 'error',
      data: { message: 'current turn failed', fatal: true },
      message: 'current turn failed'
    }

    applySessionEvent(session.id, event, { broadcast, onSessionUpdated })

    expect(updateSession).toHaveBeenCalledWith(session.id, { status: 'failed' })
    expect(onSessionUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
    expect(session.status).toBe('failed')
  })

  it('preserves a late user message while keeping termination authoritative', () => {
    const event: WSEvent = {
      type: 'message',
      message: {
        id: 'late-user-message',
        role: 'user',
        content: 'late content',
        createdAt: 2
      }
    }

    applySessionEvent(session.id, event, { broadcast, onSessionUpdated })

    expect(saveMessage).toHaveBeenCalledWith(session.id, event)
    expect(getSessionStatus).toHaveBeenCalledWith(session.id)
    expect(updateSession).toHaveBeenCalledWith(session.id, {
      lastMessage: 'late content',
      lastUserMessage: 'late content'
    })
    expect(onSessionUpdated).toHaveBeenCalledWith(expect.objectContaining({
      lastMessage: 'late content',
      lastUserMessage: 'late content',
      status: 'terminated'
    }))
    expect(broadcast).toHaveBeenCalledWith(event)
  })

  it('does not read session status for non-status or duplicate events', () => {
    const auditEvent: WSEvent = {
      type: 'adapter_event',
      data: { operation: 'still-running' }
    }

    applySessionEvent(session.id, auditEvent, { broadcast, onSessionUpdated })

    expect(saveMessage).toHaveBeenCalledWith(session.id, auditEvent)
    expect(getSessionStatus).not.toHaveBeenCalled()
    expect(getSession).not.toHaveBeenCalled()
    expect(broadcast).toHaveBeenCalledWith(auditEvent)

    vi.clearAllMocks()
    saveMessage.mockReturnValueOnce(false)
    applySessionEvent(session.id, {
      type: 'error',
      data: { message: 'duplicate', fatal: true },
      message: 'duplicate'
    })

    expect(getSessionStatus).not.toHaveBeenCalled()
  })
})
