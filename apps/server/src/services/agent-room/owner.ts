import type {
  AgentRoomCommand,
  AgentRoomDetail,
  AgentRoomEvent,
  AgentRoomMessage,
  AgentRoomMessageOrigin,
  AgentRoomUserMessageTarget
} from '@oneworks/core'

import { getDb } from '#~/db/index.js'
import type { ResolvedAgentRoomChannelConnection } from './channel-link.js'
import { executeAgentRoomChannelCommand } from './owner-channel-commands.js'
import { publishAgentRoomShareChanged } from './share-events.js'

export interface AgentRoomOwnerDependencies {
  appendUserMessage?: (
    roomId: string,
    content: string,
    target: AgentRoomUserMessageTarget | undefined,
    options: { idempotencyKey: string; origin?: AgentRoomMessageOrigin }
  ) => Promise<AgentRoomMessage>
  applyEvent?: (
    roomId: string,
    event: AgentRoomEvent,
    options: { idempotencyKey: string }
  ) => AgentRoomMessage
  db?: ReturnType<typeof getDb>
  resolveChannelConnection?: (
    channelLinkName: string
  ) => Promise<ResolvedAgentRoomChannelConnection>
}

export interface AgentRoomOwner {
  execute: (
    roomId: string,
    command: AgentRoomCommand,
    options?: {
      bindOwner?: { accountId: string; nodeId: string; sourceId: string }
    }
  ) => Promise<unknown>
  getSnapshot: (roomId: string) => AgentRoomDetail | undefined
}
const assertRoom = (db: ReturnType<typeof getDb>, roomId: string) => {
  const room = db.getAgentRoom(roomId)
  if (room == null) throw new Error(`Agent room not found: ${roomId}`)
  return room
}
export const createAgentRoomOwner = (dependencies: AgentRoomOwnerDependencies): AgentRoomOwner => {
  const db = dependencies.db ?? getDb()
  return {
    getSnapshot: roomId => db.getAgentRoomDetail(roomId),
    execute: async (roomId, command, options) => {
      assertRoom(db, roomId)
      const existing = db.getAgentRoomEventByIdempotencyKey(roomId, command.idempotencyKey)
      if (existing != null) return existing.payload

      if (command.type === 'ingest_channel_message') {
        const message = db.appendAgentRoomMessage({
          content: command.message.content,
          idempotencyKey: command.idempotencyKey,
          ...(command.message.memberKey != null ? { memberKey: command.message.memberKey } : {}),
          origin: command.message.origin,
          role: 'user',
          roomId
        })
        db.appendAgentRoomEvent({
          idempotencyKey: command.idempotencyKey,
          payload: message,
          roomId,
          type: command.type
        })
        return message
      }
      if (command.type === 'append_message') {
        if (dependencies.appendUserMessage == null) {
          throw new Error('Agent room owner does not support local message delivery')
        }
        const message = await dependencies.appendUserMessage(
          roomId,
          command.message.content,
          command.message.target,
          {
            idempotencyKey: command.idempotencyKey,
            ...(command.message.origin != null ? { origin: command.message.origin } : {})
          }
        )
        db.appendAgentRoomEvent({
          idempotencyKey: command.idempotencyKey,
          payload: message,
          roomId,
          type: command.type
        })
        return message
      }
      if (command.type === 'attach_member_channel' || command.type === 'update_member_channel') {
        return await executeAgentRoomChannelCommand(db, dependencies, roomId, command)
      }
      if (command.type === 'record_delivery') {
        const delivery = db.saveAgentRoomMessageDelivery(command.delivery)
        db.appendAgentRoomEvent({
          idempotencyKey: command.idempotencyKey,
          payload: delivery,
          roomId,
          type: command.type
        })
        return delivery
      }
      if (command.type === 'record_channel_delivery') {
        const message = db.appendAgentRoomMessage({
          content: command.delivery.content,
          idempotencyKey: command.idempotencyKey,
          ...(command.delivery.memberKey != null ? { memberKey: command.delivery.memberKey } : {}),
          role: 'agent',
          roomId
        })
        const delivery = db.saveAgentRoomMessageDelivery({
          ...(command.delivery.error != null ? { error: command.delivery.error } : {}),
          id: command.idempotencyKey,
          ...(command.delivery.navigation != null ? { navigation: command.delivery.navigation } : {}),
          ...(command.delivery.providerMessageId != null
            ? { providerMessageId: command.delivery.providerMessageId }
            : {}),
          roomMessageId: message.id,
          ...(command.delivery.status === 'sent' ? { sentAt: Date.now() } : {}),
          status: command.delivery.status,
          target: command.delivery.target
        })
        const result = { delivery, message }
        db.appendAgentRoomEvent({
          idempotencyKey: command.idempotencyKey,
          payload: result,
          roomId,
          type: command.type
        })
        return result
      }
      if (command.type === 'create_share') {
        const share = options?.bindOwner == null
          ? db.createAgentRoomShare({
            grants: command.share.grants,
            id: command.idempotencyKey,
            roomId
          })
          : db.createAgentRoomShareWithOwner({
            event: { idempotencyKey: command.idempotencyKey, type: command.type },
            grants: command.share.grants,
            id: command.idempotencyKey,
            owner: options.bindOwner,
            roomId
          })
        if (options?.bindOwner == null) {
          db.appendAgentRoomEvent({
            idempotencyKey: command.idempotencyKey,
            payload: share,
            roomId,
            type: command.type
          })
        }
        publishAgentRoomShareChanged(roomId)
        return share
      }
      if (command.type === 'revoke_share') {
        const revoked = db.revokeAgentRoomShare(roomId, command.shareId)
        const result = { revoked, shareId: command.shareId }
        db.appendAgentRoomEvent({
          idempotencyKey: command.idempotencyKey,
          payload: result,
          roomId,
          type: command.type
        })
        if (revoked) publishAgentRoomShareChanged(roomId)
        return result
      }
      if (dependencies.applyEvent == null) {
        throw new Error('Agent room owner does not support runtime events')
      }
      const message = dependencies.applyEvent(roomId, command.event, {
        idempotencyKey: command.idempotencyKey
      })
      db.appendAgentRoomEvent({
        id: command.event.id,
        idempotencyKey: command.idempotencyKey,
        payload: message,
        roomId,
        type: command.type
      })
      return message
    }
  }
}
