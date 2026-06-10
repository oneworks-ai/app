import type { AskUserQuestionParams, ChatMessage, Session, SessionStatus, WSEvent } from '@oneworks/core'

import type { SqliteDb } from '#~/db/index.js'
import { setSessionInteraction } from '#~/services/session/interaction.js'
import { broadcastSessionEvent, notifySessionUpdated } from '#~/services/session/runtime.js'

import { extractTextFromContent, normalizeMessageContent } from './content.js'
import { projectFailureToSession } from './session-failure-projection.js'
import {
  getEventTime,
  getRuntimeEventSessionStatus,
  isTerminalSessionStatus,
  shouldPreserveTerminalSessionStatus,
  shouldPreserveWaitingInteraction
} from './session-projection.js'
import type { RuntimeEvent, RuntimeSessionMetadata } from './types.js'

export interface ProjectedSessionEvent {
  sessionId: string
  event: WSEvent
}

const notifySessionIfNeeded = (
  sessionId: string,
  session: Session | undefined,
  broadcast: boolean
) => {
  if (broadcast && session != null) {
    notifySessionUpdated(sessionId, session)
  }
}

const persistSessionEvent = (
  db: SqliteDb,
  sessionId: string,
  wsEvent: WSEvent,
  options: {
    broadcast: boolean
    lastMessage?: string
    lastUserMessage?: string
    status?: SessionStatus
  }
) => {
  const didSave = db.saveMessage(sessionId, wsEvent)
  if (didSave === false) {
    return false
  }
  const updates: Partial<Omit<Session, 'id' | 'createdAt' | 'messageCount'>> = {
    ...(options.lastMessage != null ? { lastMessage: options.lastMessage } : {}),
    ...(options.lastUserMessage != null ? { lastUserMessage: options.lastUserMessage } : {}),
    ...(options.status != null ? { status: options.status } : {})
  }
  if (Object.keys(updates).length > 0) {
    db.updateSession(sessionId, updates)
  }

  if (options.broadcast) {
    broadcastSessionEvent(sessionId, wsEvent)
    notifySessionIfNeeded(sessionId, db.getSession(sessionId), true)
  }

  return true
}

const getNonEmptyString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const getAgentRoomMessageSource = (event: RuntimeEvent) => {
  const explicitSource = getNonEmptyString(event.source)
  if (explicitSource != null) {
    return explicitSource === 'ui' ? 'user' : explicitSource
  }

  return getNonEmptyString(event.commandId) != null || getNonEmptyString(event.causedByCommandId) != null
    ? 'leader'
    : 'user'
}

const projectMessageToSession = (
  db: SqliteDb,
  event: RuntimeEvent,
  broadcast: boolean,
  metadata?: RuntimeSessionMetadata
): ProjectedSessionEvent[] => {
  const content = event.content ?? event.summary ?? event.publicSummary ?? ''
  const role = event.role ?? 'assistant'
  const roomId = getNonEmptyString(event.roomId ?? metadata?.roomId)
  const hostSessionId = getNonEmptyString(event.hostSessionId ?? metadata?.hostSessionId)
  const memberKey = getNonEmptyString(event.memberKey ?? metadata?.memberKey)
  const runKey = getNonEmptyString(event.runId ?? metadata?.runId)
  const commandId = getNonEmptyString(event.commandId)
  const causedByCommandId = getNonEmptyString(event.causedByCommandId)
  const source = getAgentRoomMessageSource(event)
  const sourceLabel = getNonEmptyString(event.sourceLabel)
  const agentRoom = role === 'user' &&
      (roomId != null || hostSessionId != null || memberKey != null || runKey != null ||
        commandId != null || causedByCommandId != null || sourceLabel != null)
    ? {
      source,
      ...(sourceLabel != null ? { sourceLabel } : {}),
      ...(roomId != null ? { roomId } : {}),
      ...(hostSessionId != null ? { hostSessionId } : {}),
      ...(memberKey != null ? { memberKey } : {}),
      ...(runKey != null ? { runKey } : {}),
      ...(commandId != null ? { commandId } : {}),
      ...(causedByCommandId != null ? { causedByCommandId } : {})
    }
    : undefined
  const message: ChatMessage = {
    id: event.id,
    role,
    content: normalizeMessageContent(content),
    ...(agentRoom != null ? { agentRoom } : {}),
    ...(typeof event.model === 'string' ? { model: event.model } : {}),
    createdAt: getEventTime(event)
  }
  const text = extractTextFromContent(event.content) ?? event.summary ?? event.publicSummary
  const shouldMarkRunning = !isTerminalSessionStatus(db.getSession(event.sessionId)?.status) &&
    !shouldPreserveWaitingInteraction(db, event.sessionId, 'running')

  const wsEvent: WSEvent = { type: 'message', message }
  const didPersist = persistSessionEvent(db, event.sessionId, wsEvent, {
    broadcast,
    ...(text != null && text !== '' ? { lastMessage: text } : {}),
    ...(role === 'user' && text != null && text !== '' ? { lastUserMessage: text } : {}),
    ...(shouldMarkRunning ? { status: 'running' as const } : {})
  })
  return didPersist ? [{ sessionId: event.sessionId, event: wsEvent }] : []
}

