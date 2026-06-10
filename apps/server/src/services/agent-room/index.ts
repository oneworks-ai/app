/* eslint-disable max-lines */

import { randomUUID } from 'node:crypto'
import { appendFile } from 'node:fs/promises'
import { env as processEnv } from 'node:process'

import { DEFAULT_SUPPORTED_PROTOCOL_RANGE, getCurrentProtocolVersion } from '@oneworks/runtime-protocol'
import type { RuntimeCommand } from '@oneworks/runtime-protocol'

import type {
  AgentRoom,
  AgentRoomDetail,
  AgentRoomEvent,
  AgentRoomEventMember,
  AgentRoomEventRequestKind,
  AgentRoomEventRun,
  AgentRoomInteractionOption,
  AgentRoomInteractionRequestStatus,
  AgentRoomMember,
  AgentRoomMessage,
  AgentRoomMessageReference,
  AgentRoomRun,
  AgentRoomRunStatus,
  AgentRoomStatus,
  AgentRoomUserMessageDelivery,
  AgentRoomUserMessageTarget,
  ChatMessageContent,
  Session,
  UpdateAgentRoomMetadataRequest,
  WSEvent
} from '@oneworks/core'

import { getDb } from '#~/db/index.js'
import { discoverRuntimeSessionStores, migrateRuntimeRoots } from '#~/services/runtime-store/discovery.js'
import { resolveSessionRuntimeStoreRoot } from '#~/services/runtime-store/session-control.js'
import { createWorkspaceRuntimeEnv } from '#~/services/runtime-store/workspace-env.js'
import { processUserMessage } from '#~/services/session/index.js'
import { getSessionInteraction, handleInteractionResponse } from '#~/services/session/interaction.js'
import { notifySessionUpdated } from '#~/services/session/runtime.js'

type AgentRoomDb = ReturnType<typeof getDb>

export interface AgentRoomSessionDelivery {
  processUserMessage: (sessionId: string, content: string) => Promise<void>
  handleInteractionResponse: (
    sessionId: string,
    interactionId: string,
    data: string | string[]
  ) => boolean | Promise<boolean>
  getSessionInteraction?: (sessionId: string) => { id: string } | undefined
  notifySessionUpdated?: (sessionId: string, session: Session) => void
}

type AgentRoomInteractionResponseData = string | string[]

interface HostInteractionRequestState {
  status: AgentRoomInteractionRequestStatus
  response?: AgentRoomInteractionResponseData
}

interface RuntimeRoomMessageContext {
  currentRun?: AgentRoomRun
  detail: AgentRoomDetail
}

const defaultSessionDelivery: AgentRoomSessionDelivery = {
  processUserMessage,
  handleInteractionResponse,
  getSessionInteraction,
  notifySessionUpdated
}

const formatRuntimeRoomRunLine = (
  run: AgentRoomRun,
  currentRun: AgentRoomRun | undefined
) => {
  const fields = [
    `memberKey=${run.memberKey}`,
    `sessionId=${run.sessionId}`,
    `runKey=${run.key}`,
    `status=${run.status}`,
    ...(run.title.trim() !== '' ? [`title=${run.title.trim()}`] : []),
    ...(currentRun?.key === run.key || currentRun?.sessionId === run.sessionId ? ['current=true'] : [])
  ]
  return `  - ${fields.join(' | ')}`
}

const buildRuntimeRoomMessageContent = (
  content: string,
  context?: RuntimeRoomMessageContext
) => {
  if (context == null) {
    return content
  }

  const currentMemberKey = context.currentRun?.memberKey
  return [
    '<agent-room-message>',
    'Current Agent Room context:',
    `- roomId: ${context.detail.room.id}`,
    `- roomTitle: ${context.detail.room.title}`,
    ...(currentMemberKey != null ? [`- currentMemberKey: ${currentMemberKey}`] : []),
    '- existing member sessions:',
    ...context.detail.runs.map(run => formatRuntimeRoomRunLine(run, context.currentRun)),
    '',
    'Routing rules:',
    '- This message is for the current member session.',
    '- Do not start a new session for any existing member listed above.',
    '- To send a message to another existing member, use `session.message` targeting the exact `sessionId` listed above.',
    '- Set `source` to your current member key when sending to another member.',
    '',
    'User message:',
    content,
    '</agent-room-message>'
  ].join('\n')
}

const appendRuntimeSessionMessage = async (
  db: AgentRoomDb,
  sessionId: string,
  content: string,
  source = 'user',
  context?: RuntimeRoomMessageContext
) => {
  const runtimeState = db.getSessionRuntimeState(sessionId)
  if (runtimeState?.runtimeKind !== 'external') {
    return false
  }

  const workspace = db.getSessionWorkspace(sessionId)
  const runtimeRoots: string[] = []
  if (workspace?.workspaceFolder != null) {
    const env = createWorkspaceRuntimeEnv(workspace.workspaceFolder, processEnv)
    await migrateRuntimeRoots({ cwd: workspace.workspaceFolder, env })
    runtimeRoots.push(resolveSessionRuntimeStoreRoot(workspace.workspaceFolder, env))
  } else {
    return false
  }
  const stores = await discoverRuntimeSessionStores(runtimeRoots)
  const store = stores.find(item => item.sessionId === sessionId)
  if (store == null) {
    return false
  }

  const ts = Date.now()
  const command = {
    protocolVersion: getCurrentProtocolVersion(),
    supportedProtocolRange: DEFAULT_SUPPORTED_PROTOCOL_RANGE,
    id: `cmd_send_message_${randomUUID()}`,
    ts,
    sessionId,
    type: 'send_message',
    priority: 20,
    source,
    commandId: `agent-room-message-${randomUUID()}`,
    content: buildRuntimeRoomMessageContent(content, context)
  } satisfies RuntimeCommand
  await appendFile(store.commandsPath, `${JSON.stringify(command)}\n`, 'utf8')
  return true
}

const hasRun = (event: AgentRoomEvent): event is Exclude<AgentRoomEvent, { type: 'member_joined' }> => (
  'run' in event
)

const getEventContent = (event: AgentRoomEvent) => {
  switch (event.type) {
    case 'member_joined':
      return `${event.member.label} joined the room`
    case 'assignment_sent':
    case 'attention_requested':
    case 'run_replied':
    case 'run_failed':
      return event.summary
    case 'run_resumed':
      return event.summary ?? 'Run resumed'
    case 'run_completed':
      return event.summary ?? 'Run completed'
    case 'run_stopped':
      return event.summary ?? 'Run stopped'
  }
}

