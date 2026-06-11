import type { SessionStatus, WSEvent } from '@oneworks/core'

import type { SqliteDb } from '#~/db/index.js'
import { broadcastSessionEvent, notifySessionUpdated } from '#~/services/session/runtime.js'

import { buildRuntimeFailureErrorEvent } from './session-failure-event.js'
import { shouldPreserveTerminalSessionStatus, shouldPreserveWaitingInteraction } from './session-projection.js'
import type { RuntimeEvent } from './types.js'

const notifySessionIfNeeded = (
  sessionId: string,
  session: ReturnType<SqliteDb['getSession']>,
  broadcast: boolean
) => {
  if (broadcast && session != null) {
    notifySessionUpdated(sessionId, session)
  }
}

const saveRuntimeFailureEvent = (
  db: SqliteDb,
  sessionId: string,
  event: Extract<WSEvent, { type: 'error' }>,
  broadcast: boolean
) => {
  const didSave = db.saveMessage(sessionId, event)
  if (didSave === false) return false

  if (broadcast) {
    broadcastSessionEvent(sessionId, event)
  }

  return true
}

export const projectFailureToSession = (
  db: SqliteDb,
  event: RuntimeEvent,
  status: SessionStatus,
  broadcast: boolean
) => {
  const wsEvent = buildRuntimeFailureErrorEvent(event)
  const shouldUpdateStatus = !shouldPreserveWaitingInteraction(db, event.sessionId, status) &&
    !shouldPreserveTerminalSessionStatus(db, event.sessionId, status, event.type)
  const didPersist = saveRuntimeFailureEvent(db, event.sessionId, wsEvent, broadcast)

  if (shouldUpdateStatus) {
    db.updateSession(event.sessionId, { status })
    notifySessionIfNeeded(event.sessionId, db.getSession(event.sessionId), broadcast)
  }

  return didPersist ? [{ sessionId: event.sessionId, event: wsEvent }] : []
}
