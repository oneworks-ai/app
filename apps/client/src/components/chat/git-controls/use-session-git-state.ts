import { useCallback, useEffect, useRef, useState } from 'react'
import useSWR from 'swr'

import type { GitRepositoryState } from '@oneworks/types'

import { getSessionGitState } from '#~/api'

export const SESSION_GIT_STATE_REFRESH_INTERVAL_MS = 10_000
export const SESSION_GIT_STATE_DEDUPING_INTERVAL_MS = 2_000

export const sessionGitStateRevalidateOptions = {
  dedupingInterval: SESSION_GIT_STATE_DEDUPING_INTERVAL_MS,
  focusThrottleInterval: 0,
  refreshInterval: SESSION_GIT_STATE_REFRESH_INTERVAL_MS,
  refreshWhenHidden: false,
  refreshWhenOffline: false,
  revalidateOnFocus: true
} as const

const explicitRefreshes = new Map<string, Promise<GitRepositoryState>>()

const requestSessionGitState = (sessionId: string) => {
  const activeRequest = explicitRefreshes.get(sessionId)
  if (activeRequest != null) {
    return activeRequest
  }

  const request = getSessionGitState(sessionId).finally(() => {
    if (explicitRefreshes.get(sessionId) === request) {
      explicitRefreshes.delete(sessionId)
    }
  })
  explicitRefreshes.set(sessionId, request)
  return request
}

export function useSessionGitState(sessionId: string) {
  const mountedRef = useRef(false)
  const [isExplicitlyRefreshing, setIsExplicitlyRefreshing] = useState(false)
  const state = useSWR<GitRepositoryState>(
    ['session-git-state', sessionId],
    () => getSessionGitState(sessionId),
    sessionGitStateRevalidateOptions
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    if (mountedRef.current) {
      setIsExplicitlyRefreshing(true)
    }

    try {
      const nextState = await requestSessionGitState(sessionId)
      await state.mutate(nextState, { revalidate: false })
      return nextState
    } finally {
      if (mountedRef.current) {
        setIsExplicitlyRefreshing(false)
      }
    }
  }, [sessionId, state.mutate])

  return {
    ...state,
    isValidating: state.isValidating || isExplicitlyRefreshing,
    refresh
  }
}
