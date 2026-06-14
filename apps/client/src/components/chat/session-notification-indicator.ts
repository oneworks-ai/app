import type { Session, SessionStatus } from '@oneworks/core'

export type SessionNotificationIndicatorTone = 'error' | 'primary' | 'warning'

export interface SessionNotificationIndicator {
  animated?: boolean
  status: SessionStatus
  tone: SessionNotificationIndicatorTone
}

export interface SessionNotificationReadMarker {
  fingerprint: string
  sessionId: string
}

const SESSION_NOTIFICATION_READ_STORAGE_PREFIX = 'chat-session-notification-read:'

export const getSessionNotificationFingerprint = (session: Session) =>
  [
    session.status ?? '',
    session.messageCount ?? '',
    session.lastMessage ?? '',
    session.lastUserMessage ?? '',
    session.createdAt
  ].join('\u001F')

const getSessionNotificationReadStorageKey = (sessionId: string) =>
  `${SESSION_NOTIFICATION_READ_STORAGE_PREFIX}${sessionId}`

export const readSessionNotificationReadMarker = (
  sessionId: string | null | undefined
): SessionNotificationReadMarker | null => {
  if (sessionId == null || sessionId === '' || typeof localStorage === 'undefined') return null

  try {
    const value = JSON.parse(localStorage.getItem(getSessionNotificationReadStorageKey(sessionId)) ?? 'null')
    if (
      value == null ||
      typeof value !== 'object' ||
      value.sessionId !== sessionId ||
      typeof value.fingerprint !== 'string'
    ) {
      return null
    }

    return value as SessionNotificationReadMarker
  } catch {
    return null
  }
}

export const writeSessionNotificationReadMarker = (session: Session): SessionNotificationReadMarker | null => {
  if (typeof localStorage === 'undefined') return null

  const marker: SessionNotificationReadMarker = {
    fingerprint: getSessionNotificationFingerprint(session),
    sessionId: session.id
  }

  try {
    localStorage.setItem(getSessionNotificationReadStorageKey(session.id), JSON.stringify(marker))
    return marker
  } catch {
    return null
  }
}

export const isSessionNotificationMarkedRead = (
  session: Session | null | undefined,
  marker: SessionNotificationReadMarker | null
) =>
  session != null &&
  marker != null &&
  marker.sessionId === session.id &&
  marker.fingerprint === getSessionNotificationFingerprint(session)

export const resolveSessionNotificationIndicator = (
  session: Session | null | undefined,
  options: {
    completedRead?: boolean
  } = {}
): SessionNotificationIndicator | null => {
  if (session?.status === 'failed') {
    return { status: 'failed', tone: 'error' }
  }

  if (session?.status === 'waiting_input') {
    return { status: 'waiting_input', tone: 'warning' }
  }

  if (session?.status === 'running') {
    return { animated: true, status: 'running', tone: 'primary' }
  }

  if (session?.status === 'completed' && options.completedRead !== true) {
    return { status: 'completed', tone: 'primary' }
  }

  return null
}