const getRunStatusForEvent = (event: Exclude<AgentRoomEvent, { type: 'member_joined' }>): AgentRoomRunStatus => {
  switch (event.type) {
    case 'assignment_sent':
    case 'run_replied':
    case 'run_resumed':
      return 'running'
    case 'attention_requested':
      return 'waiting'
    case 'run_completed':
      return 'completed'
    case 'run_failed':
      return 'failed'
    case 'run_stopped':
      return 'stopped'
  }
}

const getRoomStatus = (runs: AgentRoomRun[], fallback: AgentRoomStatus): AgentRoomStatus => {
  if (runs.some(run => run.status === 'running' || run.status === 'waiting')) {
    return 'active'
  }
  if (runs.some(run => run.status === 'failed')) {
    return 'failed'
  }
  if (runs.length > 0 && runs.every(run => run.status === 'completed' || run.status === 'stopped')) {
    return 'completed'
  }
  return fallback
}

const getMemberStatus = (runs: AgentRoomRun[]) => {
  const pendingCount = runs.filter(run => run.status === 'waiting').length
  const activeRunCount = runs.filter(run => run.status === 'running' || run.status === 'waiting').length

  if (pendingCount > 0) {
    return {
      activeRunCount,
      pendingCount,
      status: 'waiting' as const
    }
  }

  if (activeRunCount > 0) {
    return {
      activeRunCount,
      pendingCount,
      status: 'active' as const
    }
  }

  if (runs.length === 0) {
    return {
      activeRunCount,
      pendingCount,
      status: 'idle' as const
    }
  }

  if (runs.some(run => run.status === 'failed')) {
    return {
      activeRunCount,
      pendingCount,
      status: 'failed' as const
    }
  }

  if (runs.every(run => run.status === 'stopped')) {
    return {
      activeRunCount,
      pendingCount,
      status: 'stopped' as const
    }
  }

  return {
    activeRunCount,
    pendingCount,
    status: 'completed' as const
  }
}

const terminalRunStatusRank: Partial<Record<AgentRoomRunStatus, number>> = {
  completed: 1,
  stopped: 2,
  failed: 3
}

const resolveRunStatusTransition = (
  existing: AgentRoomRun | undefined,
  existingStatus: AgentRoomRunStatus | undefined,
  nextStatus: AgentRoomRunStatus,
  nextSummary?: string
): AgentRoomRunStatus => {
  if (
    existingStatus === 'waiting' &&
    nextStatus === 'completed' &&
    existing?.latestSummary != null &&
    (nextSummary == null || existing.latestSummary.trim() === nextSummary.trim())
  ) {
    return existingStatus
  }

  const existingRank = existingStatus == null ? undefined : terminalRunStatusRank[existingStatus]
  const nextRank = terminalRunStatusRank[nextStatus]
  if (existingRank != null && nextRank != null && existingRank > nextRank) {
    return existingStatus as AgentRoomRunStatus
  }
  return nextStatus
}

const shouldPreserveExistingTerminalRun = (
  existingStatus: AgentRoomRunStatus | undefined,
  nextStatus: AgentRoomRunStatus
) => {
  const existingRank = existingStatus == null ? undefined : terminalRunStatusRank[existingStatus]
  const nextRank = terminalRunStatusRank[nextStatus]
  return existingRank != null && nextRank != null && existingRank > nextRank
}

const resolveRunLatestSummary = (
  existing: AgentRoomRun | undefined,
  nextStatus: AgentRoomRunStatus,
  nextSummary: string | undefined
) => {
  if (
    existing?.status === 'waiting' &&
    nextStatus === 'completed' &&
    existing.latestSummary != null &&
    (nextSummary == null || existing.latestSummary.trim() === nextSummary.trim())
  ) {
    return existing.latestSummary
  }

  if (shouldPreserveExistingTerminalRun(existing?.status, nextStatus)) {
    return existing?.latestSummary
  }

  return nextSummary ?? existing?.latestSummary
}

const getAssignmentSenderMemberKey = (room: AgentRoom) => (
  room.hostSessionId == null || room.hostSessionId === ''
    ? 'host'
    : `host:${room.hostSessionId}`
)

const hostAssistantProjectionEventTypes = new Set<AgentRoomEvent['type']>([
  'assignment_sent',
  'attention_requested',
  'run_completed',
  'run_failed',
  'run_stopped'
])

const hostChildRequestPrefix = '[Agent room child request]'
const hostRoomMessageMatchWindowMs = 30_000
const runtimeRoomMessageUserMarker = '\nUser message:\n'
const runtimeRoomMessageCloseTag = '\n</agent-room-message>'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const isTextContentItem = (item: ChatMessageContent): item is Extract<ChatMessageContent, { type: 'text' }> => (
  item.type === 'text' && item.text.trim() !== ''
)

const getMessageContentText = (content: string | ChatMessageContent[]) => {
  if (typeof content === 'string') {
    return content
  }

  return content.find(isTextContentItem)?.text
}

const getRuntimeRoomUserMessageContent = (content: string) => {
  const trimmed = content.trim()
  if (!trimmed.startsWith('<agent-room-message>')) {
    return content
  }

  const markerIndex = trimmed.indexOf(runtimeRoomMessageUserMarker)
  const closeIndex = trimmed.lastIndexOf(runtimeRoomMessageCloseTag)
  if (markerIndex < 0 || closeIndex <= markerIndex) {
    return content
  }

  const userContent = trimmed.slice(markerIndex + runtimeRoomMessageUserMarker.length, closeIndex).trim()
  return userContent === '' ? content : userContent
}

const getHostChildRequestMetadataValue = (content: string, key: string) => {
  const match = content.match(new RegExp(`(?:^|\\n)-\\s*${key}:\\s*([^\\n]+)`))
  const value = match?.[1]?.trim()
  return value == null || value === '' ? undefined : value
}

const getRoomMessageDelivery = (message: AgentRoomMessage) => {
  const payload = message.payload as unknown
  if (!isRecord(payload) || !isRecord(payload.delivery)) {
    return undefined
  }

  return payload.delivery
}

