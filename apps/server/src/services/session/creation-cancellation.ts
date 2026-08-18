const PENDING_CANCELLATION_TTL_MS = 5 * 60 * 1000

interface ActiveSessionCreationCancellation {
  controller: AbortController
  registrations: number
}

const activeCreationControllers = new Map<string, ActiveSessionCreationCancellation>()
const pendingCreationCancellations = new Map<string, number>()

export class SessionCreationCancelledError extends Error {
  code = 'session_creation_cancelled'
  sessionId: string

  constructor(sessionId: string) {
    super('Session creation cancelled')
    this.name = 'SessionCreationCancelledError'
    this.sessionId = sessionId
  }
}

const prunePendingCancellations = () => {
  const expiresBefore = Date.now() - PENDING_CANCELLATION_TTL_MS
  for (const [sessionId, createdAt] of pendingCreationCancellations) {
    if (createdAt < expiresBefore) {
      pendingCreationCancellations.delete(sessionId)
    }
  }
}

export const registerSessionCreationCancellation = (sessionId: string) => {
  prunePendingCancellations()

  let state = activeCreationControllers.get(sessionId)
  if (state == null) {
    state = {
      controller: new AbortController(),
      registrations: 0
    }
    activeCreationControllers.set(sessionId, state)
    if (pendingCreationCancellations.delete(sessionId)) {
      state.controller.abort(new SessionCreationCancelledError(sessionId))
    }
  }
  state.registrations += 1
  let unregistered = false

  return {
    signal: state.controller.signal,
    unregister: () => {
      if (unregistered) return
      unregistered = true
      state.registrations = Math.max(0, state.registrations - 1)
      if (state.registrations === 0 && activeCreationControllers.get(sessionId) === state) {
        activeCreationControllers.delete(sessionId)
      }
    }
  }
}

export const cancelSessionCreation = (
  sessionId: string,
  options: {
    recordPending?: boolean
  } = {}
) => {
  prunePendingCancellations()

  const state = activeCreationControllers.get(sessionId)
  if (state != null) {
    if (!state.controller.signal.aborted) {
      state.controller.abort(new SessionCreationCancelledError(sessionId))
    }
    return 'active' as const
  }

  if (options.recordPending === false) {
    return 'none' as const
  }

  pendingCreationCancellations.set(sessionId, Date.now())
  return 'pending' as const
}

export const throwIfSessionCreationCancelled = (sessionId: string, signal: AbortSignal) => {
  if (!signal.aborted) {
    return
  }

  const reason = signal.reason
  if (reason instanceof Error) {
    throw reason
  }
  throw new SessionCreationCancelledError(sessionId)
}

export const isSessionCreationCancelledError = (error: unknown): error is SessionCreationCancelledError => {
  if (error instanceof SessionCreationCancelledError) {
    return true
  }
  if (!(error instanceof Error) || !('code' in error)) {
    return false
  }

  return (error as Error & { code?: unknown }).code === 'session_creation_cancelled'
}

export const resetSessionCreationCancellationState = () => {
  activeCreationControllers.clear()
  pendingCreationCancellations.clear()
}
