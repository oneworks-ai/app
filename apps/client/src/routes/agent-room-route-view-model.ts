import dayjs from 'dayjs'

/* eslint-disable max-lines */

import type {
  AgentRoomDetailResponse,
  AgentRoomEventRequestKind,
  AgentRoomEventType,
  AgentRoomInteractionRequestStatus,
  AgentRoomMemberStatus,
  AgentRoomMessage,
  AgentRoomMessageReaction,
  AgentRoomStatus,
  AgentRoomUserMessagePayload,
  AgentRoomUserMessageTarget
} from '@oneworks/core'

import type {
  AgentRoomApprovalBatchActionView,
  AgentRoomApprovalBatchItemView,
  AgentRoomApprovalBatchView,
  AgentRoomInteractionRequestView,
  AgentRoomMemberView,
  AgentRoomMessageKind,
  AgentRoomMessageReactionKind,
  AgentRoomMessageReactionView,
  AgentRoomMessageSource,
  AgentRoomRunView,
  AgentRoomStatus as AgentRoomViewStatus,
  AgentRoomViewModel
} from '#~/components/agent-room'

const eventKindByType: Record<AgentRoomEventType, AgentRoomMessageKind> = {
  assignment_sent: 'assignment',
  attention_requested: 'attention',
  member_joined: 'system',
  run_completed: 'completion',
  run_failed: 'failure',
  run_replied: 'reply',
  run_resumed: 'reply',
  run_stopped: 'failure'
}

const visibleTimelineEventTypes = new Set<AgentRoomEventType>([
  'assignment_sent',
  'attention_requested',
  'member_joined',
  'run_completed',
  'run_failed',
  'run_stopped'
])

const getLeaderMemberKey = (detail: AgentRoomDetailResponse) => (
  detail.room.hostSessionId == null || detail.room.hostSessionId === ''
    ? `host:${detail.room.id}`
    : `host:${detail.room.hostSessionId}`
)

const isLeaderMemberKey = (memberKey: string | undefined) => memberKey === 'host' || memberKey?.startsWith('host:')

const formatTime = (timestamp: number | undefined) => (
  timestamp == null ? undefined : dayjs(timestamp).format('HH:mm')
)

const mapRoomStatus = (
  status: AgentRoomStatus,
  members: AgentRoomMemberView[]
): AgentRoomViewStatus => {
  if (members.some(member => member.pendingCount > 0 || member.status === 'waiting')) {
    return 'waiting'
  }
  return status
}

const mapMemberStatus = (status: AgentRoomMemberStatus): AgentRoomMemberView['status'] => {
  if (status === 'waiting') return 'waiting'
  if (status === 'active') return 'active'
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'stopped') return 'stopped'
  return 'idle'
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const getMessageKind = (message: AgentRoomMessage): AgentRoomMessageKind => {
  if (message.eventType != null) return eventKindByType[message.eventType]
  return message.role === 'system' ? 'system' : 'message'
}

const isProjectedChildSessionMessage = (message: AgentRoomMessage) => {
  const payload = message.payload as unknown
  return message.role === 'agent' && isRecord(payload) && payload.source === 'child_session_message'
}

const shouldShowTimelineMessage = (message: AgentRoomMessage) => {
  if (message.eventType != null) {
    return visibleTimelineEventTypes.has(message.eventType)
  }
  if (message.role === 'agent' && isLeaderMemberKey(message.memberKey)) {
    return true
  }
  if (isProjectedChildSessionMessage(message)) {
    return true
  }
  return message.role === 'user' || message.role === 'system'
}

type UserMessagePayloadWithTarget = AgentRoomUserMessagePayload & {
  target: NonNullable<AgentRoomUserMessagePayload['target']>
}

interface AttentionMessagePayload {
  interactionId?: unknown
  options?: unknown
  requestKind?: unknown
  type?: unknown
}

interface HostInteractionRequestPayload extends AttentionMessagePayload {
  source: 'host_session_interaction_request'
  permissionContext?: unknown
  response?: unknown
  sessionId?: unknown
  status?: unknown
}

interface ReactionFallback {
  target?: AgentRoomUserMessageTarget
  isHost?: boolean
  isCompleted?: boolean
}