const toRoomUserMessageTarget = (value: Record<string, unknown>): AgentRoomUserMessageTarget | undefined => {
  const memberKey = typeof value.memberKey === 'string' ? value.memberKey : undefined
  const runKey = typeof value.runKey === 'string' ? value.runKey : undefined
  if (memberKey == null && runKey == null) {
    return undefined
  }

  return {
    ...(memberKey != null ? { memberKey } : {}),
    ...(runKey != null ? { runKey } : {})
  }
}

const isDeliveredRoomUserMessage = (
  message: AgentRoomMessage,
  sessionId: string,
  content: string,
  turnCreatedAt: number
) => {
  if (message.role !== 'user' || message.content.trim() !== content.trim()) {
    return false
  }

  const delivery = getRoomMessageDelivery(message)
  if (delivery == null || delivery.sessionId !== sessionId) {
    return false
  }

  const receivedAt = typeof delivery.receivedAt === 'number' ? delivery.receivedAt : message.createdAt
  return Math.abs(receivedAt - turnCreatedAt) <= hostRoomMessageMatchWindowMs
}

const findDeliveredRoomUserMessage = (
  roomMessages: AgentRoomMessage[],
  sessionId: string,
  content: string,
  turnCreatedAt: number
) => (
  roomMessages.find(message => isDeliveredRoomUserMessage(message, sessionId, content, turnCreatedAt))
)

const toRoomMessageReference = (message: AgentRoomMessage): AgentRoomMessageReference => ({
  id: message.id,
  role: message.role,
  content: message.content
})

const toChildSessionUserRoomMessage = (
  room: AgentRoom,
  run: AgentRoomRun,
  event: Extract<WSEvent, { type: 'message' }>,
  content: string
): AgentRoomMessage => {
  const target = {
    memberKey: run.memberKey,
    runKey: run.key
  }
  return {
    id: `child-user:${run.sessionId}:${event.message.id}`,
    roomId: room.id,
    role: 'user',
    memberKey: run.memberKey,
    runKey: run.key,
    content,
    payload: {
      source: 'child_session_user_message',
      sessionId: run.sessionId,
      messageId: event.message.id,
      target
    },
    createdAt: event.message.createdAt
  }
}

const getHostInteractionRequestKind = (payload: unknown): AgentRoomEventRequestKind => (
  isRecord(payload) && payload.kind === 'permission' ? 'confirmation' : 'input'
)

const getHostInteractionRequestContent = (payload: unknown) => {
  if (!isRecord(payload) || typeof payload.question !== 'string') {
    return undefined
  }

  const question = payload.question.trim()
  return question === '' ? undefined : question
}

const getHostInteractionRequestOptions = (payload: unknown): AgentRoomInteractionOption[] | undefined => {
  if (!isRecord(payload) || !Array.isArray(payload.options)) {
    return undefined
  }

  const options = payload.options.flatMap(option => {
    if (!isRecord(option) || typeof option.label !== 'string' || option.label.trim() === '') {
      return []
    }

    const value = typeof option.value === 'string' && option.value.trim() !== ''
      ? option.value.trim()
      : undefined
    const description = typeof option.description === 'string' && option.description.trim() !== ''
      ? option.description.trim()
      : undefined

    return [{
      label: option.label.trim(),
      ...(value != null ? { value } : {}),
      ...(description != null ? { description } : {})
    }]
  })

  return options.length === 0 ? undefined : options
}

const isFatalSessionErrorEvent = (event: WSEvent) => (
  event.type === 'error' && (!isRecord(event.data) || event.data.fatal !== false)
)

const getHostInteractionRequestStates = (
  events: WSEvent[],
  session: Session | undefined
) => {
  const requests = new Map<string, {
    hasFatalErrorAfterRequest: boolean
    response?: AgentRoomInteractionResponseData
  }>()
  const openRequestIds = new Set<string>()

  for (const event of events) {
    if (event.type === 'interaction_request') {
      requests.set(event.id, { hasFatalErrorAfterRequest: false })
      openRequestIds.add(event.id)
      continue
    }

    if (event.type === 'interaction_response') {
      const request = requests.get(event.id)
      if (request != null) {
        request.response = event.data
      }
      openRequestIds.delete(event.id)
      continue
    }

    if (isFatalSessionErrorEvent(event)) {
      for (const requestId of openRequestIds) {
        const request = requests.get(requestId)
        if (request != null) {
          request.hasFatalErrorAfterRequest = true
        }
      }
    }
  }

  let pendingRequestId: string | undefined
  if (session?.status === 'waiting_input') {
    for (const [requestId, request] of [...requests.entries()].reverse()) {
      if (request.response == null && !request.hasFatalErrorAfterRequest) {
        pendingRequestId = requestId
        break
      }
    }
  }

  return new Map<string, HostInteractionRequestState>([...requests.entries()].map(([requestId, request]) => {
    if (request.response != null) {
      return [
        requestId,
        {
          status: 'handled',
          response: request.response
        } satisfies HostInteractionRequestState
      ] as const
    }

    return [
      requestId,
      {
        status: requestId === pendingRequestId ? 'pending' : 'expired'
      } satisfies HostInteractionRequestState
    ] as const
  }))
}

const toHostInteractionRequestRoomMessage = (
  room: AgentRoom,
  hostMemberKey: string,
  hostSessionId: string,
  event: Extract<WSEvent, { type: 'interaction_request' }>,
  state: HostInteractionRequestState,
  createdAt: number
): AgentRoomMessage | undefined => {
  const content = getHostInteractionRequestContent(event.payload)
  if (content == null) {
    return undefined
  }

  const requestKind = getHostInteractionRequestKind(event.payload)
  const options = getHostInteractionRequestOptions(event.payload)
  const permissionContext = isRecord(event.payload) && isRecord(event.payload.permissionContext)
    ? event.payload.permissionContext
    : undefined

  return {
    id: `host-interaction:${hostSessionId}:${event.id}`,
    roomId: room.id,
    role: 'agent',
    memberKey: hostMemberKey,
    content,
    eventType: 'attention_requested',
    payload: {
      source: 'host_session_interaction_request',
      type: 'attention_requested',
      sessionId: hostSessionId,
      interactionId: event.id,
      requestKind,
      status: state.status,
      ...(options != null ? { options } : {}),
      ...(state.response != null ? { response: state.response } : {}),
      ...(permissionContext != null ? { permissionContext } : {})
    },
    createdAt
  }
}

