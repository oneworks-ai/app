import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  reportDesktopFirstActionClientEvent,
  reportDesktopFirstActionClientEventStreamOpen
} from '#~/hooks/use-client-event-stream'

const mocks = vi.hoisted(() => ({
  messageObserved: vi.fn(),
  resetSource: vi.fn(),
  statusObserved: vi.fn()
}))

vi.mock('#~/diagnostics/desktop-first-action-runtime', () => ({
  beginDesktopFirstAction: vi.fn(),
  markDesktopFirstActionAccepted: vi.fn(),
  markDesktopFirstActionClientEventMessageObserved: mocks.messageObserved,
  markDesktopFirstActionClientEventSourceReset: mocks.resetSource,
  markDesktopFirstActionClientEventStatusObserved: mocks.statusObserved,
  markDesktopFirstActionSubmitted: vi.fn()
}))

describe('client event stream first-action diagnostics', () => {
  beforeEach(() => vi.clearAllMocks())

  it('observes background response and completion events outside the active session route', () => {
    const message = {
      content: 'Background response',
      createdAt: 101,
      id: 'assistant-1',
      role: 'assistant' as const
    }

    reportDesktopFirstActionClientEvent({
      channel: 'sessions',
      emittedAt: 101,
      event: { message, type: 'message' },
      sessionId: 'session-1',
      type: 'session_message_appended'
    })
    reportDesktopFirstActionClientEvent({
      channel: 'sessions',
      emittedAt: 102,
      session: { createdAt: 1, id: 'session-1', status: 'completed' },
      type: 'session_updated'
    })

    expect(mocks.messageObserved).toHaveBeenCalledWith('session-1', message)
    expect(mocks.statusObserved).toHaveBeenCalledWith('session-1', 'completed')
  })

  it('starts a fresh causal generation whenever the event stream opens', () => {
    reportDesktopFirstActionClientEventStreamOpen()

    expect(mocks.resetSource).toHaveBeenCalledTimes(1)
  })

  it('ignores deleted sessions and unrelated event payloads', () => {
    reportDesktopFirstActionClientEvent({
      channel: 'sessions',
      emittedAt: 101,
      session: { id: 'session-1', isDeleted: true },
      type: 'session_updated'
    })
    reportDesktopFirstActionClientEvent({
      channel: 'sessions',
      emittedAt: 101,
      sessionId: 'session-1',
      type: 'session_message_appended'
    })

    expect(mocks.messageObserved).not.toHaveBeenCalled()
    expect(mocks.statusObserved).not.toHaveBeenCalled()
  })

  it('does not treat a running status as action-level causal evidence', () => {
    reportDesktopFirstActionClientEvent({
      channel: 'sessions',
      session: { createdAt: 1, id: 'session-1', status: 'running' },
      type: 'session_updated'
    })

    expect(mocks.messageObserved).not.toHaveBeenCalled()
    expect(mocks.statusObserved).not.toHaveBeenCalled()
  })

  it('forwards failed and terminated terminal outcomes', () => {
    for (const status of ['failed', 'terminated'] as const) {
      reportDesktopFirstActionClientEvent({
        channel: 'sessions',
        session: { createdAt: 1, id: `session-${status}`, status },
        type: 'session_updated'
      })
    }

    expect(mocks.statusObserved.mock.calls).toEqual([
      ['session-failed', 'failed'],
      ['session-terminated', 'terminated']
    ])
  })
})
