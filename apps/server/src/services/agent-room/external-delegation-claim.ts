import type { ChannelDeliveryTarget, ChannelExecutionContext } from '@oneworks/core'

import { getDb } from '#~/db/index.js'
import { writeChannelMessageContext } from '#~/services/session/channel-context.js'

import type { RuntimeSessionMetadata } from '../runtime-store/types.js'
import { AGENT_ROOM_EXTERNAL_DELEGATION_MARKER, AGENT_ROOM_EXTERNAL_DELEGATION_TTL_MS } from './external-delegation.js'

type AgentRoomDb = ReturnType<typeof getDb>

interface DelegationMarker {
  hostSessionId: string
  memberKey: string
  replyReceiveId: string
  replyReceiveIdType: string
  roomId: string
  threadId?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const readString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const readMarker = (value: unknown): DelegationMarker | undefined => {
  if (!isRecord(value)) return undefined
  const hostSessionId = readString(value.hostSessionId)
  const memberKey = readString(value.memberKey)
  const replyReceiveId = readString(value.replyReceiveId)
  const replyReceiveIdType = readString(value.replyReceiveIdType)
  const roomId = readString(value.roomId)
  if (
    hostSessionId == null || memberKey == null || replyReceiveId == null ||
    replyReceiveIdType == null || roomId == null
  ) return undefined
  return {
    hostSessionId,
    memberKey,
    replyReceiveId,
    replyReceiveIdType,
    roomId,
    ...(readString(value.threadId) == null ? {} : { threadId: readString(value.threadId) })
  }
}

const toTarget = (
  connection: ReturnType<AgentRoomDb['listAgentRoomChannelConnections']>[number],
  marker: DelegationMarker
) =>
  ({
    ...(connection.accountLabel == null ? {} : { accountLabel: connection.accountLabel }),
    channelId: connection.channelId,
    channelKey: connection.channelKey,
    channelLinkName: connection.channelLinkName,
    channelType: connection.channelType,
    conversationKind: connection.conversationKind,
    label: connection.label,
    receiveId: marker.replyReceiveId,
    receiveIdType: marker.replyReceiveIdType,
    ...(marker.threadId == null ? {} : { threadId: marker.threadId })
  }) satisfies ChannelDeliveryTarget

const isAgentRoomEntityChild = (metadata: RuntimeSessionMetadata) => (
  readString(metadata.roomId) != null &&
  readString(metadata.hostSessionId) != null &&
  readString(metadata.parentSessionId) != null &&
  readString(metadata.memberKey) != null &&
  readString(metadata.entity) != null
)

export const claimAgentRoomExternalDelegation = async (
  input: { metadata: RuntimeSessionMetadata; operationId?: string; now?: number },
  db: AgentRoomDb = getDb(),
  dependencies: { writeContext?: typeof writeChannelMessageContext } = {}
) => {
  const metadataOperationId = readString(input.metadata.operationId)
  const operationId = readString(input.operationId ?? metadataOperationId)
  if (operationId == null) return undefined
  if (isAgentRoomEntityChild(input.metadata) && metadataOperationId !== operationId) {
    throw new Error('Agent Room external delegation does not match the session metadata.')
  }
  const pending = db.getChannelChildSessionRun(operationId)
  const marker = readMarker(pending?.metadata?.[AGENT_ROOM_EXTERNAL_DELEGATION_MARKER])
  if (pending == null || marker == null) {
    if (isAgentRoomEntityChild(input.metadata)) {
      throw new Error('Agent Room external delegation is invalid or unavailable.')
    }
    return undefined
  }

  const sessionId = input.metadata.sessionId
  const isSameSessionReplay = pending.sessionId === sessionId &&
    ['dispatched', 'running'].includes(pending.status)
  const now = input.now ?? Date.now()
  if (!isSameSessionReplay && (pending.status !== 'started' || pending.sessionId != null)) {
    throw new Error('Agent Room external delegation was already claimed.')
  }
  if (!isSameSessionReplay && now - pending.startedAt > AGENT_ROOM_EXTERNAL_DELEGATION_TTL_MS) {
    db.finishChannelChildSessionRun(pending.id, { error: 'Delegation expired before use.', status: 'expired' })
    throw new Error('Agent Room external delegation has expired.')
  }

  const room = db.getAgentRoom(marker.roomId)
  const member = db.getAgentRoomMember(marker.roomId, marker.memberKey)
  if (
    room == null || room.hostSessionId !== marker.hostSessionId ||
    member == null || member.kind !== 'entity' ||
    readString(input.metadata.roomId) !== marker.roomId ||
    readString(input.metadata.hostSessionId) !== marker.hostSessionId ||
    readString(input.metadata.parentSessionId) !== marker.hostSessionId ||
    readString(input.metadata.memberKey) !== marker.memberKey ||
    readString(input.metadata.entity) !== marker.memberKey ||
    pending.entity !== marker.memberKey
  ) throw new Error('Agent Room external delegation target is invalid.')

  const connection = db.listAgentRoomChannelConnectionsForMember(marker.roomId, marker.memberKey).find(candidate =>
    candidate.status === 'active' &&
    candidate.channelKey === pending.channelKey &&
    candidate.channelType === pending.channelType &&
    candidate.channelId === pending.channelId &&
    (pending.channelLinkName == null || candidate.channelLinkName === pending.channelLinkName)
  )
  if (connection == null) throw new Error('Agent Room external delegation connection is unavailable.')

  const target = toTarget(connection, marker)
  const executionContext: ChannelExecutionContext = {
    ...(
      isRecord(pending.metadata?.executionContext) && isRecord(pending.metadata.executionContext.actor)
        ? { actor: pending.metadata.executionContext.actor as ChannelExecutionContext['actor'] }
        : {}
    ),
    availableDeliveryTargets: [target],
    defaultReplyTarget: target,
    entity: { id: member.key, label: member.label },
    room: {
      id: room.id,
      memberKey: member.key,
      ...(room.owner.nodeId == null ? {} : { ownerNodeId: room.owner.nodeId }),
      title: room.title
    },
    source: {
      ...(connection.accountLabel == null ? {} : { accountLabel: connection.accountLabel }),
      channelKey: pending.channelKey,
      ...(pending.channelLinkName == null ? {} : { channelLinkName: pending.channelLinkName }),
      channelType: pending.channelType,
      conversation: {
        id: pending.channelId,
        kind: connection.conversationKind,
        label: connection.label,
        ...(marker.threadId == null ? {} : { threadId: marker.threadId })
      },
      message: { ...(pending.messageId == null ? {} : { id: pending.messageId }) }
    }
  }
  if (!isSameSessionReplay) {
    const claim = db.claimChannelChildSessionDelegation(pending.id, sessionId)
    if (!claim.claimed) throw new Error('Agent Room external delegation was already claimed.')
  }
  const channelContext: Parameters<typeof writeChannelMessageContext>[1] = {
    actorAccountId: pending.actorAccountId ?? pending.senderId ?? undefined,
    actorUserId: pending.actorUserId ?? undefined,
    channelId: pending.channelId,
    channelKey: pending.channelKey,
    channelLinkName: pending.channelLinkName ?? undefined,
    channelType: pending.channelType,
    childRunId: pending.id,
    entity: member.key,
    executionContext,
    messageId: pending.messageId ?? undefined,
    replyReceiveId: marker.replyReceiveId,
    replyReceiveIdType: marker.replyReceiveIdType,
    senderId: pending.senderId ?? undefined,
    sessionType: pending.sessionType,
    threadId: marker.threadId,
    threadKey: pending.threadKey ?? undefined
  }
  try {
    await (dependencies.writeContext ?? writeChannelMessageContext)(sessionId, channelContext)
    db.markChannelChildSessionRunRunning(pending.id)
  } catch (error) {
    db.finishChannelChildSessionRun(pending.id, {
      error: error instanceof Error ? error.message : String(error),
      sessionId,
      status: 'failed'
    })
    throw error
  }
  return { channelContext, run: db.getChannelChildSessionRun(pending.id) }
}
