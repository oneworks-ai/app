import type { AgentRoom, AgentRoomMember, ChannelExecutionContext } from '@oneworks/core'

import { getDb } from '#~/db/index.js'

type AgentRoomDb = ReturnType<typeof getDb>

export const AGENT_ROOM_EXTERNAL_DELEGATION_MARKER = 'agentRoomExternalDelegation'
export const AGENT_ROOM_EXTERNAL_DELEGATION_TTL_MS = 10 * 60 * 1_000

interface ExternalDeliveryInput {
  actor?: {
    canonicalUserId?: string
    displayName?: string
    externalAccountId?: string
  }
  channelId: string
  channelKey: string
  channelType: string
  messageId: string
  replyReceiveId: string
  replyReceiveIdType: string
  senderId?: string
  sessionType: string
  threadId?: string
}

export interface AgentRoomExternalDelegation {
  memberKey: string
  memberLabel: string
  operationId: string
}

const readString = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

export const createPendingAgentRoomExternalDelegation = (
  input: {
    executionContext: ChannelExecutionContext
    external: ExternalDeliveryInput
    hostSessionId: string
    member: AgentRoomMember
    room: AgentRoom
  },
  db: AgentRoomDb = getDb()
): AgentRoomExternalDelegation => {
  const childRun = db.createChannelChildSessionRun({
    actorAccountId: input.external.actor?.externalAccountId ?? input.external.senderId,
    actorUserId: input.external.actor?.canonicalUserId,
    channelId: input.external.channelId,
    channelKey: input.external.channelKey,
    channelLinkName: input.executionContext.source.channelLinkName,
    channelType: input.external.channelType,
    dispatchMode: 'create_session',
    entity: input.member.key,
    messageId: input.external.messageId,
    metadata: {
      [AGENT_ROOM_EXTERNAL_DELEGATION_MARKER]: {
        hostSessionId: input.hostSessionId,
        memberKey: input.member.key,
        replyReceiveId: input.external.replyReceiveId,
        replyReceiveIdType: input.external.replyReceiveIdType,
        roomId: input.room.id,
        ...(input.external.threadId == null ? {} : { threadId: input.external.threadId })
      },
      executionContext: input.executionContext
    },
    senderId: input.external.senderId,
    sessionType: input.external.sessionType,
    status: 'started',
    threadKey: `room:${input.room.id}:${input.member.key}`,
    triggerType: 'message'
  })
  if (childRun == null) throw new Error('Failed to create Agent Room external delegation.')
  return {
    memberKey: input.member.key,
    memberLabel: input.member.label,
    operationId: childRun.id
  }
}

export const finishPendingAgentRoomExternalDelegations = (
  delegations: AgentRoomExternalDelegation[],
  error: string,
  db: AgentRoomDb = getDb()
) => {
  for (const delegation of delegations) {
    const run = db.getChannelChildSessionRun(delegation.operationId)
    if (run?.status !== 'started' || run.sessionId != null) continue
    db.finishChannelChildSessionRun(run.id, { error, status: 'failed' })
  }
}

export const expirePendingAgentRoomExternalDelegations = (
  now = Date.now(),
  db: AgentRoomDb = getDb()
) =>
  db.expirePendingChannelChildSessionDelegations({
    beforeStartedAt: now - AGENT_ROOM_EXTERNAL_DELEGATION_TTL_MS,
    completedAt: now,
    markerKey: AGENT_ROOM_EXTERNAL_DELEGATION_MARKER
  })

export const failClaimedAgentRoomExternalDelegation = (
  input: { error: unknown; operationId?: string; sessionId: string },
  db: AgentRoomDb = getDb()
) => {
  const operationId = readString(input.operationId)
  if (operationId == null) return
  const run = db.getChannelChildSessionRun(operationId)
  if (
    run?.sessionId !== input.sessionId ||
    !['dispatched', 'running'].includes(run.status)
  ) return
  db.finishChannelChildSessionRun(run.id, {
    error: input.error instanceof Error ? input.error.message : String(input.error),
    sessionId: input.sessionId,
    status: 'failed'
  })
}
