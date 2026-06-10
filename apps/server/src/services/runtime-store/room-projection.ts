/* eslint-disable max-lines -- room projection keeps runtime-to-room mapping decisions colocated */
import { createRequire } from 'node:module'

import type {
  AgentRoom,
  AgentRoomEvent,
  AgentRoomEventMember,
  AgentRoomEventRequestKind,
  AgentRoomEventRun,
  AgentRoomRunStatus,
  WSEvent
} from '@oneworks/core'

import type { SqliteDb } from '#~/db/index.js'
import { createAgentRoomService } from '#~/services/agent-room/index.js'
import { resolveRuntimeProtocolCliCommand } from '#~/services/runtime-cli-command.js'
import { logger } from '#~/utils/logger.js'

import { extractTextFromContent } from './content.js'
import { getEventTime, getRuntimeEventSessionStatus, getSessionTitle } from './session-projection.js'
import type { RuntimeEvent, RuntimeSessionMetadata } from './types.js'

export interface RuntimeRoomHostRequestDelivery {
  processUserMessage: (sessionId: string, content: string) => Promise<void> | void
}

export interface RuntimeRoomProjectionOptions {
  hostRequestDelivery?: RuntimeRoomHostRequestDelivery
}

const pendingHostRequestDeliveries = new Set<string>()
const requireRuntimeModule = createRequire(__filename)

type ProcessUserMessage = typeof import('#~/services/session/index.js')['processUserMessage']

const loadProcessUserMessage = () =>
  (
    requireRuntimeModule('#~/services/session/index.js') as { processUserMessage: ProcessUserMessage }
  ).processUserMessage

const defaultHostRequestDelivery: RuntimeRoomHostRequestDelivery = {
  async processUserMessage(sessionId, content) {
    const processUserMessage = loadProcessUserMessage()
    await processUserMessage(sessionId, content)
  }
}

const runtimeStatusToRoomRunStatus = (status: string | undefined): AgentRoomRunStatus | undefined => {
  switch (status) {
    case 'starting':
    case 'running':
      return 'running'
    case 'waiting_input':
      return 'waiting'
    case 'completed':
      return 'completed'
    case 'failed':
    case 'crashed':
      return 'failed'
    case 'stopping':
    case 'stopped':
    case 'cancelled':
    case 'killed':
      return 'stopped'
    default:
      return undefined
  }
}

const runtimeSessionStatusToRoomRunStatus = (status: ReturnType<typeof getRuntimeEventSessionStatus>) => {
  switch (status) {
    case 'running':
      return 'running'
    case 'waiting_input':
      return 'waiting'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'terminated':
      return 'stopped'
    default:
      return undefined
  }
}

const getRoomRunStatus = (event: RuntimeEvent) =>
  runtimeStatusToRoomRunStatus(event.status) ?? runtimeSessionStatusToRoomRunStatus(getRuntimeEventSessionStatus(event))

const getRoomId = (event: RuntimeEvent, metadata?: RuntimeSessionMetadata) => event.roomId ?? metadata?.roomId

const getHostSessionId = (event: RuntimeEvent, metadata?: RuntimeSessionMetadata) =>
  event.hostSessionId ?? metadata?.hostSessionId

const firstNonEmptyString = (values: Array<string | undefined>) => {
  for (const value of values) {
    if (value != null && value.trim() !== '') {
      return value
    }
  }
  return undefined
}

const getRoomSummary = (event: RuntimeEvent) => {
  const publicSummary = firstNonEmptyString([event.publicSummary])
  if (publicSummary != null) return publicSummary

  if (event.type === 'approval_requested' || event.type === 'input_requested') {
    return firstNonEmptyString([
      event.question,
      event.summary,
      extractTextFromContent(event.content),
      event.message,
      event.error
    ]) ?? 'Input required'
  }
  if (event.visibility === 'room') {
    return firstNonEmptyString([
      extractTextFromContent(event.content),
      event.summary,
      event.question,
      event.message,
      event.error
    ])
  }
  return undefined
}

const getAttentionRequestKind = (event: RuntimeEvent): AgentRoomEventRequestKind => {
  if (event.requestKind != null) {
    return event.requestKind
  }

  return event.type === 'approval_requested' || event.kind === 'permission'
    ? 'confirmation'
    : 'input'
}

const getMember = (event: RuntimeEvent, metadata?: RuntimeSessionMetadata): AgentRoomEventMember => {
  const memberKey = event.memberKey ?? event.member?.key ?? metadata?.memberKey ?? `session:${event.sessionId}`
  const avatar = event.memberAvatar ?? event.member?.avatar ?? metadata?.memberAvatar
  const subtitle = event.memberSubtitle ?? event.member?.subtitle ?? metadata?.memberSubtitle
  return {
    key: memberKey,
    kind: event.memberKind ?? event.member?.kind ?? metadata?.memberKind ?? 'entity',
    label: event.memberLabel ?? event.member?.label ?? metadata?.memberLabel ?? memberKey,
    ...(avatar != null ? { avatar } : {}),
    ...(subtitle != null ? { subtitle } : {})
  }
}

