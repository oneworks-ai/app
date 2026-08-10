// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { SWRConfig, unstable_serialize } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GitRepositoryState } from '@oneworks/types'

import {
  SESSION_GIT_STATE_DEDUPING_INTERVAL_MS,
  SESSION_GIT_STATE_REFRESH_INTERVAL_MS,
  useSessionGitState
} from '#~/components/chat/git-controls/use-session-git-state'

const mocks = vi.hoisted(() => ({
  getSessionGitState: vi.fn()
}))

vi.mock('#~/api', () => ({
  getSessionGitState: mocks.getSessionGitState
}))

interface Deferred<T> {
  promise: Promise<T>
  reject: (error: unknown) => void
  resolve: (value: T) => void
}

const deferred = <T,>(): Deferred<T> => {
  let reject!: (error: unknown) => void
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}

const cleanState = (branch = 'main'): GitRepositoryState => ({
  available: true,
  cwd: '/workspace',
  repositoryRoot: '/workspace',
  currentBranch: branch,
  hasChanges: false,
  hasStagedChanges: false,
  hasUnstagedChanges: false,
  hasUntrackedChanges: false,
  changedFiles: [],
  stagedSummary: { changedFiles: 0, additions: 0, deletions: 0 },
  workingTreeSummary: { changedFiles: 0, additions: 0, deletions: 0 }
})

const dirtyState = (branch = 'main', changedFiles = 1): GitRepositoryState => ({
  ...cleanState(branch),
  hasChanges: true,
  hasUnstagedChanges: true,
  changedFiles: Array.from({ length: changedFiles }, (_, index) => ({
    path: `src/file-${index + 1}.ts`,
    staged: false,
    unstaged: true,
    untracked: false
  })),
  workingTreeSummary: { changedFiles, additions: changedFiles, deletions: 0 }
})

