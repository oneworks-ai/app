import type { Session, SessionStatus, WSEvent } from '@oneworks/core'

import type { SqliteDb } from '#~/db/index.js'

import type { RuntimeEvent, RuntimeSessionMetadata } from './types.js'

export const runtimeStatusToSessionStatus = (status: string | undefined): SessionStatus | undefined => {
  switch (status) {
    case 'starting':
    case 'running':
      return 'running'
    case 'waiting_input':
      return 'waiting_input'
    case 'completed':
      return 'completed'
    case 'failed':
    case 'crashed':
      return 'failed'
    case 'stopping':
    case 'stopped':
    case 'cancelled':
    case 'killed':
      return 'terminated'
    default:
      return undefined
  }
}

export const isTerminalSessionStatus = (status: SessionStatus | undefined) => (
  status === 'completed' || status === 'failed' || status === 'terminated'
)

const runtimeEventTypeToSessionStatus = (type: RuntimeEvent['type']): SessionStatus | undefined => {
  switch (type) {
    case 'session_started':
    case 'session_resumed':
      return 'running'
    case 'session_completed':
      return 'completed'
    case 'session_failed':
      return 'failed'
    case 'session_stopped':
      return 'terminated'
    default:
      return undefined
  }
}

const runtimeEventStatusAffectsSession = (type: RuntimeEvent['type']) => {
  switch (type) {
    case 'operation_started':
    case 'operation_completed':
    case 'operation_failed':
      return false
    default:
      return true
  }
}

export const getRuntimeEventSessionStatus = (event: RuntimeEvent) =>
  (runtimeEventStatusAffectsSession(event.type) ? runtimeStatusToSessionStatus(event.status) : undefined) ??
    runtimeEventTypeToSessionStatus(event.type)

export const getEventTime = (event: RuntimeEvent) => event.ts ?? Date.now()

export const getSessionTitle = (event: RuntimeEvent, metadata?: RuntimeSessionMetadata) =>
  event.title ??
    event.runTitle ??
    metadata?.title ??
    metadata?.runTitle ??
    event.sessionId

const hasUnresolvedInteractionRequest = (db: SqliteDb, sessionId: string) => {
  const messages = db.getMessages(sessionId) as WSEvent[]
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const event = messages[index]
    if (event == null) continue
    if (event.type === 'interaction_response') {
      return false
    }
    if (event.type === 'interaction_request') {
      return true
    }
  }

  return false
}

export const shouldPreserveWaitingInteraction = (
  db: SqliteDb,
  sessionId: string,
  status: SessionStatus | undefined
) => (
  (status === 'running' || status === 'completed') &&
  db.getSession(sessionId)?.status === 'waiting_input' &&
  hasUnresolvedInteractionRequest(db, sessionId)
)

export const shouldPreserveTerminalSessionStatus = (
  db: SqliteDb,
  sessionId: string,
  status: SessionStatus | undefined,
  eventType: RuntimeEvent['type']
) => (
  status === 'running' &&
  eventType === 'session_started' &&
  isTerminalSessionStatus(db.getSession(sessionId)?.status)
)

export const ensureRuntimeSession = (db: SqliteDb, event: RuntimeEvent, metadata?: RuntimeSessionMetadata) => {
  const status = event.type === 'session_started'
    ? getRuntimeEventSessionStatus(event) ?? 'running'
    : getRuntimeEventSessionStatus(event)
  const existing = db.getSession(event.sessionId)
  if (existing == null) {
    db.createSession(
      getSessionTitle(event, metadata),
      event.sessionId,
      status,
      event.parentSessionId ?? metadata?.parentSessionId,
      { runtimeKind: 'external' }
    )
  } else {
    db.updateSessionRuntimeState(event.sessionId, { runtimeKind: 'external' })
  }

  const adapter = event.adapter ?? metadata?.adapter
  const effort = metadata?.effort
  const fastMode = metadata?.fastMode
  const model = event.model ?? metadata?.model
  const metadataPermissionMode = metadata?.permissionMode
  const permissionMode = existing?.permissionMode == null ? metadataPermissionMode : undefined
  const resolvedStatus = status != null &&
      !shouldPreserveWaitingInteraction(db, event.sessionId, status) &&
      !shouldPreserveTerminalSessionStatus(db, event.sessionId, status, event.type)
    ? status
    : undefined
  const updates: Partial<Omit<Session, 'id' | 'createdAt' | 'messageCount'>> = {
    ...(resolvedStatus != null ? { status: resolvedStatus } : {}),
    ...(adapter != null ? { adapter } : {}),
    ...(effort != null ? { effort } : {}),
    ...(fastMode != null ? { fastMode } : {}),
    ...(model != null ? { model } : {}),
    ...(permissionMode != null ? { permissionMode } : {})
  }
  const title = getSessionTitle(event, metadata)
  if (title !== event.sessionId && (existing?.title == null || event.type === 'session_started')) {
    updates.title = title
  }
  if (Object.keys(updates).length > 0) {
    db.updateSession(event.sessionId, updates)
  }
}
