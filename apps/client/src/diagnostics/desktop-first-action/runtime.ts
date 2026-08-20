import type { ChatMessage, SessionStatus } from '@oneworks/core'

import { createDesktopFirstActionId, createDesktopFirstActionReporter } from './index'

const reporter = createDesktopFirstActionReporter(
  milestone => window.oneworksDesktop?.markDesktopFirstActionMilestone?.({ milestone })
)

export const markDesktopFirstActionAccepted = reporter.accepted
export const markDesktopFirstActionFailed = reporter.failed
export const markDesktopFirstActionSubmitted = reporter.submitted
export const markDesktopFirstActionTerminated = reporter.terminated
export const markDesktopFirstActionUncertain = reporter.uncertain
export const beginDesktopFirstAction = (sessionId: string) => {
  if (window.oneworksDesktop?.markDesktopFirstActionMilestone == null) return undefined
  const actionId = createDesktopFirstActionId()
  return reporter.submitted(sessionId, actionId) ? actionId : undefined
}
export const markDesktopFirstActionClientEventMessageObserved = (
  sessionId: string,
  message: ChatMessage | null | undefined
) => reporter.messageObserved(sessionId, message, 'client-events')
export const markDesktopFirstActionClientEventSourceReset = () => reporter.resetSource('client-events')
export const markDesktopFirstActionClientEventStatusObserved = (sessionId: string, status: SessionStatus) =>
  reporter.statusObserved(sessionId, status, 'client-events')
export const markDesktopFirstActionSessionMessageObserved = (
  sessionId: string,
  message: ChatMessage | null | undefined
) => reporter.messageObserved(sessionId, message, 'session-live')
export const markDesktopFirstActionSessionSourceReset = (sessionId: string) => (
  reporter.resetSource('session-live', sessionId)
)
export const markDesktopFirstActionSessionStatusObserved = (sessionId: string, status: SessionStatus) =>
  reporter.statusObserved(sessionId, status, 'session-live')
export const restoreDesktopFirstActionFromSessionHistory = (
  sessionId: string,
  messages: ChatMessage[],
  status: SessionStatus | undefined
) => reporter.restore(sessionId, messages, status)