const getHostChildRequestTarget = (content: string): AgentRoomUserMessageTarget | undefined => {
  if (!content.startsWith(hostChildRequestPrefix)) {
    return undefined
  }

  const memberKey = getHostChildRequestMetadataValue(content, 'memberKey')
  const runKey = getHostChildRequestMetadataValue(content, 'runKey') ??
    getHostChildRequestMetadataValue(content, 'childSessionId')
  if (memberKey == null && runKey == null) {
    return undefined
  }

  return {
    ...(memberKey != null ? { memberKey } : {}),
    ...(runKey != null ? { runKey } : {})
  }
}

const getHostSessionRoomMessages = (
  db: AgentRoomDb,
  room: AgentRoom,
  roomMessages: AgentRoomMessage[]
): AgentRoomMessage[] => {
  const hostSessionId = room.hostSessionId
  if (hostSessionId == null || hostSessionId === '') {
    return []
  }

  const hostMemberKey = getAssignmentSenderMemberKey(room)
  const hostSession = db.getSession(hostSessionId)
  const hostEvents = db.getMessages(hostSessionId) as WSEvent[]
  const hostInteractionStates = getHostInteractionRequestStates(hostEvents, hostSession)
  let hasProjectedInitialUserMessage = false
  let currentHostTurnStartAt: number | undefined
  let currentHostTurnUserMessage: Extract<WSEvent, { type: 'message' }> | undefined
  let currentHostTurnUserContent: string | undefined
  let currentHostTurnIsChildRequest = false
  let currentHostTurnIsRoomMessage = false
  let currentHostTurnTarget: AgentRoomUserMessageTarget | undefined
  let currentHostTurnReplyTo: AgentRoomMessageReference | undefined
  let pendingAssistantMessage: Extract<WSEvent, { type: 'message' }> | undefined
  let pendingAssistantContent: string | undefined
  let latestHostEventCreatedAt = room.createdAt
  const projectedMessages: AgentRoomMessage[] = []

  const nextHostEventCreatedAt = () => {
    latestHostEventCreatedAt += 1
    return latestHostEventCreatedAt
  }

  const hasRoomActivityInHostTurn = (turnStartAt: number, turnEndAt: number | undefined) =>
    roomMessages.some(message =>
      message.eventType != null &&
      hostAssistantProjectionEventTypes.has(message.eventType) &&
      message.createdAt >= turnStartAt &&
      (turnEndAt == null || message.createdAt < turnEndAt)
    )

  const getCurrentHostTurnActivityEndAt = (turnEndAt?: number) =>
    turnEndAt ?? pendingAssistantMessage?.message.createdAt

  const currentHostTurnHasRoomActivity = (turnEndAt?: number) => (
    currentHostTurnStartAt != null &&
    hasRoomActivityInHostTurn(currentHostTurnStartAt, getCurrentHostTurnActivityEndAt(turnEndAt))
  )

  const resetCurrentHostTurn = () => {
    currentHostTurnStartAt = undefined
    currentHostTurnUserMessage = undefined
    currentHostTurnUserContent = undefined
    currentHostTurnIsChildRequest = false
    currentHostTurnIsRoomMessage = false
    currentHostTurnTarget = undefined
    currentHostTurnReplyTo = undefined
    pendingAssistantMessage = undefined
    pendingAssistantContent = undefined
  }

  const appendHostUserMessage = (hasRoomActivity: boolean) => {
    if (
      currentHostTurnUserMessage == null ||
      currentHostTurnUserContent == null ||
      currentHostTurnIsChildRequest ||
      currentHostTurnIsRoomMessage
    ) {
      return
    }

    const isInitialProjection = !hasProjectedInitialUserMessage
    if (!isInitialProjection && !hasRoomActivity) {
      return
    }

    hasProjectedInitialUserMessage = true
    projectedMessages.push({
      id: isInitialProjection
        ? `host-initial:${hostSessionId}:${currentHostTurnUserMessage.message.id}`
        : `host-user:${hostSessionId}:${currentHostTurnUserMessage.message.id}`,
      roomId: room.id,
      role: 'user',
      content: currentHostTurnUserContent,
      payload: {
        source: isInitialProjection ? 'host_initial_message' : 'host_user_message',
        sessionId: hostSessionId,
        messageId: currentHostTurnUserMessage.message.id
      },
      createdAt: currentHostTurnUserMessage.message.createdAt
    })
  }

  const appendCurrentHostTurn = (turnEndAt?: number) => {
    const hasRoomActivity = currentHostTurnHasRoomActivity(turnEndAt)
    appendHostUserMessage(hasRoomActivity)

    if (pendingAssistantMessage == null || pendingAssistantContent == null) {
      resetCurrentHostTurn()
      return
    }
    if (!currentHostTurnIsChildRequest && !currentHostTurnIsRoomMessage && !hasRoomActivity) {
      resetCurrentHostTurn()
      return
    }

    const target = currentHostTurnTarget
    projectedMessages.push({
      id: `host-message:${hostSessionId}:${pendingAssistantMessage.message.id}`,
      roomId: room.id,
      role: 'agent',
      memberKey: hostMemberKey,
      ...(target?.runKey != null ? { runKey: target.runKey } : {}),
      content: pendingAssistantContent,
      payload: {
        source: 'host_session_message',
        sessionId: hostSessionId,
        messageId: pendingAssistantMessage.message.id,
        ...(currentHostTurnReplyTo != null ? { replyTo: currentHostTurnReplyTo } : {}),
        ...(target != null ? { target } : {})
      },
      createdAt: pendingAssistantMessage.message.createdAt
    })
    resetCurrentHostTurn()
  }

  for (const event of hostEvents) {
    if (event.type === 'interaction_request') {
      const message = toHostInteractionRequestRoomMessage(
        room,
        hostMemberKey,
        hostSessionId,
        event,
        hostInteractionStates.get(event.id) ?? { status: 'expired' },
        nextHostEventCreatedAt()
      )
      if (message != null) {
        projectedMessages.push(message)
      }
      continue
    }

    if (event.type !== 'message') {
      continue
    }

    latestHostEventCreatedAt = Math.max(latestHostEventCreatedAt, event.message.createdAt)
    const content = getMessageContentText(event.message.content)?.trim()
    if (content == null || content === '') {
      continue
    }

    if (event.message.role === 'user') {
      appendCurrentHostTurn(event.message.createdAt)
      currentHostTurnStartAt = event.message.createdAt
      currentHostTurnUserMessage = event
      currentHostTurnUserContent = content
      currentHostTurnTarget = getHostChildRequestTarget(content)
      currentHostTurnIsChildRequest = currentHostTurnTarget != null || content.startsWith(hostChildRequestPrefix)
      const roomUserMessage = findDeliveredRoomUserMessage(
        roomMessages,
        hostSessionId,
        content,
        event.message.createdAt
      )
      currentHostTurnIsRoomMessage = roomUserMessage != null
      currentHostTurnReplyTo = roomUserMessage == null ? undefined : toRoomMessageReference(roomUserMessage)
      continue
    }

    if (event.message.role !== 'assistant') {
      continue
    }

    // Keep only the final assistant message of each host turn. Intermediate
    // planning/progress text belongs in the session transcript, not the room.
    pendingAssistantMessage = event
    pendingAssistantContent = content
  }

  appendCurrentHostTurn()
  return projectedMessages
}