interface ApprovalBatchGroup {
  key: string
  requests: AgentRoomMessage[]
  actions: AgentRoomMessage[]
}

const isPayloadWithTarget = (value: unknown): value is UserMessagePayloadWithTarget => (
  isRecord(value) && isRecord(value.target)
)

const isReactionPayload = (value: unknown): value is AgentRoomMessageReaction => (
  isRecord(value) && (value.kind === 'completed' || value.kind === 'working')
)

const isMessageRole = (value: unknown): value is AgentRoomMessage['role'] => (
  value === 'user' || value === 'agent' || value === 'system'
)

const getPayloadReplyTo = (payload: unknown): AgentRoomMessageSource['replyTo'] => {
  if (!isRecord(payload) || !isRecord(payload.replyTo)) {
    return undefined
  }

  const { replyTo } = payload
  if (
    typeof replyTo.id !== 'string' ||
    replyTo.id.trim() === '' ||
    !isMessageRole(replyTo.role) ||
    typeof replyTo.content !== 'string' ||
    replyTo.content.trim() === ''
  ) {
    return undefined
  }

  const authorLabel = typeof replyTo.authorLabel === 'string' && replyTo.authorLabel.trim() !== ''
    ? replyTo.authorLabel.trim()
    : undefined

  return {
    id: replyTo.id.trim(),
    role: replyTo.role,
    content: replyTo.content.trim(),
    ...(authorLabel != null ? { authorLabel } : {})
  }
}

const getPayloadTarget = (payload: unknown): AgentRoomUserMessageTarget | undefined => {
  if (!isPayloadWithTarget(payload)) {
    return undefined
  }

  const memberKey = typeof payload.target.memberKey === 'string' && payload.target.memberKey.trim() !== ''
    ? payload.target.memberKey
    : undefined
  const runKey = typeof payload.target.runKey === 'string' && payload.target.runKey.trim() !== ''
    ? payload.target.runKey
    : undefined
  if (memberKey == null && runKey == null) {
    return undefined
  }

  return {
    ...(memberKey != null ? { memberKey } : {}),
    ...(runKey != null ? { runKey } : {})
  }
}

const getPayloadDeliverySessionId = (payload: unknown) => {
  if (!isRecord(payload) || !isRecord(payload.delivery) || typeof payload.delivery.sessionId !== 'string') {
    return undefined
  }

  const sessionId = payload.delivery.sessionId.trim()
  return sessionId === '' ? undefined : sessionId
}

const getDeliveryReactionFallback = (
  message: AgentRoomMessage,
  payload: unknown,
  detail: AgentRoomDetailResponse,
  runsBySessionId: Map<string, AgentRoomRunView>,
  hostReplyTargetMessageIds: Set<string>
): ReactionFallback | undefined => {
  const deliverySessionId = getPayloadDeliverySessionId(payload)
  if (deliverySessionId == null) {
    return undefined
  }

  if (detail.room.hostSessionId != null && deliverySessionId === detail.room.hostSessionId) {
    return {
      isHost: true,
      isCompleted: hostReplyTargetMessageIds.has(message.id)
    }
  }

  const run = runsBySessionId.get(deliverySessionId)
  return run == null
    ? undefined
    : { target: { memberKey: run.memberKey, runKey: run.runKey } }
}

const getMessageReactionFallback = (
  message: AgentRoomMessage,
  payload: unknown,
  detail: AgentRoomDetailResponse,
  runsBySessionId: Map<string, AgentRoomRunView>,
  hostReplyTargetMessageIds: Set<string>
): ReactionFallback | undefined => {
  const payloadTarget = getPayloadTarget(payload)
  if (payloadTarget != null) {
    return { target: payloadTarget }
  }

  return getDeliveryReactionFallback(message, payload, detail, runsBySessionId, hostReplyTargetMessageIds)
}