const projectApprovalToSession = (db: SqliteDb, event: RuntimeEvent, broadcast: boolean): ProjectedSessionEvent[] => {
  const interactionId = event.requestId ?? event.id
  const payload: AskUserQuestionParams = {
    sessionId: event.sessionId,
    question: event.question ?? event.publicSummary ?? event.summary ?? 'Input required',
    ...(event.options != null ? { options: event.options } : {}),
    ...(event.multiselect != null ? { multiselect: event.multiselect } : {}),
    kind: event.kind === 'permission' ? 'permission' : 'question',
    ...(event.kind === 'permission' && event.permissionContext != null
      ? { permissionContext: event.permissionContext }
      : {})
  }
  const wsEvent: WSEvent = {
    type: 'interaction_request',
    id: interactionId,
    payload
  }
  const didPersist = persistSessionEvent(db, event.sessionId, wsEvent, {
    broadcast,
    lastMessage: payload.question,
    status: 'waiting_input'
  })
  if (didPersist) {
    setSessionInteraction(event.sessionId, { id: interactionId, payload })
    return [{ sessionId: event.sessionId, event: wsEvent }]
  }
  return []
}

const projectAuditToSession = (db: SqliteDb, event: RuntimeEvent, broadcast: boolean) => {
  persistSessionEvent(db, event.sessionId, { type: 'adapter_event', data: { runtimeEvent: event } }, { broadcast })
}
export function projectRuntimeSessionEvent(
  db: SqliteDb,
  event: RuntimeEvent,
  broadcast: boolean,
  metadata?: RuntimeSessionMetadata
): ProjectedSessionEvent[] {
  if (event.type === 'message') {
    return projectMessageToSession(db, event, broadcast, metadata)
  } else if (event.type === 'approval_requested' || event.type === 'input_requested') {
    return projectApprovalToSession(db, event, broadcast)
  } else if (event.type === 'command_ack' || event.type === 'command_failed' || event.type === 'command_cancelled') {
    projectAuditToSession(db, event, broadcast)
  } else if (
    event.type === 'status_changed' ||
    event.type === 'session_started' ||
    event.type === 'session_resumed' ||
    event.type === 'session_completed' ||
    event.type === 'session_failed' ||
    event.type === 'session_stopped'
  ) {
    const status = event.type === 'session_started'
      ? getRuntimeEventSessionStatus(event) ?? 'running'
      : getRuntimeEventSessionStatus(event)
    if (status === 'failed') {
      return projectFailureToSession(db, event, status, broadcast)
    }
    if (
      status != null &&
      !shouldPreserveWaitingInteraction(db, event.sessionId, status) &&
      !shouldPreserveTerminalSessionStatus(db, event.sessionId, status, event.type)
    ) {
      db.updateSession(event.sessionId, { status })
      notifySessionIfNeeded(event.sessionId, db.getSession(event.sessionId), broadcast)
    }
  }
  return []
}
