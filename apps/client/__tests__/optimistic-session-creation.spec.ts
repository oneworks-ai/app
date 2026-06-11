import { describe, expect, it } from 'vitest'

import type { Session } from '@oneworks/core'

import {
  clearOptimisticSessionDiscarded,
  createOptimisticSessionCreation,
  getActiveOptimisticSessionCreation,
  isOptimisticSessionDiscarded,
  isOptimisticSessionResolvedBySession,
  markOptimisticSessionCreationFailed,
  markOptimisticSessionDiscarded,
  mergeOptimisticSessions
} from '#~/hooks/chat/optimistic-session-creation'

describe('optimistic session creation', () => {
  it('creates a temporary session and initial user message from the first send', () => {
    const creation = createOptimisticSessionCreation({
      id: 'session-1',
      initialMessage: 'Build an optimistic session flow',
      model: 'test-model',
      options: {
        id: 'session-1',
        adapter: 'codex',
        permissionMode: 'acceptEdits'
      }
    }, 123)

    expect(creation.status).toBe('creating')
    expect(creation.message).toMatchObject({
      id: 'session-1:optimistic-user-message',
      role: 'user',
      content: 'Build an optimistic session flow',
      createdAt: 123
    })
    expect(creation.session).toMatchObject({
      id: 'session-1',
      title: 'Build an optimistic session flow',
      status: 'running',
      lastUserMessage: 'Build an optimistic session flow',
      model: 'test-model',
      adapter: 'codex',
      permissionMode: 'acceptEdits'
    })
  })

  it('does not let stale optimistic state override a real SWR session', () => {
    const realSession: Session = {
      id: 'session-1',
      title: 'Created for real',
      createdAt: 100,
      status: 'completed'
    }
    const creation = markOptimisticSessionCreationFailed(
      createOptimisticSessionCreation({
        id: 'session-1',
        initialMessage: 'Retry me',
        options: { id: 'session-1' }
      }, 101),
      'Worktree failed'
    )

    expect(mergeOptimisticSessions([realSession], { 'session-1': creation })).toEqual([
      realSession
    ])
    expect(getActiveOptimisticSessionCreation(realSession, { 'session-1': creation })).toBeUndefined()
    expect(getActiveOptimisticSessionCreation(creation.session, { 'session-1': creation })).toBe(creation)
  })

  it('lets real session state replace failed optimistic state after the backend succeeds', () => {
    const creation = markOptimisticSessionCreationFailed(
      createOptimisticSessionCreation({
        id: 'session-1',
        initialMessage: 'hi',
        options: { id: 'session-1' }
      }, 101),
      'Request timed out'
    )
    const completedSession: Session = {
      id: 'session-1',
      title: 'hi',
      createdAt: 100,
      messageCount: 3,
      lastMessage: 'hello',
      status: 'completed'
    }

    expect(isOptimisticSessionResolvedBySession(creation, completedSession)).toBe(true)
    expect(mergeOptimisticSessions([completedSession], { 'session-1': creation })).toEqual([
      completedSession
    ])
  })

  it('tracks discarded optimistic session ids outside React component lifetime', () => {
    clearOptimisticSessionDiscarded('session-1')
    expect(isOptimisticSessionDiscarded('session-1')).toBe(false)

    markOptimisticSessionDiscarded('session-1')
    expect(isOptimisticSessionDiscarded('session-1')).toBe(true)

    clearOptimisticSessionDiscarded('session-1')
    expect(isOptimisticSessionDiscarded('session-1')).toBe(false)
  })
})
