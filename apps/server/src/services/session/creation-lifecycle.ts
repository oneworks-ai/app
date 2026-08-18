import { getDb } from '#~/db/index.js'

const DEFAULT_SESSION_CREATION_WAIT_TIMEOUT_MS = 30_000

interface SessionCreationWaiter {
  resolve: () => void
  reject: (error: Error) => void
  creationStarted: () => void
}

interface SessionCreationState {
  activeAttempts: number
  waiters: Set<SessionCreationWaiter>
}

const sessionCreationStates = new Map<string, SessionCreationState>()

export class SessionCreationWaitError extends Error {
  code = 'session_creation_wait_failed'
  sessionId: string

  constructor(sessionId: string, message: string) {
    super(message)
    this.name = 'SessionCreationWaitError'
    this.sessionId = sessionId
  }
}

const getOrCreateSessionCreationState = (sessionId: string) => {
  const existing = sessionCreationStates.get(sessionId)
  if (existing != null) {
    return existing
  }

  const created: SessionCreationState = {
    activeAttempts: 0,
    waiters: new Set()
  }
  sessionCreationStates.set(sessionId, created)
  return created
}

const settleWaiters = (
  sessionId: string,
  state: SessionCreationState,
  error?: SessionCreationWaitError
) => {
  for (const waiter of [...state.waiters]) {
    if (error == null) {
      waiter.resolve()
    } else {
      waiter.reject(error)
    }
  }

  if (sessionCreationStates.get(sessionId) === state) {
    sessionCreationStates.delete(sessionId)
  }
}

export const beginSessionCreation = (sessionId: string) => {
  const state = getOrCreateSessionCreationState(sessionId)
  state.activeAttempts += 1
  for (const waiter of state.waiters) {
    waiter.creationStarted()
  }
  let settled = false

  return {
    complete: () => {
      if (settled) return
      settled = true
      state.activeAttempts = Math.max(0, state.activeAttempts - 1)
      settleWaiters(sessionId, state)
    },
    fail: (_error: unknown) => {
      if (settled) return
      settled = true
      state.activeAttempts = Math.max(0, state.activeAttempts - 1)
      if (state.activeAttempts === 0) {
        settleWaiters(
          sessionId,
          state,
          new SessionCreationWaitError(sessionId, 'Session creation failed')
        )
      }
    }
  }
}

export const isSessionCreationActive = (sessionId: string) =>
  (sessionCreationStates.get(sessionId)?.activeAttempts ?? 0) > 0

export const waitForSessionCreation = (
  sessionId: string,
  options: {
    signal?: AbortSignal
    timeoutMs?: number
  } = {}
) => {
  const existingState = sessionCreationStates.get(sessionId)
  if (existingState == null && getDb().getSession(sessionId) != null) {
    return Promise.resolve()
  }

  const state = existingState ?? getOrCreateSessionCreationState(sessionId)
  const timeoutMs = options.timeoutMs ?? DEFAULT_SESSION_CREATION_WAIT_TIMEOUT_MS

  return new Promise<void>((resolve, reject) => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined

    const clearWaitTimeout = () => {
      if (timeout != null) {
        clearTimeout(timeout)
        timeout = undefined
      }
    }
    const cleanup = () => {
      clearWaitTimeout()
      options.signal?.removeEventListener('abort', handleAbort)
      state.waiters.delete(waiter)
      if (state.activeAttempts === 0 && state.waiters.size === 0 && sessionCreationStates.get(sessionId) === state) {
        sessionCreationStates.delete(sessionId)
      }
    }
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error == null) {
        resolve()
      } else {
        reject(error)
      }
    }
    const waiter: SessionCreationWaiter = {
      resolve: () => finish(),
      reject: error => finish(error),
      creationStarted: clearWaitTimeout
    }
    const handleAbort = () => {
      finish(new SessionCreationWaitError(sessionId, 'Session creation wait cancelled'))
    }

    state.waiters.add(waiter)
    if (state.activeAttempts === 0) {
      timeout = setTimeout(() => {
        finish(new SessionCreationWaitError(sessionId, 'Session creation timed out'))
      }, timeoutMs)
    }

    if (options.signal?.aborted === true) {
      handleAbort()
    } else {
      options.signal?.addEventListener('abort', handleAbort, { once: true })
    }
  })
}

export const isSessionCreationWaitError = (error: unknown): error is SessionCreationWaitError => {
  if (error instanceof SessionCreationWaitError) {
    return true
  }
  if (!(error instanceof Error) || !('code' in error)) {
    return false
  }
  return (error as Error & { code?: unknown }).code === 'session_creation_wait_failed'
}

export const resetSessionCreationLifecycleState = () => {
  for (const [sessionId, state] of sessionCreationStates) {
    settleWaiters(
      sessionId,
      state,
      new SessionCreationWaitError(sessionId, 'Session creation lifecycle reset')
    )
  }
  sessionCreationStates.clear()
}