const toReactionView = (
  reaction: AgentRoomMessageReaction,
  fallback: ReactionFallback | undefined,
  membersByKey: Map<string, AgentRoomMemberView>,
  runsByKey: Map<string, AgentRoomRunView>
): AgentRoomMessageReactionView => {
  const target = reaction.target ?? fallback?.target
  const run = target?.runKey == null ? undefined : runsByKey.get(target.runKey)
  const memberKey = target?.memberKey ?? run?.memberKey
  const member = memberKey == null ? undefined : membersByKey.get(memberKey)
  const isHost = fallback?.isHost === true && target == null
  const agentLabel = isHost ? 'leader' : member?.label ?? memberKey ?? run?.memberKey
  const kind: AgentRoomMessageReactionKind =
    reaction.kind === 'working' && (run?.status === 'completed' || fallback?.isCompleted === true)
      ? 'completed'
      : reaction.kind

  return {
    kind,
    ...(agentLabel != null ? { agentLabel } : {}),
    ...(isHost ? { isHost: true } : {}),
    ...(run != null ? { run } : {})
  }
}

const getPayloadReactions = (
  payload: unknown,
  fallback: ReactionFallback | undefined,
  membersByKey: Map<string, AgentRoomMemberView>,
  runsByKey: Map<string, AgentRoomRunView>
) => {
  if (!isRecord(payload) || !Array.isArray(payload.reactions)) {
    return []
  }

  return payload.reactions
    .filter(isReactionPayload)
    .map(reaction => toReactionView(reaction, fallback, membersByKey, runsByKey))
}

const getPayloadTargetRunKey = (payload: unknown) => {
  return getPayloadTarget(payload)?.runKey
}

const getLeaderTargetRunKey = (message: AgentRoomMessage) => {
  if (message.role !== 'agent' || !isLeaderMemberKey(message.memberKey)) {
    return undefined
  }

  return getPayloadTargetRunKey(message.payload) ?? message.runKey
}

const getLeaderTarget = (
  message: AgentRoomMessage,
  runsByKey: Map<string, AgentRoomRunView>
): AgentRoomUserMessageTarget | undefined => {
  const runKey = getLeaderTargetRunKey(message)
  if (runKey == null) {
    return undefined
  }

  const payloadTarget = getPayloadTarget(message.payload)
  const run = runsByKey.get(runKey)
  const memberKey = payloadTarget?.memberKey ?? run?.memberKey
  return {
    ...(memberKey != null ? { memberKey } : {}),
    runKey
  }
}

const getPayloadTargetLabel = (
  payload: unknown,
  membersByKey: Map<string, AgentRoomMemberView>,
  runsByKey: Map<string, AgentRoomRunView>
) => {
  if (!isPayloadWithTarget(payload)) {
    return undefined
  }

  const memberKey = typeof payload.target.memberKey === 'string'
    ? payload.target.memberKey
    : undefined
  const runKey = typeof payload.target.runKey === 'string'
    ? payload.target.runKey
    : undefined
  const run = runKey == null ? undefined : runsByKey.get(runKey)
  const member = memberKey == null ? undefined : membersByKey.get(memberKey)

  if (run != null) {
    return `@${member?.label ?? run.memberKey}/${run.title}`
  }
  if (member != null) {
    return `@${member.label}`
  }
  return undefined
}

const getAssignmentTargetLabel = (
  message: AgentRoomMessage,
  membersByKey: Map<string, AgentRoomMemberView>,
  runsByKey: Map<string, AgentRoomRunView>
) => {
  if (message.eventType !== 'assignment_sent' || message.runKey == null) {
    return undefined
  }

  const run = runsByKey.get(message.runKey)
  if (run == null) {
    return undefined
  }

  return membersByKey.get(run.memberKey)?.label ?? run.memberKey
}

const getMessageTargetLabel = (
  message: AgentRoomMessage,
  membersByKey: Map<string, AgentRoomMemberView>,
  runsByKey: Map<string, AgentRoomRunView>
) => (
  isProjectedChildSessionMessage(message)
    ? undefined
    : message.eventType === 'assignment_sent'
    ? getAssignmentTargetLabel(message, membersByKey, runsByKey)
    : getPayloadTargetLabel(message.payload, membersByKey, runsByKey)
)

const getPayloadMemberLabel = (payload: unknown) => {
  if (!isRecord(payload) || !isRecord(payload.member) || typeof payload.member.label !== 'string') {
    return undefined
  }

  const label = payload.member.label.trim()
  return label === '' ? undefined : label
}