const getRun = (event: RuntimeEvent, metadata?: RuntimeSessionMetadata): AgentRoomEventRun => ({
  key: event.runId ?? metadata?.runId ?? event.sessionId,
  sessionId: event.sessionId,
  title: event.runTitle ?? metadata?.runTitle ?? getSessionTitle(event, metadata)
})

const getRoomTitle = (db: SqliteDb, event: RuntimeEvent, metadata?: RuntimeSessionMetadata) => {
  const hostSessionId = getHostSessionId(event, metadata)
  const hostSessionTitle = hostSessionId == null ? undefined : db.getSession(hostSessionId)?.title
  return event.roomTitle ??
    metadata?.roomTitle ??
    hostSessionTitle ??
    event.operationId ??
    metadata?.operationId ??
    'Agent room'
}

const ensureRoom = (db: SqliteDb, event: RuntimeEvent, metadata?: RuntimeSessionMetadata) => {
  const roomId = getRoomId(event, metadata)
  const hostSessionId = getHostSessionId(event, metadata)

  if (roomId != null) {
    const existing = db.getAgentRoom(roomId)
    if (existing != null) {
      if (hostSessionId != null && hostSessionId !== '') {
        if (existing.hostSessionId != null && existing.hostSessionId !== hostSessionId) {
          throw new Error(
            `Agent room ${roomId} is already bound to host session ${existing.hostSessionId}.`
          )
        }
        if (existing.hostSessionId == null) {
          return db.updateAgentRoom(roomId, {
            hostSessionId,
            updatedAt: getEventTime(event)
          }) ?? existing
        }
      }
      return existing
    }

    return db.createAgentRoom({
      id: roomId,
      title: getRoomTitle(db, event, metadata),
      ...(hostSessionId != null ? { hostSessionId } : {}),
      createdAt: getEventTime(event)
    })
  }

  if (hostSessionId == null) {
    return undefined
  }

  return db.ensureAgentRoomForHostSession({
    hostSessionId,
    title: getRoomTitle(db, event, metadata)
  })
}

const toRoomMessageEvent = (
  event: RuntimeEvent,
  member: AgentRoomEventMember,
  run: AgentRoomEventRun,
  summary: string
): AgentRoomEvent | undefined => {
  switch (event.type) {
    case 'session_started':
      return { id: event.id, type: 'assignment_sent', member, run, summary }
    case 'approval_requested':
    case 'input_requested':
      return {
        id: event.id,
        type: 'attention_requested',
        member,
        run,
        interactionId: getHostRequestInteractionId(event),
        summary,
        requestKind: getAttentionRequestKind(event),
        ...(event.options != null ? { options: event.options } : {}),
        ...(event.multiselect != null ? { multiselect: event.multiselect } : {})
      }
    case 'message':
      return undefined
    case 'status_changed': {
      const runStatus = getRoomRunStatus(event)
      if (runStatus === 'completed') {
        return { id: event.id, type: 'run_completed', member, run, summary }
      }
      if (runStatus === 'failed') {
        return { id: event.id, type: 'run_failed', member, run, summary }
      }
      if (runStatus === 'stopped') {
        return { id: event.id, type: 'run_stopped', member, run, summary }
      }
      return undefined
    }
    case 'command_failed':
      return { id: event.id, type: 'run_failed', member, run, summary }
    case 'operation_completed':
    case 'session_completed':
      return { id: event.id, type: 'run_completed', member, run, summary }
    case 'operation_failed':
    case 'session_failed':
      return { id: event.id, type: 'run_failed', member, run, summary }
    case 'session_stopped':
      return { id: event.id, type: 'run_stopped', member, run, summary }
    default:
      return undefined
  }
}

const getRoomEventId = (event: RuntimeEvent) =>
  event.id.startsWith('runtime-meta:')
    ? event.id
    : `runtime:${event.sessionId}:${event.id}`

const getMemberJoinedEventId = (roomId: string, memberKey: string) => `runtime-member:${roomId}:${memberKey}`

const hasRoomMessage = (db: SqliteDb, roomId: string, messageId: string) =>
  db.getAgentRoomDetail(roomId)?.messages.some(message => message.id === messageId) === true

const normalizeRoomMessageContent = (content: string) => content.trim().replace(/\s+/g, ' ')

