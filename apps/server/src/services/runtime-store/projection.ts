import type { SqliteDb } from '#~/db/index.js'
import { isPreservedSessionTerminalStatus } from '#~/services/session/terminal-status.js'

import { projectRuntimeRoomEvent } from './room-projection.js'
import type { RuntimeRoomHostRequestDelivery } from './room-projection.js'
import { projectRuntimeSessionEvent } from './session-event-projection.js'
import type { ProjectedSessionEvent } from './session-event-projection.js'
import { ensureRuntimeSession } from './session-projection.js'
import type { RuntimeEvent, RuntimeSessionMetadata } from './types.js'

export interface RuntimeProjectionOptions {
  db: SqliteDb
  broadcast?: boolean
  metadata?: RuntimeSessionMetadata
  agentRoomProjectionEnabled?: boolean
  hostRequestDelivery?: RuntimeRoomHostRequestDelivery
}

export interface RuntimeProjectionResult {
  sessionEvents: ProjectedSessionEvent[]
}

const ROOM_TERMINAL_EVENT_TYPES = new Set<RuntimeEvent['type']>([
  'command_failed',
  'operation_completed',
  'operation_failed',
  'session_completed',
  'session_failed',
  'session_stopped',
  'status_changed'
])

const ROOM_REOPENING_EVENT_TYPES = new Set<RuntimeEvent['type']>([
  'approval_requested',
  'input_requested',
  'operation_started',
  'session_resumed',
  'session_started'
])

const resolveRuntimeRoomTerminalStatus = (event: RuntimeEvent) => {
  if (event.type === 'command_failed' || event.type === 'operation_failed' || event.type === 'session_failed') {
    return 'failed'
  }
  if (event.type === 'operation_completed' || event.type === 'session_completed') {
    return 'completed'
  }
  if (event.type === 'session_stopped') {
    return 'stopped'
  }
  if (event.status === 'failed' || event.status === 'crashed') return 'failed'
  if (event.status === 'stopped' || event.status === 'cancelled' || event.status === 'killed') return 'stopped'
  return event.status === 'completed' ? 'completed' : undefined
}

const resolveRuntimeRoomEvent = (db: SqliteDb, event: RuntimeEvent): RuntimeEvent | undefined => {
  const isTerminalEvent = ROOM_TERMINAL_EVENT_TYPES.has(event.type)
  if (!isTerminalEvent && !ROOM_REOPENING_EVENT_TYPES.has(event.type) && event.status == null) {
    return event
  }
  const status = db.getSessionStatus(event.sessionId)
  if (!isPreservedSessionTerminalStatus(status)) {
    return event
  }

  if (!isTerminalEvent) {
    return undefined
  }

  const terminalStatus = status === 'terminated' ? 'stopped' : 'failed'
  if (resolveRuntimeRoomTerminalStatus(event) === terminalStatus) {
    return event
  }
  const terminalSummary = terminalStatus === 'stopped' ? 'Run stopped' : 'Run failed'

  return {
    ...event,
    content: undefined,
    error: undefined,
    message: undefined,
    publicSummary: terminalSummary,
    question: undefined,
    summary: terminalSummary,
    type: 'status_changed',
    status: terminalStatus
  }
}

export function projectRuntimeEvent(event: RuntimeEvent, options: RuntimeProjectionOptions) {
  const broadcast = options.broadcast === true
  ensureRuntimeSession(options.db, event, options.metadata)
  const sessionEvents = projectRuntimeSessionEvent(options.db, event, broadcast, options.metadata)
  // Explicit room metadata is an opt-in contract. The experiment only controls
  // implicit projection from ordinary host/child sessions.
  if (options.agentRoomProjectionEnabled === true || options.metadata?.roomId != null) {
    const roomEvent = resolveRuntimeRoomEvent(options.db, event)
    if (roomEvent != null) {
      projectRuntimeRoomEvent(options.db, roomEvent, options.metadata, {
        ...(options.hostRequestDelivery != null ? { hostRequestDelivery: options.hostRequestDelivery } : {})
      })
    }
  }
  return { sessionEvents } satisfies RuntimeProjectionResult
}
