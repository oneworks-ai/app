import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '#~/db/index.js'
import {
  SessionCreationWaitError,
  beginSessionCreation,
  resetSessionCreationLifecycleState,
  waitForSessionCreation
} from '#~/services/session/creation-lifecycle.js'

vi.mock('#~/db/index.js', () => ({
  getDb: vi.fn()
}))

describe('session creation lifecycle', () => {
  const getSession = vi.fn()

  beforeEach(() => {
    vi.useRealTimers()
    resetSessionCreationLifecycleState()
    vi.clearAllMocks()
    getSession.mockReturnValue(undefined)
    vi.mocked(getDb).mockReturnValue({ getSession } as any)
  })

  it('keeps an early waiter pending until HTTP creation completes', async () => {
    const waitPromise = waitForSessionCreation('sess-early')
    const attempt = beginSessionCreation('sess-early')
    let settled = false
    void waitPromise.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )

    await Promise.resolve()
    expect(settled).toBe(false)

    attempt.complete()

    await expect(waitPromise).resolves.toBeUndefined()
  })

  it('does not fail waiters while another creation attempt is still active', async () => {
    const firstAttempt = beginSessionCreation('sess-overlap')
    const secondAttempt = beginSessionCreation('sess-overlap')
    const waitPromise = waitForSessionCreation('sess-overlap')
    let settled = false
    void waitPromise.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )

    firstAttempt.fail(new Error('first failed'))
    await Promise.resolve()
    expect(settled).toBe(false)

    secondAttempt.fail(new Error('second failed'))

    await expect(waitPromise).rejects.toBeInstanceOf(SessionCreationWaitError)
  })

  it('resolves all waiters as soon as one overlapping attempt succeeds', async () => {
    const firstAttempt = beginSessionCreation('sess-success')
    const secondAttempt = beginSessionCreation('sess-success')
    const firstWaiter = waitForSessionCreation('sess-success')
    const secondWaiter = waitForSessionCreation('sess-success')

    firstAttempt.complete()
    secondAttempt.fail(new Error('late duplicate failed'))

    await expect(Promise.all([firstWaiter, secondWaiter])).resolves.toEqual([undefined, undefined])
  })

  it('returns immediately for an already-created session', async () => {
    getSession.mockReturnValue({ id: 'sess-existing' })

    await expect(waitForSessionCreation('sess-existing')).resolves.toBeUndefined()
  })

  it('times out when neither a session nor a creation attempt appears', async () => {
    vi.useFakeTimers()
    const waitPromise = waitForSessionCreation('sess-missing', { timeoutMs: 100 })
    const rejection = expect(waitPromise).rejects.toMatchObject({
      code: 'session_creation_wait_failed',
      message: 'Session creation timed out'
    })

    await vi.advanceTimersByTimeAsync(100)

    await rejection
  })

  it('stops the wait timeout once HTTP creation begins', async () => {
    vi.useFakeTimers()
    const waitPromise = waitForSessionCreation('sess-slow', { timeoutMs: 100 })
    const attempt = beginSessionCreation('sess-slow')
    let settled = false
    void waitPromise.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )

    await vi.advanceTimersByTimeAsync(1_000)
    expect(settled).toBe(false)

    attempt.complete()
    await expect(waitPromise).resolves.toBeUndefined()
  })
})