const getRoomUserMessageTarget = (message: AgentRoomMessage): AgentRoomUserMessageTarget | undefined => {
  const payload = message.payload as unknown
  if (!isRecord(payload)) {
    return undefined
  }

  if (isRecord(payload.delivery) && isRecord(payload.delivery.target)) {
    return toRoomUserMessageTarget(payload.delivery.target)
  }

  if (isRecord(payload.target)) {
    return toRoomUserMessageTarget(payload.target)
  }

  return undefined
}

const getChildDeliveredRoomUserMessages = (
  room: AgentRoom,
  roomMessages: AgentRoomMessage[]
) => {
  const messagesBySession = new Map<string, AgentRoomMessage[]>()

  for (const message of roomMessages) {
    const delivery = getRoomMessageDelivery(message)
    if (
      message.role !== 'user' ||
      delivery == null ||
      typeof delivery.sessionId !== 'string' ||
      delivery.sessionId === room.hostSessionId ||
      getRoomUserMessageTarget(message) == null
    ) {
      continue
    }

    const messages = messagesBySession.get(delivery.sessionId) ?? []
    messages.push(message)
    messagesBySession.set(delivery.sessionId, messages)
  }

  return messagesBySession
}

const getChildSessionRunsBySession = (
  db: AgentRoomDb,
  room: AgentRoom,
  messagesBySession: Map<string, AgentRoomMessage[]>
) => {
  const runsBySession = new Map<string, AgentRoomRun>()
  for (const run of db.listAgentRoomRuns(room.id)) {
    if (run.sessionId === room.hostSessionId || run.sessionId.trim() === '') {
      continue
    }
    runsBySession.set(run.sessionId, run)
  }
  for (const sessionId of messagesBySession.keys()) {
    if (runsBySession.has(sessionId)) {
      continue
    }
    const run = db.listAgentRoomRuns(room.id).find(item => item.sessionId === sessionId)
    if (run != null) {
      runsBySession.set(sessionId, run)
    }
  }
  return runsBySession
}

const isChildSessionAssignmentUserMessage = (
  roomMessages: AgentRoomMessage[],
  run: AgentRoomRun,
  content: string
) => (
  roomMessages.some(message =>
    message.eventType === 'assignment_sent' &&
    message.runKey === run.key &&
    normalizeCompletedMessageContent(message.content) === normalizeCompletedMessageContent(content)
  )
)

const getChildSessionRoomMessages = (
  db: AgentRoomDb,
  room: AgentRoom,
  roomMessages: AgentRoomMessage[]
): AgentRoomMessage[] => {
  const messagesBySession = getChildDeliveredRoomUserMessages(room, roomMessages)
  const runsBySession = getChildSessionRunsBySession(db, room, messagesBySession)
  if (runsBySession.size === 0) {
    return []
  }

  const projectedMessages: AgentRoomMessage[] = []

  for (const [sessionId, run] of runsBySession) {
    const deliveredRoomMessages = messagesBySession.get(sessionId) ?? []
    const consumedRoomMessageIds = new Set<string>()
    let currentRoomMessage: AgentRoomMessage | undefined
    let pendingAssistantMessage: Extract<WSEvent, { type: 'message' }> | undefined
    let pendingAssistantContent: string | undefined

    const appendPendingAssistantMessage = () => {
      if (currentRoomMessage == null || pendingAssistantMessage == null || pendingAssistantContent == null) {
        return
      }

      const target = getRoomUserMessageTarget(currentRoomMessage)
      const memberKey = target?.memberKey ?? currentRoomMessage.memberKey
      const runKey = target?.runKey ?? currentRoomMessage.runKey
      projectedMessages.push({
        id: `child-message:${sessionId}:${pendingAssistantMessage.message.id}`,
        roomId: room.id,
        role: 'agent',
        ...(memberKey != null ? { memberKey } : {}),
        ...(runKey != null ? { runKey } : {}),
        content: pendingAssistantContent,
        payload: {
          source: 'child_session_message',
          sessionId,
          messageId: pendingAssistantMessage.message.id,
          replyTo: toRoomMessageReference(currentRoomMessage),
          ...(target != null ? { target } : {})
        },
        createdAt: pendingAssistantMessage.message.createdAt
      })

      currentRoomMessage = undefined
      pendingAssistantMessage = undefined
      pendingAssistantContent = undefined
    }

    for (const event of db.getMessages(sessionId) as WSEvent[]) {
      if (event.type !== 'message') {
        continue
      }

      const content = getMessageContentText(event.message.content)?.trim()
      if (content == null || content === '') {
        continue
      }

      if (event.message.role === 'user') {
        appendPendingAssistantMessage()
        pendingAssistantMessage = undefined
        pendingAssistantContent = undefined
        const userContent = getRuntimeRoomUserMessageContent(content).trim()
        currentRoomMessage = deliveredRoomMessages.find(message =>
          !consumedRoomMessageIds.has(message.id) &&
          isDeliveredRoomUserMessage(message, sessionId, userContent, event.message.createdAt)
        )
        if (currentRoomMessage != null) {
          consumedRoomMessageIds.add(currentRoomMessage.id)
        } else if (!isChildSessionAssignmentUserMessage(roomMessages, run, userContent)) {
          currentRoomMessage = toChildSessionUserRoomMessage(room, run, event, userContent)
          projectedMessages.push(currentRoomMessage)
        }
        continue
      }

      if (event.message.role !== 'assistant' || currentRoomMessage == null) {
        continue
      }

      pendingAssistantMessage = event
      pendingAssistantContent = content
    }

    appendPendingAssistantMessage()
  }

  return projectedMessages
}

