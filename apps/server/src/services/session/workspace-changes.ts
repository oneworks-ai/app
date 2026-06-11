import { randomUUID } from 'node:crypto'

import type { WSEvent } from '@oneworks/core'
import type { SessionWorkspaceChangeOutcome } from '@oneworks/types'

import { getDb } from '#~/db/index.js'
import { broadcastSessionEvent } from '#~/services/session/runtime.js'
import { getSessionLogger } from '#~/utils/logger.js'

import { buildWorkspaceChanges, getCurrentWorkspaceChangeSnapshot } from './workspace-change-snapshot'
import type { TrackedWorkspaceChange } from './workspace-change-snapshot'

const workspaceChangeTrackingStore = new Map<string, TrackedWorkspaceChange>()

export const clearSessionWorkspaceChangeTracking = () => {
  workspaceChangeTrackingStore.clear()
}

export const beginSessionWorkspaceChangeTracking = async (sessionId: string) => {
  try {
    const snapshot = await getCurrentWorkspaceChangeSnapshot(sessionId)
    if (snapshot == null) {
      workspaceChangeTrackingStore.delete(sessionId)
      return
    }

    workspaceChangeTrackingStore.set(sessionId, {
      ...snapshot,
      id: randomUUID(),
      startedAt: Date.now()
    })
  } catch (error) {
    workspaceChangeTrackingStore.delete(sessionId)
    getSessionLogger(sessionId, 'server').warn({
      sessionId,
      error: error instanceof Error ? error.message : String(error)
    }, '[workspace-changes] Failed to start workspace change tracking')
  }
}

export const finalizeSessionWorkspaceChangeTracking = async (
  sessionId: string,
  outcome: SessionWorkspaceChangeOutcome
) => {
  const baseline = workspaceChangeTrackingStore.get(sessionId)
  if (baseline == null) {
    return
  }
  workspaceChangeTrackingStore.delete(sessionId)

  try {
    const changes = await buildWorkspaceChanges(sessionId, baseline, outcome)
    if (changes == null) {
      return
    }

    const event: WSEvent = {
      type: 'workspace_changes',
      changes
    }
    const didSave = getDb().saveMessage(sessionId, event)
    if (didSave === false) {
      return
    }
    broadcastSessionEvent(sessionId, event)
  } catch (error) {
    getSessionLogger(sessionId, 'server').warn({
      sessionId,
      error: error instanceof Error ? error.message : String(error)
    }, '[workspace-changes] Failed to finalize workspace change tracking')
  }
}
