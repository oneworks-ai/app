import { ApiError } from '#~/api/base'

import {
  beginDesktopFirstAction,
  markDesktopFirstActionAccepted,
  markDesktopFirstActionFailed,
  markDesktopFirstActionSubmitted,
  markDesktopFirstActionTerminated,
  markDesktopFirstActionUncertain
} from './runtime'

interface DesktopFirstActionSubmitLifecycle {
  accepted: (sessionId: string, actionId: string) => void
  begin: (sessionId: string) => string | undefined
  failed: (sessionId: string, actionId: string) => void
  submitted: (sessionId: string, actionId: string) => boolean
  terminated: (sessionId: string, actionId: string) => void
  uncertain: (sessionId: string, actionId: string) => void
}

export type DesktopFirstActionTransportSettlement = 'failed' | 'terminated' | 'uncertain'

export const classifyDesktopFirstActionTransportError = (
  error: unknown
): DesktopFirstActionTransportSettlement => {
  if (!(error instanceof ApiError)) return 'uncertain'
  if (error.code === 'session_creation_cancelled') return 'terminated'
  if (error.code === 'request_timeout' || error.status === 408 || error.status >= 500) return 'uncertain'
  return error.status >= 400 && error.status < 500 ? 'failed' : 'uncertain'
}

const settleDesktopFirstActionTransportError = (
  lifecycle: Pick<DesktopFirstActionSubmitLifecycle, 'failed' | 'terminated' | 'uncertain'>,
  sessionId: string,
  actionId: string,
  error: unknown
) => {
  const settlement = classifyDesktopFirstActionTransportError(error)
  lifecycle[settlement](sessionId, actionId)
}

export const createDesktopFirstActionSubmitCoordinator = (
  lifecycle: DesktopFirstActionSubmitLifecycle
) => ({
  submit: async <T>(
    sessionId: string,
    transport: (clientActionId?: string) => Promise<T>,
    existingActionId?: string
  ): Promise<T> => {
    const clientActionId = existingActionId ?? lifecycle.begin(sessionId)
    if (existingActionId != null) {
      lifecycle.submitted(sessionId, existingActionId)
    }
    try {
      const result = await transport(clientActionId)
      if (clientActionId != null) {
        lifecycle.accepted(sessionId, clientActionId)
      }
      return result
    } catch (error) {
      if (clientActionId != null) {
        settleDesktopFirstActionTransportError(lifecycle, sessionId, clientActionId, error)
      }
      throw error
    }
  }
})

const desktopFirstActionSubmitLifecycle = {
  accepted: markDesktopFirstActionAccepted,
  begin: beginDesktopFirstAction,
  failed: markDesktopFirstActionFailed,
  submitted: markDesktopFirstActionSubmitted,
  terminated: markDesktopFirstActionTerminated,
  uncertain: markDesktopFirstActionUncertain
}
const desktopFirstActionSubmitCoordinator = createDesktopFirstActionSubmitCoordinator(
  desktopFirstActionSubmitLifecycle
)

export const submitWithDesktopFirstAction = desktopFirstActionSubmitCoordinator.submit
export const markDesktopFirstActionTransportError = (
  sessionId: string,
  actionId: string,
  error: unknown
) =>
  settleDesktopFirstActionTransportError(
    desktopFirstActionSubmitLifecycle,
    sessionId,
    actionId,
    error
  )