const shouldKeepMessageForRunStatus = (
  message: AgentRoomMessage,
  runsByKey: Map<string, AgentRoomRun>
) => {
  if (message.runKey == null) {
    return true
  }

  const run = runsByKey.get(message.runKey)
  if (run == null) {
    return true
  }

  if (message.eventType === 'run_completed') {
    return run.status !== 'failed' && run.status !== 'stopped'
  }
  if (message.eventType === 'run_stopped') {
    return run.status !== 'failed'
  }

  return true
}

const filterStaleTerminalMessages = (detail: AgentRoomDetail): AgentRoomDetail => {
  const runsByKey = new Map(detail.runs.map(run => [run.key, run]))
  return {
    ...detail,
    messages: detail.messages.filter(message => shouldKeepMessageForRunStatus(message, runsByKey))
  }
}

const normalizeCompletedMessageContent = (content: string) => content.trim().replace(/\s+/g, ' ')

const filterDuplicateCompletedMessages = (detail: AgentRoomDetail): AgentRoomDetail => {
  const completedMessageKeys = new Set<string>()
  return {
    ...detail,
    messages: detail.messages.filter(message => {
      if (message.eventType !== 'run_completed' || message.memberKey == null || message.runKey == null) {
        return true
      }

      const key = [
        message.memberKey,
        message.runKey,
        normalizeCompletedMessageContent(message.content)
      ].join('\0')
      if (completedMessageKeys.has(key)) {
        return false
      }
      completedMessageKeys.add(key)
      return true
    })
  }
}

const filterTerminalMessagesShadowedByChildSessionMessages = (
  messages: AgentRoomMessage[],
  childSessionMessages: AgentRoomMessage[]
) => {
  const childMessageKeys = new Set(
    childSessionMessages.flatMap(message =>
      message.role === 'agent' && message.runKey != null
        ? [[message.runKey, normalizeCompletedMessageContent(message.content)].join('\0')]
        : []
    )
  )
  if (childMessageKeys.size === 0) {
    return messages
  }

  return messages.filter(message => {
    if (message.eventType !== 'run_completed' || message.runKey == null) {
      return true
    }
    return !childMessageKeys.has([message.runKey, normalizeCompletedMessageContent(message.content)].join('\0'))
  })
}

const applyDetailMessageSummary = (detail: AgentRoomDetail): AgentRoomDetail => {
  const latestMessage = detail.messages.reduce<AgentRoomMessage | undefined>(
    (latest, message) => latest == null || message.createdAt > latest.createdAt ? message : latest,
    undefined
  )
  if (latestMessage == null || latestMessage.createdAt <= detail.room.updatedAt) {
    return detail
  }

  return {
    ...detail,
    room: {
      ...detail.room,
      lastMessage: latestMessage.content,
      updatedAt: latestMessage.createdAt
    }
  }
}

const toMemberRecord = (
  roomId: string,
  member: AgentRoomEventMember,
  existing: AgentRoomMember | undefined,
  latestSummary: string | undefined,
  now: number
): AgentRoomMember => ({
  roomId,
  key: member.key,
  kind: member.kind,
  label: member.label,
  ...(member.avatar != null ? { avatar: member.avatar } : existing?.avatar != null ? { avatar: existing.avatar } : {}),
  ...(member.subtitle != null
    ? { subtitle: member.subtitle }
    : existing?.subtitle != null
    ? { subtitle: existing.subtitle }
    : {}),
  status: existing?.status ?? 'idle',
  ...(latestSummary != null
    ? { latestSummary }
    : existing?.latestSummary != null
    ? { latestSummary: existing.latestSummary }
    : {}),
  activeRunCount: existing?.activeRunCount ?? 0,
  pendingCount: existing?.pendingCount ?? 0,
  createdAt: existing?.createdAt ?? now,
  updatedAt: now
})