const getSystemMessage = (
  message: AgentRoomMessage,
  membersByKey: Map<string, AgentRoomMemberView>
): AgentRoomMessageSource['systemMessage'] => {
  if (message.eventType !== 'member_joined') {
    return undefined
  }

  const memberLabel = getPayloadMemberLabel(message.payload) ??
    (message.memberKey == null ? undefined : membersByKey.get(message.memberKey)?.label ?? message.memberKey)
  return memberLabel == null
    ? undefined
    : {
      kind: 'memberJoined',
      memberLabel
    }
}

const getLatestLeaderWorkingMessageTargets = (
  messages: AgentRoomMessage[],
  runsByKey: Map<string, AgentRoomRunView>
) => {
  const latestByRunKey = new Map<string, { createdAt: number; id: string; target: AgentRoomUserMessageTarget }>()
  for (const message of messages) {
    const target = getLeaderTarget(message, runsByKey)
    const runKey = target?.runKey
    if (target == null || runKey == null || runsByKey.get(runKey)?.status !== 'running') {
      continue
    }

    const existing = latestByRunKey.get(runKey)
    if (existing == null || message.createdAt >= existing.createdAt) {
      latestByRunKey.set(runKey, { createdAt: message.createdAt, id: message.id, target })
    }
  }

  return new Map([...latestByRunKey.values()].map(message => [message.id, message.target]))
}

const getHostReplyTargetMessageIds = (messages: AgentRoomMessage[]) =>
  new Set(
    messages.flatMap(message => {
      if (message.role !== 'agent' || !isLeaderMemberKey(message.memberKey)) {
        return []
      }

      const replyTo = getPayloadReplyTo(message.payload)
      return replyTo == null ? [] : [replyTo.id]
    })
  )

const getMessageReactions = (
  detail: AgentRoomDetailResponse,
  message: AgentRoomMessage,
  membersByKey: Map<string, AgentRoomMemberView>,
  runsByKey: Map<string, AgentRoomRunView>,
  runsBySessionId: Map<string, AgentRoomRunView>,
  hostReplyTargetMessageIds: Set<string>,
  latestLeaderWorkingMessageTargets: Map<string, AgentRoomUserMessageTarget>
) => {
  const fallback = getMessageReactionFallback(
    message,
    message.payload,
    detail,
    runsBySessionId,
    hostReplyTargetMessageIds
  )
  const reactions = getPayloadReactions(message.payload, fallback, membersByKey, runsByKey)
  const leaderTarget = latestLeaderWorkingMessageTargets.get(message.id)
  if (
    leaderTarget != null && !reactions.some(reaction => reaction.kind === 'completed' || reaction.kind === 'working')
  ) {
    reactions.push(toReactionView({ kind: 'working', target: leaderTarget }, undefined, membersByKey, runsByKey))
  }
  return reactions.length > 0 ? reactions : undefined
}

const getAttentionPayload = (message: AgentRoomMessage): AttentionMessagePayload | undefined => (
  message.eventType === 'attention_requested' && isRecord(message.payload) &&
    message.payload.type === 'attention_requested'
    ? message.payload
    : undefined
)

const isAgentRoomEventRequestKind = (value: unknown): value is AgentRoomEventRequestKind => (
  value === 'confirmation' || value === 'input' || value === 'progress'
)

const isInteractionRequestStatus = (value: unknown): value is AgentRoomInteractionRequestStatus => (
  value === 'pending' || value === 'handled' || value === 'expired'
)

const isInteractionResponse = (value: unknown): value is string | string[] => (
  typeof value === 'string' || (Array.isArray(value) && value.every(item => typeof item === 'string'))
)

const getHostInteractionRequestPayload = (message: AgentRoomMessage): HostInteractionRequestPayload | undefined => {
  const payload = message.payload as unknown
  return message.eventType === 'attention_requested' &&
      isRecord(payload) &&
      payload.source === 'host_session_interaction_request' &&
      payload.type === 'attention_requested'
    ? payload as unknown as HostInteractionRequestPayload
    : undefined
}

