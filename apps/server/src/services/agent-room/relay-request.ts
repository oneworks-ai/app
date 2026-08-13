import { createHash } from 'node:crypto'

import type {
  AgentRoomDetail,
  AgentRoomRun,
  AgentRoomSharePermission,
  AgentRoomUserMessageTarget,
  RelayRoomLiveRequest
} from '@oneworks/types'

export const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

export const text = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized === '' ? undefined : normalized
}

export const requiredPermissions = (action: RelayRoomLiveRequest['action']): AgentRoomSharePermission[] => (
  action === 'target_member' ? ['send', 'target_member'] : [action]
)

const opaqueRef = (namespace: string, roomId: string, value: string) =>
  createHash('sha256').update(`${namespace}:${roomId}:${value}`).digest('hex').slice(0, 20)

const memberRef = (roomId: string, memberKey: string) => opaqueRef('relay-room-member', roomId, memberKey)
const runRef = (roomId: string, runKey: string) => opaqueRef('relay-room-run', roomId, runKey)
const interactionRef = (roomId: string, interactionId: string) =>
  opaqueRef('relay-room-interaction', roomId, interactionId)

export const resolveRelayRoomRun = (detail: AgentRoomDetail, value: unknown): AgentRoomRun | undefined => {
  const ref = text(value)
  return ref == null ? undefined : detail.runs.find(run => runRef(detail.room.id, run.key) === ref)
}

export const resolveRelayRoomInteraction = (detail: AgentRoomDetail, value: unknown): string | undefined => {
  const ref = text(value)
  if (ref == null) return undefined
  return detail.runs.find(run => run.interactionId != null && interactionRef(detail.room.id, run.interactionId) === ref)
    ?.interactionId
}

const sanitizeRun = (roomId: string, run: AgentRoomRun) => ({
  createdAt: run.createdAt,
  ...(run.interactionId == null ? {} : { interactionRef: interactionRef(roomId, run.interactionId) }),
  latestSummary: run.latestSummary,
  memberRef: memberRef(roomId, run.memberKey),
  runRef: runRef(roomId, run.key),
  status: run.status,
  title: run.title,
  updatedAt: run.updatedAt
})

export const sanitizeDetail = (detail: AgentRoomDetail) => ({
  channelLinks: detail.channelConnections.map(link => ({
    accountLabel: link.accountLabel,
    channelRef: opaqueRef(
      'relay-room-channel',
      detail.room.id,
      `${link.channelType}:${link.channelKey}:${link.channelId}`
    ),
    channelType: link.channelType,
    conversationKind: link.conversationKind,
    entity: link.entity,
    label: link.label
  })),
  members: detail.members.map(member => ({
    activeRunCount: member.activeRunCount,
    avatar: member.avatar,
    kind: member.kind,
    label: member.label,
    latestSummary: member.latestSummary,
    memberRef: memberRef(detail.room.id, member.key),
    pendingCount: member.pendingCount,
    status: member.status,
    subtitle: member.subtitle
  })),
  messages: detail.messages.map(message => ({
    content: message.content,
    createdAt: message.createdAt,
    deliveries: message.deliveries.map(delivery => ({
      ...(delivery.error == null ? {} : { error: 'Delivery failed.' }),
      status: delivery.status,
      target: {
        accountLabel: delivery.target.accountLabel,
        channelType: delivery.target.channelType,
        conversationKind: delivery.target.conversationKind,
        label: delivery.target.label
      }
    })),
    eventType: message.eventType,
    messageRef: opaqueRef('relay-room-message', detail.room.id, message.id),
    ...(message.memberKey == null ? {} : { memberRef: memberRef(detail.room.id, message.memberKey) }),
    ...(message.origin == null
      ? {}
      : {
        origin: {
          accountLabel: message.origin.accountLabel,
          channelType: message.origin.channelType,
          conversationKind: message.origin.conversationKind,
          conversationLabel: message.origin.conversationLabel
        }
      }),
    role: message.role,
    ...(message.runKey == null ? {} : { runRef: runRef(detail.room.id, message.runKey) }),
    sequence: message.sequence
  })),
  room: {
    archivedAt: detail.room.archivedAt,
    createdAt: detail.room.createdAt,
    favoritedAt: detail.room.favoritedAt,
    lastMessage: detail.room.lastMessage,
    leaderEntity: detail.room.leaderEntity,
    roomRef: opaqueRef('relay-room', detail.room.id, detail.room.id),
    status: detail.room.status,
    title: detail.room.title,
    updatedAt: detail.room.updatedAt
  },
  runs: detail.runs.map(run => sanitizeRun(detail.room.id, run))
})

export const parseMessageBody = (body: unknown, detail: AgentRoomDetail) => {
  if (!isRecord(body)) throw new Error('Room message body is required.')
  const content = text(body.content)
  if (content == null) throw new Error('Room message content is required.')
  const targetValue = isRecord(body.target) ? body.target : undefined
  const member = targetValue == null
    ? undefined
    : detail.members.find(candidate => memberRef(detail.room.id, candidate.key) === text(targetValue.memberRef))
  const run = targetValue == null ? undefined : resolveRelayRoomRun(detail, targetValue.runRef)
  const target: AgentRoomUserMessageTarget | undefined = targetValue == null
    ? undefined
    : {
      ...(member == null ? {} : { memberKey: member.key }),
      ...(run == null ? {} : { runKey: run.key })
    }
  if (targetValue != null && member == null && run == null) throw new Error('Invalid Room message target.')
  if (member != null && run != null && run.memberKey !== member.key) throw new Error('Invalid Room message target.')
  return { content, target }
}

export const parseGrants = (value: unknown) => {
  if (!Array.isArray(value)) throw new Error('Room share grants are required.')
  const allowed = new Set<AgentRoomSharePermission>([
    'approve',
    'manage_share',
    'open_run',
    'send',
    'target_member',
    'view'
  ])
  return value.map((grant) => {
    if (!isRecord(grant)) throw new Error('Invalid Room share grant.')
    const principalId = text(grant.principalId)
    const principalType = grant.principalType === 'team' || grant.principalType === 'user'
      ? grant.principalType
      : undefined
    const permissions = Array.isArray(grant.permissions)
      ? grant.permissions.filter((permission): permission is AgentRoomSharePermission => (
        typeof permission === 'string' && allowed.has(permission as AgentRoomSharePermission)
      ))
      : []
    if (principalId == null || principalType == null || permissions.length === 0) {
      throw new Error('Invalid Room share grant.')
    }
    return {
      permissions: [...new Set(permissions)],
      principalId,
      principalType: principalType as 'team' | 'user'
    }
  })
}
