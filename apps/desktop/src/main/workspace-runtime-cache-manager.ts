export interface WorkspaceRuntimeCacheRefreshResult {
  changed: number
  source: 'bootstrap' | 'bundled'
  summary?: string
  total: number
}

export interface WorkspaceRuntimeCacheSnapshot {
  attempts: number
  error?: {
    message: string
    name: string
  }
  result?: WorkspaceRuntimeCacheRefreshResult
  status: 'error' | 'idle' | 'ready' | 'running' | 'scheduled' | 'stopped'
}

interface WorkspaceRuntimeCacheManagerOptions {
  now?: () => number
  onError?: (error: unknown) => void
  runRefresh: (signal: AbortSignal) => Promise<WorkspaceRuntimeCacheRefreshResult>
}

export interface WorkspaceRuntimeCacheManager {
  getSnapshot: () => WorkspaceRuntimeCacheSnapshot
  refresh: () => Promise<WorkspaceRuntimeCacheSnapshot>
  schedule: (delayMs?: number) => void
  stop: () => Promise<void>
}

const describeError = (error: unknown) => ({
  message: error instanceof Error ? error.message : String(error),
  name: error instanceof Error ? error.name : 'UnknownError'
})

export const createWorkspaceRuntimeCacheManager = ({
  now = Date.now,
  onError,
  runRefresh
}: WorkspaceRuntimeCacheManagerOptions): WorkspaceRuntimeCacheManager => {
  let activeController: AbortController | undefined
  let activeRefresh: Promise<WorkspaceRuntimeCacheSnapshot> | undefined
  let scheduledAt: number | undefined
  let scheduledTimer: ReturnType<typeof setTimeout> | undefined
  let snapshot: WorkspaceRuntimeCacheSnapshot = {
    attempts: 0,
    status: 'idle'
  }

  const getSnapshot = () => ({
    ...snapshot,
    ...(snapshot.error == null ? {} : { error: { ...snapshot.error } }),
    ...(snapshot.result == null ? {} : { result: { ...snapshot.result } })
  })

  const clearScheduledRefresh = () => {
    if (scheduledTimer != null) {
      clearTimeout(scheduledTimer)
      scheduledTimer = undefined
    }
    scheduledAt = undefined
  }

  const refresh = (): Promise<WorkspaceRuntimeCacheSnapshot> => {
    if (snapshot.status === 'stopped') {
      return Promise.reject(new Error('Workspace runtime cache manager is stopped.'))
    }
    if (snapshot.status === 'ready') return Promise.resolve(getSnapshot())
    if (activeRefresh != null) return activeRefresh

    clearScheduledRefresh()
    activeController = new AbortController()
    snapshot = {
      attempts: snapshot.attempts + 1,
      status: 'running'
    }
    const controller = activeController
    const refreshPromise = Promise.resolve()
      .then(() => runRefresh(controller.signal))
      .then((result) => {
        if (snapshot.status === 'stopped') return getSnapshot()
        snapshot = {
          attempts: snapshot.attempts,
          result,
          status: 'ready'
        }
        return getSnapshot()
      })
      .catch((error: unknown) => {
        if (snapshot.status !== 'stopped') {
          snapshot = {
            attempts: snapshot.attempts,
            error: describeError(error),
            status: 'error'
          }
          onError?.(error)
        }
        throw error
      })
      .finally(() => {
        if (activeRefresh === refreshPromise) {
          activeController = undefined
          activeRefresh = undefined
        }
      })
    activeRefresh = refreshPromise
    return refreshPromise
  }

  const schedule = (delayMs = 0) => {
    if (
      snapshot.status === 'ready' ||
      snapshot.status === 'running' ||
      snapshot.status === 'stopped'
    ) {
      return
    }

    const normalizedDelayMs = Math.max(0, delayMs)
    const nextScheduledAt = now() + normalizedDelayMs
    if (scheduledAt != null && scheduledAt <= nextScheduledAt) return

    clearScheduledRefresh()
    scheduledAt = nextScheduledAt
    snapshot = {
      attempts: snapshot.attempts,
      status: 'scheduled'
    }
    scheduledTimer = setTimeout(() => {
      scheduledTimer = undefined
      scheduledAt = undefined
      void refresh().catch(() => undefined)
    }, normalizedDelayMs)
    scheduledTimer.unref?.()
  }

  const stop = async () => {
    if (snapshot.status === 'stopped') {
      await activeRefresh?.catch(() => undefined)
      return
    }

    clearScheduledRefresh()
    snapshot = {
      attempts: snapshot.attempts,
      status: 'stopped'
    }
    activeController?.abort()
    await activeRefresh?.catch(() => undefined)
  }

  return {
    getSnapshot,
    refresh,
    schedule,
    stop
  }
}