const getInteractionSubjectLabel = (payload: HostInteractionRequestPayload) => {
  if (!isRecord(payload.permissionContext)) {
    return undefined
  }

  const subjectLabel = typeof payload.permissionContext.subjectLabel === 'string'
    ? payload.permissionContext.subjectLabel.trim()
    : undefined
  if (subjectLabel != null && subjectLabel !== '') {
    return subjectLabel
  }

  const subjectKey = typeof payload.permissionContext.subjectKey === 'string'
    ? payload.permissionContext.subjectKey.trim()
    : undefined
  return subjectKey == null || subjectKey === '' ? undefined : subjectKey
}

const getInteractionRequestOptions = (
  payload: HostInteractionRequestPayload
): AgentRoomInteractionRequestView['options'] => {
  if (!Array.isArray(payload.options)) {
    return []
  }

  return payload.options.flatMap(option => {
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
}

const getInteractionRequestView = (message: AgentRoomMessage): AgentRoomInteractionRequestView | undefined => {
  const payload = getHostInteractionRequestPayload(message)
  if (
    payload == null ||
    typeof payload.sessionId !== 'string' ||
    payload.sessionId.trim() === '' ||
    typeof payload.interactionId !== 'string' ||
    payload.interactionId.trim() === '' ||
    !isAgentRoomEventRequestKind(payload.requestKind) ||
    !isInteractionRequestStatus(payload.status)
  ) {
    return undefined
  }

  const subjectLabel = getInteractionSubjectLabel(payload)
  return {
    sessionId: payload.sessionId.trim(),
    interactionId: payload.interactionId.trim(),
    requestKind: payload.requestKind,
    status: payload.status,
    options: getInteractionRequestOptions(payload),
    ...(isInteractionResponse(payload.response) ? { response: payload.response } : {}),
    ...(subjectLabel != null ? { subjectLabel } : {})
  }
}

const getApprovalBatchKey = (message: AgentRoomMessage) => {
  const payload = getAttentionPayload(message)
  if (payload?.requestKind !== 'confirmation' || message.memberKey == null || message.runKey == null) {
    return undefined
  }

  return `${message.memberKey}:${message.runKey}`
}

const isApprovalActionContent = (content: string) => (
  /已代为批准|批准|放行|同意|approved|allow_once|allow_session|allow_project|codex-approval/i.test(content)
)

const getApprovalBatchActionKey = (
  message: AgentRoomMessage,
  runsByKey: Map<string, AgentRoomRunView>
) => {
  if (
    message.eventType != null ||
    message.role !== 'agent' ||
    !isLeaderMemberKey(message.memberKey) ||
    !isApprovalActionContent(message.content)
  ) {
    return undefined
  }

  const target = getLeaderTarget(message, runsByKey)
  const runKey = target?.runKey
  if (target == null || runKey == null) {
    return undefined
  }

  const memberKey = target.memberKey ?? runsByKey.get(runKey)?.memberKey
  return memberKey == null ? undefined : `${memberKey}:${runKey}`
}

const getInteractionId = (message: AgentRoomMessage) => {
  const interactionId = getAttentionPayload(message)?.interactionId
  return typeof interactionId === 'string' && interactionId.trim() !== '' ? interactionId : undefined
}

const getOptionLabels = (message: AgentRoomMessage) => {
  const options = getAttentionPayload(message)?.options
  if (!Array.isArray(options)) {
    return []
  }

  return options.flatMap(option => {
    if (!isRecord(option) || typeof option.label !== 'string' || option.label.trim() === '') {
      return []
    }

    const value = typeof option.value === 'string' && option.value.trim() !== ''
      ? ` (${option.value})`
      : ''
    return [`${option.label}${value}`]
  })
}

const buildApprovalBatchGroups = (
  messages: AgentRoomMessage[],
  runsByKey: Map<string, AgentRoomRunView>
) => {
  const groups = new Map<string, ApprovalBatchGroup>()
  for (const message of messages) {
    const key = getApprovalBatchKey(message)
    if (key == null) {
      continue
    }

    const group = groups.get(key) ?? { key, requests: [], actions: [] }
    group.requests.push(message)
    groups.set(key, group)
  }

  for (const message of messages) {
    const key = getApprovalBatchActionKey(message, runsByKey)
    if (key == null) {
      continue
    }

    const group = groups.get(key)
    if (group == null) {
      continue
    }

    group.actions.push(message)
  }

  return [...groups.values()].filter(group => group.requests.length > 1 || group.actions.length > 0)
}

const getPendingApprovalItemId = (
  group: AgentRoomMessage[],
  runsByKey: Map<string, AgentRoomRunView>
) => {
  const latest = group.at(-1)
  if (latest?.runKey == null) {
    return undefined
  }

  const run = runsByKey.get(latest.runKey)
  if (run?.status !== 'waiting') {
    return undefined
  }

  const runInteractionId = run.interactionId
  const latestInteractionId = getInteractionId(latest)
  if (runInteractionId != null && latestInteractionId !== runInteractionId) {
    return undefined
  }

  return latest.id
}

const toApprovalBatchItem = (
  message: AgentRoomMessage,
  pendingItemId: string | undefined
): AgentRoomApprovalBatchItemView => ({
  id: message.id,
  content: message.content,
  createdAtLabel: formatTime(message.createdAt),
  interactionId: getInteractionId(message),
  status: message.id === pendingItemId ? 'pending' : 'handled',
  optionLabels: getOptionLabels(message)
})

const getApprovalActionInteractionIds = (
  message: AgentRoomMessage
) => [...new Set(message.content.match(/codex-approval:\d+/g) ?? [])]

const toApprovalBatchAction = (message: AgentRoomMessage): AgentRoomApprovalBatchActionView => ({
  id: message.id,
  content: message.content,
  createdAtLabel: formatTime(message.createdAt),
  interactionIds: getApprovalActionInteractionIds(message)
})

const toMessageSource = (
  detail: AgentRoomDetailResponse,
  message: AgentRoomMessage,
  membersByKey: Map<string, AgentRoomMemberView>,
  runsByKey: Map<string, AgentRoomRunView>,
  runsBySessionId: Map<string, AgentRoomRunView>,
  hostReplyTargetMessageIds: Set<string>,
  latestLeaderWorkingMessageTargets: Map<string, AgentRoomUserMessageTarget>
): AgentRoomMessageSource => ({
  id: message.id,
  role: message.role,
  kind: getMessageKind(message),
  content: message.content,
  memberKey: message.eventType === 'assignment_sent' ? getLeaderMemberKey(detail) : message.memberKey,
  runKey: message.runKey,
  createdAtLabel: formatTime(message.createdAt),
  replyTo: getPayloadReplyTo(message.payload),
  systemMessage: getSystemMessage(message, membersByKey),
  reactions: getMessageReactions(
    detail,
    message,
    membersByKey,
    runsByKey,
    runsBySessionId,
    hostReplyTargetMessageIds,
    latestLeaderWorkingMessageTargets
  ),
  targetLabel: getMessageTargetLabel(message, membersByKey, runsByKey),
  interactionRequest: getInteractionRequestView(message)
})

const toApprovalBatchSource = (
  group: ApprovalBatchGroup,
  membersByKey: Map<string, AgentRoomMemberView>,
  runsByKey: Map<string, AgentRoomRunView>
): AgentRoomMessageSource => {
  const latestRequest = group.requests.at(-1)
  if (latestRequest == null) {
    throw new Error('Cannot build empty approval batch.')
  }

  const latestActivity = [...group.requests, ...group.actions].reduce(
    (latest, message) => message.createdAt >= latest.createdAt ? message : latest,
    latestRequest
  )
  const pendingItemId = getPendingApprovalItemId(group.requests, runsByKey)
  const items = group.requests.map(message => toApprovalBatchItem(message, pendingItemId))
  const actions = group.actions.map(toApprovalBatchAction)
  const pendingCount = items.filter(item => item.status === 'pending').length
  const latestItem = items.find(item => item.status === 'pending') ?? items.at(-1)
  if (latestItem == null) {
    throw new Error('Cannot build approval batch without items.')
  }

  const member = latestRequest.memberKey == null ? undefined : membersByKey.get(latestRequest.memberKey)
  const run = latestRequest.runKey == null ? undefined : runsByKey.get(latestRequest.runKey)
  const memberLabel = member?.label ?? latestRequest.memberKey ?? 'Agent'
  const runTitle = run?.title ?? latestRequest.runKey ?? ''
  const approvalBatch: AgentRoomApprovalBatchView = {
    totalCount: items.length,
    pendingCount,
    handledCount: items.length - pendingCount,
    actionCount: actions.length,
    memberLabel,
    runTitle,
    latest: latestItem,
    items,
    actions
  }

  return {
    id: `approval-batch:${latestActivity.id}`,
    role: 'agent',
    kind: pendingCount > 0 ? 'attention' : 'message',
    content: `${memberLabel} approval queue`,
    memberKey: latestRequest.memberKey,
    runKey: latestRequest.runKey,
    createdAtLabel: formatTime(latestActivity.createdAt),
    approvalBatch
  }
}

export function buildAgentRoomRouteViewModel(detail: AgentRoomDetailResponse): AgentRoomViewModel {
  const runsByMemberKey = new Map<string, AgentRoomRunView[]>()
  for (const run of detail.runs) {
    const runView: AgentRoomRunView = {
      runKey: run.key,
      memberKey: run.memberKey,
      sessionId: run.sessionId,
      title: run.title,
      status: run.status,
      latestSummary: run.latestSummary,
      interactionId: run.interactionId,
      pendingCount: run.status === 'waiting' ? 1 : undefined,
      updatedAtLabel: formatTime(run.updatedAt)
    }
    const runs = runsByMemberKey.get(run.memberKey) ?? []
    runs.push(runView)
    runsByMemberKey.set(run.memberKey, runs)
  }

  const members: AgentRoomMemberView[] = detail.members.map(member => ({
    memberKey: member.key,
    kind: member.kind,
    label: member.label,
    subtitle: member.subtitle,
    avatarLabel: member.avatar,
    status: mapMemberStatus(member.status),
    pendingCount: member.pendingCount,
    activeRunCount: member.activeRunCount,
    latestSummary: member.latestSummary,
    runs: runsByMemberKey.get(member.key) ?? []
  }))

  const membersByKey = new Map(members.map(member => [member.memberKey, member]))
  const runsByKey = new Map(
    members.flatMap(member => member.runs.map(run => [run.runKey, run] as const))
  )
  const runsBySessionId = new Map(
    members.flatMap(member => member.runs.map(run => [run.sessionId, run] as const))
  )
  const hostReplyTargetMessageIds = getHostReplyTargetMessageIds(detail.messages)
  const latestLeaderWorkingMessageTargets = getLatestLeaderWorkingMessageTargets(detail.messages, runsByKey)
  const visibleMessages = detail.messages.filter(shouldShowTimelineMessage)
  const approvalBatchGroups = buildApprovalBatchGroups(visibleMessages, runsByKey)
  const approvalBatchMessageIds = new Set(
    approvalBatchGroups.flatMap(group => [...group.requests, ...group.actions].map(message => message.id))
  )
  const approvalBatchByAnchorMessageId = new Map(
    approvalBatchGroups.flatMap(group => {
      const latestRequest = group.requests.at(-1)
      if (latestRequest == null) {
        return []
      }

      const latestActivity = [...group.requests, ...group.actions].reduce(
        (latest, message) => message.createdAt >= latest.createdAt ? message : latest,
        latestRequest
      )
      return [[latestActivity.id, group] as const]
    })
  )

  const messages: AgentRoomMessageSource[] = visibleMessages.flatMap(message => {
    const approvalBatch = approvalBatchByAnchorMessageId.get(message.id)
    if (approvalBatch != null) {
      return [toApprovalBatchSource(approvalBatch, membersByKey, runsByKey)]
    }
    if (approvalBatchMessageIds.has(message.id)) {
      return []
    }
    return [toMessageSource(
      detail,
      message,
      membersByKey,
      runsByKey,
      runsBySessionId,
      hostReplyTargetMessageIds,
      latestLeaderWorkingMessageTargets
    )]
  })

  return {
    id: detail.room.id,
    title: detail.room.title,
    subtitle: detail.room.lastMessage,
    status: mapRoomStatus(detail.room.status, members),
    members,
    messages,
    updatedAtLabel: formatTime(detail.room.updatedAt)
  }
}
