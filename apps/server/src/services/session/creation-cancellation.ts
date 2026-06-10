const PENDING_CANCELLATION_TTL_MS = 5 * 60 * 1000

const activeCreationControllers = new Map<string, AbortController>()
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

  const controller = new AbortController()
  activeCreationControllers.set(sessionId, controller)
  if (pendingCreationCancellations.delete(sessionId)) {
    controller.abort(new SessionCreationCancelledError(sessionId))
  }

  return {
    signal: controller.signal,
    unregister: () => {
      if (activeCreationControllers.get(sessionId) === controller) {
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

  const controller = activeCreationControllers.get(sessionId)
  if (controller != null) {
    if (!controller.signal.aborted) {
      controller.abort(new SessionCreationCancelledError(sessionId))
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
