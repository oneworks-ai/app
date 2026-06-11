import { describe, expect, it, vi } from 'vitest'

import type { Session } from '@oneworks/core'

import {
  isConfigRelatedDerivedCacheKey,
  mergeSessionDetail,
  revalidateConfigRelatedCaches,
  updateSessionCaches
} from '#~/hooks/session-subscription-cache'

describe('session subscription config cache helpers', () => {
  it('matches adapter and worktree-environment caches that depend on config', () => {
    expect(isConfigRelatedDerivedCacheKey('worktree-environments')).toBe(false)
    expect(isConfigRelatedDerivedCacheKey(['worktree-environment', 'user', 'demo'])).toBe(true)
    expect(isConfigRelatedDerivedCacheKey(['/api/adapters', 'codex', 'gpt-5.4'])).toBe(true)
    expect(isConfigRelatedDerivedCacheKey('/api/adapters/codex/accounts')).toBe(true)
    expect(isConfigRelatedDerivedCacheKey('/api/sessions')).toBe(false)
  })

  it('revalidates config and derived caches after a config update event', async () => {
    const mutate = vi.fn().mockResolvedValue(undefined)

    await revalidateConfigRelatedCaches(mutate)

    expect(mutate).toHaveBeenCalledTimes(3)
    expect(mutate).toHaveBeenNthCalledWith(1, '/api/config')
    expect(mutate).toHaveBeenNthCalledWith(2, 'worktree-environments')
    expect(typeof mutate.mock.calls[2]?.[0]).toBe('function')
  })

  it('merges session updates into the session detail cache', () => {
    const session = {
      id: 'session-1',
      title: 'Initial title',
      status: 'running',
      createdAt: 1
    } as Session

    expect(mergeSessionDetail({ session }, { ...session, status: 'completed' })).toEqual({
      session: {
        ...session,
        status: 'completed'
      }
    })
    expect(mergeSessionDetail({ session }, { id: 'session-1', isDeleted: true })).toBeUndefined()
  })

  it('updates list and detail caches for session_updated events', () => {
    const mutate = vi.fn()
    const session = {
      id: 'session-1',
      title: 'Initial title',
      status: 'completed',
      createdAt: 1
    } as Session

    updateSessionCaches(mutate, session)

    expect(mutate).toHaveBeenCalledTimes(3)
    expect(mutate).toHaveBeenNthCalledWith(1, '/api/sessions', expect.any(Function), false)
    expect(mutate).toHaveBeenNthCalledWith(2, '/api/sessions/archived', expect.any(Function), false)
    expect(mutate).toHaveBeenNthCalledWith(3, '/api/sessions/session-1', expect.any(Function), false)

    const mergeDetail = mutate.mock.calls[2]?.[1] as (prev?: { session: Session }) => { session: Session }
    expect(
      mergeDetail({
        session: {
          ...session,
          status: 'running'
        }
      }).session.status
    ).toBe('completed')
  })
})
