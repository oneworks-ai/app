import type { AgentRoomChannelConnection, AgentRoomMessageOrigin } from '@oneworks/core'
import type { ChannelInboundEvent } from '@oneworks/core/channel'

import { createAgentRoomService } from '#~/services/agent-room/index.js'
import { publishClientEvent } from '#~/services/client-events.js'

import { resolveAgentRoomConnectionsForInbound } from './agent-room-bridge-connections'
import type { ChannelContext } from './middleware/@types'
import type { ChannelRuntimeState } from './types'

const trimNonEmpty = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

export const shouldProcessAgentRoomChannelMessage = (
  connection: AgentRoomChannelConnection,
  inbound: ChannelInboundEvent,
  content: string
) => {
  if (connection.status !== 'active' || connection.muted) return false
  if (connection.requireMention && inbound.mentionedBot !== true) return false
  if (connection.commandPrefix != null && !content.trimStart().startsWith(connection.commandPrefix)) return false
  return true
}

const defaultReceiveIdType = (channelType: string) => {
  if (channelType === 'lark') return 'chat_id'
  if (channelType === 'wechat') return 'chatroom'
  return 'room'
}

const publishRoomUpdated = (roomId: string) => {
  publishClientEvent('agent-rooms', { roomId, type: 'agent_room_updated' })
}

export const bridgeInboundGroupMessageToAgentRooms = async (input: {
  ctx: Pick<ChannelContext, 'actor' | 'channelKey' | 'config' | 'inbound'>
  states: Iterable<ChannelRuntimeState>
}) => {
  const { ctx } = input
  const inbound = ctx.inbound
  if (
    inbound.channelType === 'oneworks' ||
    inbound.sessionType !== 'group' ||
    trimNonEmpty(inbound.messageId) == null
  ) return false

  const connections = await resolveAgentRoomConnectionsForInbound({
    inbound,
    states: input.states
  })
  if (connections.length === 0) return false

  const content = trimNonEmpty(inbound.displayText) ?? trimNonEmpty(inbound.text) ?? '[消息]'
  const rooms = new Map<string, typeof connections>()
  for (const connection of connections) {
    const list = rooms.get(connection.roomId) ?? []
    list.push(connection)
    rooms.set(connection.roomId, list)
  }

  const service = createAgentRoomService()
  let handledRoomCount = 0
  let belongsToConnectedRoom = false
  for (const [roomId, roomConnections] of rooms) {
    const sourceConnections = roomConnections.filter(connection => connection.channelKey === ctx.channelKey)
    if (sourceConnections.length > 0) {
      belongsToConnectedRoom = true
    }
    const sourceConnection = sourceConnections.find(connection => connection.status === 'active')
    if (sourceConnection == null) continue
    const activeConnections = sourceConnections.filter(connection =>
      shouldProcessAgentRoomChannelMessage(connection, inbound, content)
    )
    const origin: AgentRoomMessageOrigin = {
      ...(sourceConnection.accountLabel == null ? {} : { accountLabel: sourceConnection.accountLabel }),
      channelId: inbound.channelId,
      channelKey: sourceConnection.channelKey,
      channelLinkName: sourceConnection.channelLinkName,
      channelType: inbound.channelType,
      conversationKind: 'group',
      conversationLabel: roomConnections[0]?.label,
      ...(inbound.navigation == null ? {} : { navigation: inbound.navigation }),
      providerMessageId: inbound.messageId!,
      ...(ctx.actor?.user?.displayName == null ? {} : { senderDisplayName: ctx.actor.user.displayName }),
      ...(inbound.senderId == null ? {} : { senderId: inbound.senderId }),
      ...(inbound.threadId == null ? {} : { threadId: inbound.threadId })
    }
    await service.ingestExternalMessage(roomId, content, origin, {
      actor: {
        ...(ctx.actor?.user?.id == null ? {} : { canonicalUserId: ctx.actor.user.id }),
        ...(ctx.actor?.user?.displayName == null ? {} : { displayName: ctx.actor.user.displayName }),
        ...(ctx.actor?.account.accountId == null ? {} : { externalAccountId: ctx.actor.account.accountId })
      },
      channelId: inbound.channelId,
      channelKey: sourceConnection.channelKey,
      channelType: inbound.channelType,
      messageId: inbound.messageId!,
      ...(inbound.navigation == null ? {} : { navigation: inbound.navigation }),
      replyReceiveId: inbound.replyTo?.receiveId ?? inbound.channelId,
      replyReceiveIdType: inbound.replyTo?.receiveIdType ?? defaultReceiveIdType(inbound.channelType),
      ...(inbound.senderId == null ? {} : { senderId: inbound.senderId }),
      sessionType: inbound.sessionType,
      ...(inbound.threadId == null ? {} : { threadId: inbound.threadId })
    }, activeConnections.map(connection => connection.memberKey))
    publishRoomUpdated(roomId)
    handledRoomCount += 1
  }
  return handledRoomCount > 0 || belongsToConnectedRoom
}
