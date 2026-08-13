import type {
  AgentRoomChannelConnection,
  AgentRoomMessageOrigin,
  ChannelConversationKind,
  ChannelDeliveryTarget,
  ChannelExecutionContext
} from '@oneworks/core'

import { getDb } from '#~/db/index.js'
import { createAgentRoomOwner } from '#~/services/agent-room/owner.js'

import type { ChannelMiddleware } from '../@types'

const deepFreeze = <Value>(value: Value): Value => {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

const toConversationKind = (sessionType: string, threadId?: string): ChannelConversationKind => {
  if (threadId != null && threadId.trim() !== '') return 'thread'
  if (sessionType === 'direct') return 'direct'
  if (sessionType === 'group') return 'group'
  return sessionType === 'room' ? 'room' : 'unknown'
}

const toRoomDeliveryTarget = (link: AgentRoomChannelConnection): ChannelDeliveryTarget => ({
  ...(link.accountLabel != null ? { accountLabel: link.accountLabel } : {}),
  channelId: link.channelId,
  channelKey: link.channelKey,
  channelLinkName: link.channelLinkName,
  channelType: link.channelType,
  conversationKind: link.conversationKind,
  label: link.label,
  receiveId: link.receiveId,
  receiveIdType: link.receiveIdType,
  ...(link.threadId != null ? { threadId: link.threadId } : {})
})

const deliveryTargetKey = (target: ChannelDeliveryTarget) =>
  [
    target.channelType,
    target.channelKey,
    target.receiveIdType,
    target.receiveId,
    target.threadId ?? ''
  ].join('\u0000')

export const buildChannelExecutionContext = (
  ctx: Parameters<ChannelMiddleware>[0]
): ChannelExecutionContext => {
  const { inbound } = ctx
  const db = getDb()
  const roomConnections = db.findAgentRoomChannelConnections({
    channelId: inbound.channelId,
    channelType: inbound.channelType
  })
  const roomConnection = roomConnections.find(connection =>
    connection.channelKey === ctx.channelKey &&
    (ctx.channelLink?.entity == null || connection.entity === ctx.channelLink.entity)
  ) ?? roomConnections[0]
  const room = roomConnection == null ? undefined : db.getAgentRoom(roomConnection.roomId)
  const conversationKind = toConversationKind(inbound.sessionType, inbound.threadId)
  const defaultReplyTarget = inbound.replyTo == null
    ? undefined
    : {
      ...(ctx.config?.title != null ? { accountLabel: ctx.config.title } : {}),
      channelId: inbound.channelId,
      channelKey: ctx.channelKey,
      ...(ctx.channelLink?.name != null ? { channelLinkName: ctx.channelLink.name } : {}),
      channelType: inbound.channelType,
      conversationKind,
      label: roomConnection?.label ?? ctx.channelLink?.name ?? ctx.config?.title ?? inbound.channelId,
      receiveId: inbound.replyTo.receiveId,
      receiveIdType: inbound.replyTo.receiveIdType,
      ...(inbound.threadId != null ? { threadId: inbound.threadId } : {})
    } satisfies ChannelDeliveryTarget
  const entity = ctx.channelLink?.entity ?? roomConnection?.entity ?? ctx.channelKey
  const roomTargets = room == null
    ? []
    : db.listAgentRoomChannelConnections(room.id)
      .filter(link => link.entity === entity && link.status === 'active')
      .map(toRoomDeliveryTarget)
  const targets = new Map(roomTargets.map(target => [deliveryTargetKey(target), target]))
  if (defaultReplyTarget != null) targets.set(deliveryTargetKey(defaultReplyTarget), defaultReplyTarget)

  return deepFreeze({
    actor: {
      ...(ctx.actor?.user?.id != null ? { canonicalUserId: ctx.actor.user.id } : {}),
      ...(ctx.actor?.user?.displayName != null ? { displayName: ctx.actor.user.displayName } : {}),
      ...(ctx.actor?.account.accountId != null ? { externalAccountId: ctx.actor.account.accountId } : {})
    },
    availableDeliveryTargets: [...targets.values()],
    ...(defaultReplyTarget != null ? { defaultReplyTarget } : {}),
    entity: { id: entity, label: entity },
    ...(room == null
      ? {}
      : {
        room: {
          id: room.id,
          ...(roomConnection?.memberKey != null ? { memberKey: roomConnection.memberKey } : {}),
          ...(room.owner.nodeId != null ? { ownerNodeId: room.owner.nodeId } : {}),
          title: room.title
        }
      }),
    source: {
      ...(ctx.config?.title != null ? { accountLabel: ctx.config.title } : {}),
      channelKey: ctx.channelKey,
      ...(ctx.channelLink?.name != null ? { channelLinkName: ctx.channelLink.name } : {}),
      channelType: inbound.channelType,
      conversation: {
        id: inbound.channelId,
        kind: conversationKind,
        ...(roomConnection?.label != null ? { label: roomConnection.label } : {}),
        ...(inbound.threadId != null ? { threadId: inbound.threadId } : {})
      },
      message: {
        ...(inbound.messageId != null ? { id: inbound.messageId } : {}),
        ...(inbound.replyMessageId != null ? { replyToId: inbound.replyMessageId } : {}),
        ...(inbound.rootMessageId != null ? { rootId: inbound.rootMessageId } : {})
      }
    }
  })
}

export const projectInboundMessageToRoom = async (
  ctx: Parameters<ChannelMiddleware>[0],
  executionContext: ChannelExecutionContext,
  content: string
) => {
  if (executionContext.room == null || ctx.inbound.messageId == null || content.trim() === '') return undefined
  const source = executionContext.source
  const origin: AgentRoomMessageOrigin = {
    ...(source.accountLabel != null ? { accountLabel: source.accountLabel } : {}),
    channelId: source.conversation.id,
    channelKey: source.channelKey,
    ...(source.channelLinkName != null ? { channelLinkName: source.channelLinkName } : {}),
    channelType: source.channelType,
    conversationKind: source.conversation.kind,
    ...(source.conversation.label != null ? { conversationLabel: source.conversation.label } : {}),
    ...(ctx.inbound.navigation != null ? { navigation: ctx.inbound.navigation } : {}),
    providerMessageId: ctx.inbound.messageId,
    ...(source.conversation.threadId != null ? { threadId: source.conversation.threadId } : {})
  }
  return await createAgentRoomOwner({ db: getDb() }).execute(executionContext.room.id, {
    idempotencyKey: `channel:${source.channelType}:${ctx.inbound.channelId}:${ctx.inbound.messageId}`,
    type: 'ingest_channel_message',
    message: {
      content,
      ...(executionContext.actor?.canonicalUserId != null
        ? { memberKey: `user:${executionContext.actor.canonicalUserId}` }
        : {}),
      origin
    }
  })
}
