import type { SqliteDb } from '#~/db/index.js'

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

export function projectRuntimeEvent(event: RuntimeEvent, options: RuntimeProjectionOptions) {
  const broadcast = options.broadcast === true
  ensureRuntimeSession(options.db, event, options.metadata)
  const sessionEvents = projectRuntimeSessionEvent(options.db, event, broadcast, options.metadata)
  if (options.agentRoomProjectionEnabled === true) {
    projectRuntimeRoomEvent(options.db, event, options.metadata, {
      ...(options.hostRequestDelivery != null ? { hostRequestDelivery: options.hostRequestDelivery } : {})
    })
  }
  return { sessionEvents } satisfies RuntimeProjectionResult
}