const hasEquivalentCompletedRoomMessage = (
  db: SqliteDb,
  roomId: string,
  roomEvent: Extract<AgentRoomEvent, { type: 'run_completed' }>
) =>
  db.getAgentRoomDetail(roomId)?.messages.some(message =>
    message.eventType === 'run_completed' &&
    message.memberKey === roomEvent.member.key &&
    message.runKey === roomEvent.run.key &&
    normalizeRoomMessageContent(message.content) === normalizeRoomMessageContent(roomEvent.summary ?? 'Run completed')
  ) === true

const getHostRequestInteractionId = (event: RuntimeEvent) => event.requestId ?? event.id

const getHostRequestDeliveryKey = (event: RuntimeEvent) =>
  `runtime-host-request:${event.sessionId}:${getHostRequestInteractionId(event)}:${event.id}`

const getLegacyHostRequestDeliveryKey = (event: RuntimeEvent) =>
  `runtime-host-request:${event.sessionId}:${getHostRequestInteractionId(event)}`

const getDeliveryMarkerCreatedAt = (event: Extract<WSEvent, { type: 'adapter_event' }>) => {
  const createdAt = event.data?.createdAt
  return typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : undefined
}

const hasHostRequestDeliveryMarker = (
  db: SqliteDb,
  sessionId: string,
  deliveryKey: string,
  legacyDeliveryKey: string,
  eventTime: number
) =>
  (db.getMessages(sessionId) as WSEvent[]).some(event => {
    if (event.type !== 'adapter_event' || event.data?.source !== 'runtime_host_request_delivery') {
      return false
    }
    if (event.data?.deliveryKey === deliveryKey) {
      return true
    }
    if (event.data?.deliveryKey !== legacyDeliveryKey) {
      return false
    }

    const markerCreatedAt = getDeliveryMarkerCreatedAt(event)
    return markerCreatedAt == null || markerCreatedAt >= eventTime
  })

const ensureRuntimeMemberJoined = (
  db: SqliteDb,
  service: ReturnType<typeof createAgentRoomService>,
  roomId: string,
  member: AgentRoomEventMember,
  now: number
) => {
  const id = getMemberJoinedEventId(roomId, member.key)
  if (hasRoomMessage(db, roomId, id)) {
    return
  }

  service.applyEvent(roomId, {
    id,
    type: 'member_joined',
    member
  }, { now })
}

const shouldSkipStaleTerminalEvent = (db: SqliteDb, roomId: string, roomEvent: AgentRoomEvent) => {
  if (!('run' in roomEvent)) {
    return false
  }

  const existingRun = db.getAgentRoomRun(roomId, roomEvent.run.key)
  if (existingRun == null) {
    return false
  }

  if (roomEvent.type === 'run_completed') {
    if (
      existingRun.status === 'waiting' &&
      existingRun.latestSummary != null &&
      normalizeRoomMessageContent(existingRun.latestSummary) ===
        normalizeRoomMessageContent(roomEvent.summary ?? 'Run completed')
    ) {
      return true
    }
    return existingRun.status === 'failed' || existingRun.status === 'stopped'
  }
  if (roomEvent.type === 'run_stopped') {
    return existingRun.status === 'failed'
  }

  return false
}

const formatOption = (option: NonNullable<RuntimeEvent['options']>[number]) => {
  const value = option.value == null ? '' : ` (${option.value})`
  const description = option.description == null ? '' : ` - ${option.description}`
  return `- ${option.label}${value}${description}`
}

const buildLeaderSubmitCommandExample = (event: RuntimeEvent) =>
  JSON.stringify({
    commandId: `child-request-${event.sessionId}`,
    type: 'session.submit',
    sessionId: event.sessionId,
    interactionId: event.requestId ?? event.id,
    data: '<option-value>'
  })

const buildLeaderRequestMessageContent = (
  event: RuntimeEvent,
  member: AgentRoomEventMember,
  run: AgentRoomEventRun,
  summary: string
) => {
  const interactionId = getHostRequestInteractionId(event)
  const requestKind = getAttentionRequestKind(event)
  const options = event.options?.map(formatOption).join('\n')
  const runtimeProtocolCommand =
    `${resolveRuntimeProtocolCliCommand()} --input-format stream-json --output-format stream-json`
  const metadataLines = [
    `memberKey: ${member.key}`,
    `runKey: ${run.key}`,
    `childSessionId: ${event.sessionId}`,
    `interactionId: ${interactionId}`,
    `runtimeRequestKind: ${requestKind}`,
    ...(event.kind != null ? [`runtimeInteractionKind: ${event.kind}`] : [])
  ]

  return [
    `[Agent room child request] ${member.label} / ${run.title} is waiting for your handling.`,
    '',
    `Request: ${summary}`,
    '',
    'Context:',
    ...metadataLines.map(line => `- ${line}`),
    ...(options != null && options.trim() !== ''
      ? ['', 'Child runtime options:', options]
      : []),
    '',
    'Leader action:',
    "- You may approve or deny this child request yourself when it is clearly within this leader session's authority, such as low-risk read-only inspection or a permission already granted by the user for this session.",
    '- To handle it yourself, submit exactly one child runtime option value with the unified CLI runtime protocol. Example:',
    '```bash',
    `cat <<'JSONL' | ${runtimeProtocolCommand}`,
    buildLeaderSubmitCommandExample(event),
    'JSONL',
    '```',
    '- Ask the user from this leader session only when the request is destructive, privacy-sensitive, outside the granted scope, or ambiguous. Do not ask the user merely to relay an obvious child approval choice.'
  ].join('\n')
}

