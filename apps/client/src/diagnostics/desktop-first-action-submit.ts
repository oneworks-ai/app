import {
  beginDesktopFirstAction,
  markDesktopFirstActionAccepted,
  markDesktopFirstActionSubmitted
} from './desktop-first-action-runtime'

interface DesktopFirstActionSubmitLifecycle {
  accepted: (sessionId: string, actionId: string) => void
  begin: (sessionId: string) => string | undefined
  submitted: (sessionId: string, actionId: string) => boolean
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
    const result = await transport(clientActionId)
    if (clientActionId != null) {
      lifecycle.accepted(sessionId, clientActionId)
    }
    return result
  }
})

const desktopFirstActionSubmitCoordinator = createDesktopFirstActionSubmitCoordinator({
  accepted: markDesktopFirstActionAccepted,
  begin: beginDesktopFirstAction,
  submitted: markDesktopFirstActionSubmitted
})

export const submitWithDesktopFirstAction = desktopFirstActionSubmitCoordinator.submit