const toRunRecord = (
  roomId: string,
  memberKey: string,
  run: AgentRoomEventRun,
  status: AgentRoomRunStatus,
  latestSummary: string | undefined,
  existing: AgentRoomRun | undefined,
  event: Exclude<AgentRoomEvent, { type: 'member_joined' }> | undefined,
  now: number
): AgentRoomRun => {
  const resolvedLatestSummary = resolveRunLatestSummary(existing, status, latestSummary)
  return {
    roomId,
    key: run.key,
    memberKey,
    sessionId: run.sessionId,
    title: run.title,
    status: resolveRunStatusTransition(existing, existing?.status, status, latestSummary),
    ...(resolvedLatestSummary != null ? { latestSummary: resolvedLatestSummary } : {}),
    ...(event?.type === 'attention_requested' && event.interactionId != null
      ? { interactionId: event.interactionId }
      : {}),
    ...(event?.type === 'attention_requested' ? { requestKind: event.requestKind } : {}),
    ...(event?.type === 'attention_requested' && event.options != null ? { options: event.options } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }
}

export function createAgentRoomService(
  db: AgentRoomDb = getDb(),
  delivery: AgentRoomSessionDelivery = defaultSessionDelivery
) {
  const requireRoom = (roomId: string): AgentRoom => {
    const room = db.getAgentRoom(roomId)
    if (room == null) {
      throw new Error(`Agent room not found: ${roomId}`)
    }
    return room
  }

  const recomputeMember = (roomId: string, memberKey: string, latestSummary?: string) => {
    const existing = db.getAgentRoomMember(roomId, memberKey)
    if (existing == null) {
      return undefined
    }

    const runs = db.listAgentRoomRunsForMember(roomId, memberKey)
    return db.saveAgentRoomMember({
      ...existing,
      ...getMemberStatus(runs),
      ...(latestSummary != null ? { latestSummary } : {}),
      updatedAt: Date.now()
    })
  }

  const updateRoomSummary = (roomId: string, lastMessage: string, now: number) => {
    const room = requireRoom(roomId)
    const status = getRoomStatus(db.listAgentRoomRuns(roomId), room.status)
    db.updateAgentRoom(roomId, {
      lastMessage,
      status,
      updatedAt: now
    })
  }

  const syncHostSessionArchiveState = (room: AgentRoom, isArchived: boolean) => {
    if (room.hostSessionId == null || room.hostSessionId === '') {
      return
    }
    if (db.getSession(room.hostSessionId) == null) {
      return
    }

    const updatedIds = db.updateSessionArchivedWithChildren(room.hostSessionId, isArchived)
    for (const sessionId of updatedIds) {
      const session = db.getSession(sessionId)
      if (session != null) {
        delivery.notifySessionUpdated?.(sessionId, session)
      }
    }
  }

  const updateRoomMetadata = (roomId: string, update: UpdateAgentRoomMetadataRequest): AgentRoom => {
    const room = requireRoom(roomId)
    if (update.isArchived === undefined && update.isFavorited === undefined) {
      return room
    }

    const now = Date.now()
    const updated = db.updateAgentRoom(roomId, {
      ...(update.isArchived !== undefined ? { archivedAt: update.isArchived ? room.archivedAt ?? now : null } : {}),
      ...(update.isFavorited !== undefined
        ? { favoritedAt: update.isFavorited ? room.favoritedAt ?? now : null }
        : {}),
      updatedAt: now
    })
    if (updated == null) {
      throw new Error(`Agent room not found: ${roomId}`)
    }
    if (update.isArchived !== undefined) {
      syncHostSessionArchiveState(room, update.isArchived)
    }
    return updated
  }

  const deliverSessionUserMessage = async (
    sessionId: string,
    content: string,
    options: {
      preferInteractionResponse?: boolean
      runtimeRoomContext?: RuntimeRoomMessageContext
    } = {}
  ) => {
    const session = db.getSession(sessionId)
    if (session == null) {
      return false
    }

    if (options.preferInteractionResponse === true && session.status === 'waiting_input') {
      const interaction = delivery.getSessionInteraction?.(sessionId)
      if (interaction != null) {
        return await delivery.handleInteractionResponse(sessionId, interaction.id, content)
      }
    }

    if (await appendRuntimeSessionMessage(db, sessionId, content, 'user', options.runtimeRoomContext)) {
      return true
    }

    await delivery.processUserMessage(sessionId, content)
    return true
  }

  const deliverSessionInteractionResponse = async (
    sessionId: string,
    interactionId: string,
    content: AgentRoomInteractionResponseData
  ) => {
    const session = db.getSession(sessionId)
    if (session == null) {
      return false
    }

    return await delivery.handleInteractionResponse(sessionId, interactionId, content)
  }

  const getPendingHostInteractionSessionId = (room: AgentRoom, interactionId: string) => {
    const hostSessionId = room.hostSessionId
    if (hostSessionId == null || hostSessionId === '') {
      return undefined
    }

    const session = db.getSession(hostSessionId)
    const states = getHostInteractionRequestStates(db.getMessages(hostSessionId) as WSEvent[], session)
    return states.get(interactionId)?.status === 'pending' ? hostSessionId : undefined
  }

  const getPendingChildRunInteractionSessionId = (roomId: string, interactionId: string) => {
    const run = db.listAgentRoomRuns(roomId).find(item =>
      item.status === 'waiting' &&
      item.interactionId === interactionId &&
      item.sessionId.trim() !== ''
    )
    if (run == null) {
      return undefined
    }

    return run.sessionId
  }

  const respondInteraction = async (
    roomId: string,
    interactionId: string,
    data: AgentRoomInteractionResponseData
  ) => {
    const room = requireRoom(roomId)
    const sessionId = getPendingHostInteractionSessionId(room, interactionId) ??
      getPendingChildRunInteractionSessionId(roomId, interactionId)
    if (sessionId == null) {
      return false
    }

    return deliverSessionInteractionResponse(sessionId, interactionId, data)
  }

  const createMessageDelivery = (
    sessionId: string,
    kind: AgentRoomUserMessageDelivery['kind'],
    target?: AgentRoomUserMessageTarget
  ): AgentRoomUserMessageDelivery => ({
    kind,
    receivedAt: Date.now(),
    sessionId,
    ...(target != null ? { target } : {})
  })

  const resolveTargetRun = (
    roomId: string,
    target: AgentRoomUserMessageTarget | undefined
  ) => {
    if (target?.runKey != null && target.runKey.trim() !== '') {
      const run = db.getAgentRoomRun(roomId, target.runKey)
      if (run == null || (target.memberKey != null && run.memberKey !== target.memberKey)) {
        return undefined
      }
      return run
    }

    if (target?.memberKey == null || target.memberKey.trim() === '') {
      return undefined
    }

    const runs = db.listAgentRoomRunsForMember(roomId, target.memberKey)
    return runs.find(run => run.status === 'waiting') ??
      runs.find(run => run.status === 'running') ??
      runs[0]
  }

  const deliverUserMessage = async (
    room: AgentRoom,
    content: string,
    target: AgentRoomUserMessageTarget | undefined
  ) => {
    const run = resolveTargetRun(room.id, target)
    if (run != null) {
      const deliveryTarget = { memberKey: run.memberKey, runKey: run.key }
      const detail = db.getAgentRoomDetail(room.id)
      if (run.status === 'waiting' && run.interactionId != null && run.interactionId !== '') {
        return await deliverSessionInteractionResponse(run.sessionId, run.interactionId, content)
          ? createMessageDelivery(run.sessionId, 'interaction_response', deliveryTarget)
          : undefined
      }
      const delivered = await deliverSessionUserMessage(run.sessionId, content, {
        runtimeRoomContext: detail == null ? undefined : {
          currentRun: run,
          detail
        }
      })
      return delivered
        ? createMessageDelivery(run.sessionId, 'message', deliveryTarget)
        : undefined
    }

    const targetMember = target?.memberKey == null ? undefined : db.getAgentRoomMember(room.id, target.memberKey)
    if (targetMember?.kind === 'host' && room.hostSessionId != null && room.hostSessionId !== '') {
      return await deliverSessionUserMessage(room.hostSessionId, content, { preferInteractionResponse: true })
        ? createMessageDelivery(room.hostSessionId, 'message', target)
        : undefined
    }

    if (target == null && room.hostSessionId != null && room.hostSessionId !== '') {
      return await deliverSessionUserMessage(room.hostSessionId, content, { preferInteractionResponse: true })
        ? createMessageDelivery(room.hostSessionId, 'message')
        : undefined
    }

    return undefined
  }

  const upsertMember = (
    roomId: string,
    member: AgentRoomEventMember,
    options: {
      latestSummary?: string
      now?: number
    } = {}
  ) => {
    requireRoom(roomId)
    const now = options.now ?? Date.now()
    const existing = db.getAgentRoomMember(roomId, member.key)
    const stored = db.saveAgentRoomMember(toMemberRecord(
      roomId,
      member,
      existing,
      options.latestSummary,
      now
    ))
    return recomputeMember(roomId, member.key, options.latestSummary) ?? stored
  }

  const upsertRun = (
    roomId: string,
    run: AgentRoomEventRun & {
      memberKey: string
      status?: AgentRoomRunStatus
      latestSummary?: string
      interactionId?: string
      requestKind?: AgentRoomRun['requestKind']
      options?: AgentRoomRun['options']
    }
  ) => {
    requireRoom(roomId)
    const member = db.getAgentRoomMember(roomId, run.memberKey)
    if (member == null) {
      throw new Error(`Agent room member not found: ${run.memberKey}`)
    }

    const now = Date.now()
    const existing = db.listAgentRoomRunsForMember(roomId, run.memberKey).find(item => item.key === run.key)
    const nextStatus = run.status ?? existing?.status ?? 'running'
    const latestSummary = resolveRunLatestSummary(existing, nextStatus, run.latestSummary)
    const stored = db.saveAgentRoomRun({
      roomId,
      key: run.key,
      memberKey: run.memberKey,
      sessionId: run.sessionId,
      title: run.title,
      status: resolveRunStatusTransition(existing, existing?.status, nextStatus, run.latestSummary),
      ...(latestSummary != null ? { latestSummary } : {}),
      ...(run.interactionId != null ? { interactionId: run.interactionId } : {}),
      ...(run.requestKind != null ? { requestKind: run.requestKind } : {}),
      ...(run.options != null ? { options: run.options } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    })
    recomputeMember(roomId, run.memberKey, stored.latestSummary)
    updateRoomSummary(roomId, stored.latestSummary ?? member.latestSummary ?? '', now)
    return stored
  }

  const appendUserMessage = async (roomId: string, content: string, target?: AgentRoomUserMessageTarget) => {
    const room = requireRoom(roomId)
    const now = Date.now()
    const deliveryResult = await deliverUserMessage(room, content, target)
    if (deliveryResult == null) {
      throw new Error(`No deliverable session for agent room message: ${roomId}`)
    }

    const message = db.appendAgentRoomMessage({
      roomId,
      role: 'user',
      content,
      ...(target != null ? { memberKey: target.memberKey, runKey: target.runKey } : {}),
      payload: {
        delivery: deliveryResult,
        reactions: [{
          kind: 'working',
          createdAt: deliveryResult.receivedAt,
          ...(deliveryResult.target != null ? { target: deliveryResult.target } : {})
        }],
        ...(target != null ? { target } : {})
      },
      createdAt: now
    })
    updateRoomSummary(roomId, content, now)
    return message
  }

  const applyEvent = (
    roomId: string,
    event: AgentRoomEvent,
    options: {
      now?: number
    } = {}
  ): AgentRoomMessage => {
    const room = requireRoom(roomId)
    const now = options.now ?? Date.now()
    const content = getEventContent(event)
    let summaryForState = content
    const member = upsertMember(roomId, event.member, {
      latestSummary: hasRun(event) ? content : undefined,
      now
    })

    if (hasRun(event)) {
      const existingRun = db.listAgentRoomRunsForMember(roomId, event.member.key).find(item =>
        item.key === event.run.key
      )
      const run = toRunRecord(
        roomId,
        event.member.key,
        event.run,
        getRunStatusForEvent(event),
        content,
        existingRun,
        event,
        now
      )
      const storedRun = db.saveAgentRoomRun(run)
      summaryForState = storedRun.latestSummary ?? content
      recomputeMember(roomId, member.key, storedRun.latestSummary)
    }

    const message = db.appendAgentRoomMessage({
      id: event.id,
      roomId,
      role: event.type === 'member_joined' ? 'system' : 'agent',
      memberKey: event.type === 'assignment_sent' ? getAssignmentSenderMemberKey(room) : event.member.key,
      ...(hasRun(event) ? { runKey: event.run.key } : {}),
      content,
      eventType: event.type,
      payload: event,
      createdAt: now
    })
    updateRoomSummary(roomId, summaryForState, now)
    return message
  }

  const getDetail = (roomId: string): AgentRoomDetail | undefined => {
    const persistedDetail = db.getAgentRoomDetail(roomId)
    if (persistedDetail == null) {
      return undefined
    }

    const detail = filterDuplicateCompletedMessages(filterStaleTerminalMessages(persistedDetail))
    const hostSessionMessages = getHostSessionRoomMessages(db, detail.room, detail.messages)
    const childSessionMessages = getChildSessionRoomMessages(db, detail.room, detail.messages)
    const sessionMessages = [...hostSessionMessages, ...childSessionMessages]
    const messagesWithoutShadowedTerminals = filterTerminalMessagesShadowedByChildSessionMessages(
      detail.messages,
      childSessionMessages
    )
    const existingMessageIds = new Set(messagesWithoutShadowedTerminals.map(message => message.id))
    const projectedMessages = sessionMessages.filter(message => !existingMessageIds.has(message.id))
    if (projectedMessages.length === 0 && messagesWithoutShadowedTerminals.length === detail.messages.length) {
      return applyDetailMessageSummary(detail)
    }

    return applyDetailMessageSummary({
      ...detail,
      messages: filterDuplicateCompletedMessages({
        ...detail,
        messages: [...projectedMessages, ...messagesWithoutShadowedTerminals].sort((left, right) =>
          left.createdAt - right.createdAt
        )
      }).messages
    })
  }

  const listRooms = (filter?: Parameters<AgentRoomDb['listAgentRooms']>[0]) =>
    db.listAgentRooms(filter).map(room => getDetail(room.id)?.room ?? room)

  return {
    appendUserMessage,
    applyEvent,
    createRoom: db.createAgentRoom.bind(db),
    deleteRoom: db.deleteAgentRoom.bind(db),
    ensureRoomForHostSession: db.ensureAgentRoomForHostSession.bind(db),
    getDetail,
    listRooms,
    respondInteraction,
    updateRoomMetadata,
    upsertMember,
    upsertRun
  }
}