const scheduleHostRequestDelivery = (
  db: SqliteDb,
  room: AgentRoom,
  event: RuntimeEvent,
  member: AgentRoomEventMember,
  run: AgentRoomEventRun,
  summary: string,
  delivery: RuntimeRoomHostRequestDelivery
) => {
  const hostSessionId = getHostSessionId(event) ?? room.hostSessionId
  if (hostSessionId == null || hostSessionId === '') {
    return
  }
  if (db.getSession(hostSessionId) == null) {
    return
  }

  const deliveryKey = getHostRequestDeliveryKey(event)
  const legacyDeliveryKey = getLegacyHostRequestDeliveryKey(event)
  const eventTime = getEventTime(event)
  if (
    pendingHostRequestDeliveries.has(deliveryKey) ||
    hasHostRequestDeliveryMarker(db, hostSessionId, deliveryKey, legacyDeliveryKey, eventTime)
  ) {
    return
  }

  const content = buildLeaderRequestMessageContent(event, member, run, summary)
  pendingHostRequestDeliveries.add(deliveryKey)
  void Promise.resolve(delivery.processUserMessage(hostSessionId, content))
    .then(() => {
      db.saveMessage(hostSessionId, {
        type: 'adapter_event',
        data: {
          source: 'runtime_host_request_delivery',
          deliveryKey,
          runtimeEventId: event.id,
          runtimeEventSeq: event.seq,
          childSessionId: event.sessionId,
          runKey: run.key,
          interactionId: getHostRequestInteractionId(event),
          requestKind: getAttentionRequestKind(event),
          createdAt: eventTime
        }
      })
    })
    .catch(error => {
      logger.warn({
        hostSessionId,
        childSessionId: event.sessionId,
        deliveryKey,
        error: error instanceof Error ? error.message : String(error)
      }, '[runtime-store] Failed to deliver child request to host session')
    })
    .finally(() => {
      pendingHostRequestDeliveries.delete(deliveryKey)
    })
}

export function projectRuntimeRoomEvent(
  db: SqliteDb,
  event: RuntimeEvent,
  metadata?: RuntimeSessionMetadata,
  options: RuntimeRoomProjectionOptions = {}
) {
  const room = ensureRoom(db, event, metadata)
  if (room == null) {
    return
  }

  const service = createAgentRoomService(db)
  const member = getMember(event, metadata)
  const run = getRun(event, metadata)
  const runStatus = event.type === 'approval_requested' || event.type === 'input_requested'
    ? 'waiting'
    : getRoomRunStatus(event)
  const isAttentionRequest = event.type === 'approval_requested' || event.type === 'input_requested'
  const shouldUseSummaryForRunState = isAttentionRequest ||
    runStatus === 'completed' ||
    runStatus === 'failed' ||
    runStatus === 'stopped'
  const summary = getRoomSummary(event)
  service.upsertMember(room.id, member, { now: getEventTime(event) })
  service.upsertRun(room.id, {
    ...run,
    memberKey: member.key,
    ...(runStatus != null ? { status: runStatus } : {}),
    ...(shouldUseSummaryForRunState && summary != null ? { latestSummary: summary } : {})
  })

  if (isAttentionRequest && summary != null && summary.trim() !== '') {
    scheduleHostRequestDelivery(
      db,
      room,
      event,
      member,
      run,
      summary,
      options.hostRequestDelivery ?? defaultHostRequestDelivery
    )
  }

  const roomEvent = summary == null || summary.trim() === ''
    ? undefined
    : toRoomMessageEvent(event, member, run, summary)

  if (event.type === 'session_started' || roomEvent != null) {
    ensureRuntimeMemberJoined(db, service, room.id, member, getEventTime(event))
  }

  if (roomEvent == null) {
    return
  }

  if (shouldSkipStaleTerminalEvent(db, room.id, roomEvent)) {
    return
  }
  if (roomEvent.type === 'run_completed' && hasEquivalentCompletedRoomMessage(db, room.id, roomEvent)) {
    return
  }
  service.applyEvent(room.id, {
    ...roomEvent,
    id: getRoomEventId(event)
  }, { now: getEventTime(event) })
}
