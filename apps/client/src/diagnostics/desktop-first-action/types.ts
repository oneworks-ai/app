import type { ChatMessage, SessionStatus } from '@oneworks/core'

export type DesktopFirstActionObservationSource = 'client-events' | 'session-live'

export interface DesktopFirstActionReporter {
  accepted: (sessionId: string, actionId: string) => void
  failed: (sessionId: string, actionId: string) => void
  messageObserved: (
    sessionId: string,
    message: ChatMessage | null | undefined,
    source?: DesktopFirstActionObservationSource
  ) => void
  restore: (
    sessionId: string,
    messages: ChatMessage[],
    status: SessionStatus | undefined
  ) => void
  resetSource: (source: DesktopFirstActionObservationSource, sessionId?: string) => void
  statusObserved: (
    sessionId: string,
    status: SessionStatus,
    source?: DesktopFirstActionObservationSource
  ) => void
  submitted: (sessionId: string, actionId: string) => boolean
  succeeded: (sessionId: string, source?: DesktopFirstActionObservationSource) => void
  terminated: (sessionId: string, actionId: string) => void
  uncertain: (sessionId: string, actionId: string) => void
}