describe('chat Git state refresh behavior', () => {
  let container: HTMLDivElement
  let root: Root
  let rootMounted: boolean
  let sessionId: string
  let states: Array<ReturnType<typeof useSessionGitState>>

  const flushMicrotasks = async () => {
    await Promise.resolve()
    await Promise.resolve()
  }

  const renderHooks = async (consumerCount = 1, initialState = cleanState()) => {
    function Harness({ index }: { index: number }) {
      states[index] = useSessionGitState(sessionId)
      return (
        <output
          data-branch={states[index]?.data?.currentBranch ?? ''}
          data-changes={String(states[index]?.data?.hasChanges === true)}
          data-refreshing={String(states[index]?.isValidating === true)}
        />
      )
    }

    const cacheKey = unstable_serialize(['session-git-state', sessionId])
    await act(async () => {
      root.render(
        <SWRConfig
          value={{
            fallback: { [cacheKey]: initialState },
            provider: () => new Map(),
            revalidateOnMount: false,
            shouldRetryOnError: false
          }}
        >
          {Array.from({ length: consumerCount }, (_, index) => <Harness key={index} index={index} />)}
        </SWRConfig>
      )
      await flushMicrotasks()
    })
  }

  const advanceClock = async (milliseconds: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(milliseconds)
      await flushMicrotasks()
    })
  }

  const setVisibility = (visibilityState: DocumentVisibilityState) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: visibilityState
    })
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.useFakeTimers()
    mocks.getSessionGitState.mockReset()
    states = []
    sessionId = `session-${Math.random()}`
    setVisibility('visible')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    rootMounted = true
  })

  afterEach(async () => {
    if (rootMounted) {
      await act(async () => root.unmount())
    }
    container.remove()
    setVisibility('visible')
    vi.useRealTimers()
  })

  it('moves from clean to externally dirty on the visible-page cadence', async () => {
    mocks.getSessionGitState.mockResolvedValue(dirtyState())
    await renderHooks()

    await advanceClock(SESSION_GIT_STATE_REFRESH_INTERVAL_MS - 1)
    expect(mocks.getSessionGitState).not.toHaveBeenCalled()
    expect(container.querySelector('output')?.dataset.changes).toBe('false')

    await advanceClock(1)

    expect(mocks.getSessionGitState).toHaveBeenCalledOnce()
    expect(container.querySelector('output')?.dataset.changes).toBe('true')
  })

  it('publishes a batch edit as one consolidated snapshot', async () => {
    mocks.getSessionGitState.mockResolvedValue(dirtyState('main', 3))
    await renderHooks()

    await advanceClock(SESSION_GIT_STATE_REFRESH_INTERVAL_MS)

    expect(states[0]?.data?.changedFiles).toHaveLength(3)
    expect(states[0]?.data?.workingTreeSummary).toEqual({
      changedFiles: 3,
      additions: 3,
      deletions: 0
    })
  })

  it('keeps a branch mutation result ahead of a stale in-flight poll', async () => {
    const stalePoll = deferred<GitRepositoryState>()
    mocks.getSessionGitState.mockReturnValue(stalePoll.promise)
    await renderHooks()
    await advanceClock(SESSION_GIT_STATE_REFRESH_INTERVAL_MS)

    const switchedState = dirtyState('feature/refresh-git')
    await act(async () => {
      await states[0]?.mutate(switchedState, { revalidate: false })
    })
    expect(container.querySelector('output')?.dataset.branch).toBe('feature/refresh-git')

    await act(async () => {
      stalePoll.resolve(cleanState('main'))
      await stalePoll.promise
      await flushMicrotasks()
    })

    expect(container.querySelector('output')?.dataset.branch).toBe('feature/refresh-git')
    expect(container.querySelector('output')?.dataset.changes).toBe('true')
  })

  it('suppresses polling while hidden and resumes on the next visible cadence', async () => {
    mocks.getSessionGitState.mockResolvedValue(dirtyState())
    setVisibility('hidden')
    await renderHooks()

    await advanceClock(SESSION_GIT_STATE_REFRESH_INTERVAL_MS * 2)
    expect(mocks.getSessionGitState).not.toHaveBeenCalled()

    setVisibility('visible')
    await advanceClock(SESSION_GIT_STATE_REFRESH_INTERVAL_MS)
    expect(mocks.getSessionGitState).toHaveBeenCalledOnce()
  })

  it('cleans up the cadence timer when the hook unmounts', async () => {
    mocks.getSessionGitState.mockResolvedValue(dirtyState())
    await renderHooks()

    await act(async () => root.unmount())
    rootMounted = false
    await advanceClock(SESSION_GIT_STATE_REFRESH_INTERVAL_MS * 2)

    expect(mocks.getSessionGitState).not.toHaveBeenCalled()
  })

  it('deduplicates the cadence fetch across consumers of the same key', async () => {
    const sharedPoll = deferred<GitRepositoryState>()
    mocks.getSessionGitState.mockReturnValue(sharedPoll.promise)
    await renderHooks(2)

    await advanceClock(SESSION_GIT_STATE_REFRESH_INTERVAL_MS)

    expect(SESSION_GIT_STATE_DEDUPING_INTERVAL_MS).toBeGreaterThan(0)
    expect(mocks.getSessionGitState).toHaveBeenCalledOnce()
    await act(async () => {
      sharedPoll.resolve(dirtyState())
      await sharedPoll.promise
      await flushMicrotasks()
    })
  })

  it('deduplicates double explicit activation and exposes in-flight state', async () => {
    const explicitRefresh = deferred<GitRepositoryState>()
    mocks.getSessionGitState.mockReturnValue(explicitRefresh.promise)
    await renderHooks()

    let firstRefresh!: Promise<GitRepositoryState>
    let secondRefresh!: Promise<GitRepositoryState>
    act(() => {
      firstRefresh = states[0]!.refresh()
      secondRefresh = states[0]!.refresh()
    })

    expect(mocks.getSessionGitState).toHaveBeenCalledOnce()
    expect(container.querySelector('output')?.dataset.refreshing).toBe('true')

    await act(async () => {
      explicitRefresh.resolve(dirtyState())
      await Promise.all([firstRefresh, secondRefresh])
      await flushMicrotasks()
    })

    expect(container.querySelector('output')?.dataset.refreshing).toBe('false')
    expect(container.querySelector('output')?.dataset.changes).toBe('true')
  })

  it('rejects an explicit refresh failure without replacing the current snapshot', async () => {
    const refreshError = new Error('git status unavailable')
    mocks.getSessionGitState.mockRejectedValue(refreshError)
    await renderHooks()

    await act(async () => {
      await expect(states[0]!.refresh()).rejects.toBe(refreshError)
    })

    expect(container.querySelector('output')?.dataset.changes).toBe('false')
    expect(container.querySelector('output')?.dataset.refreshing).toBe('false')
  })
})
