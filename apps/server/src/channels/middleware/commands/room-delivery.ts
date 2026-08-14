import { randomUUID } from 'node:crypto'

import type { ChannelDeliveryTarget, ChannelNavigationReference } from '@oneworks/types'

import { getDb } from '#~/db/index.js'
import { createAgentRoomOwner } from '#~/services/agent-room/owner.js'

import type { ChannelContext } from '../@types'
import { summarizePayload } from './send-target'
import type { ChannelSendPayload } from './send-target'

export const recordRoomChannelDelivery = async (
  ctx: ChannelContext,
  input: {
    error?: string
    message: ChannelSendPayload
    messageId?: string
    navigation?: ChannelNavigationReference
    operationId?: string
    status: 'failed' | 'sent'
    target: ChannelDeliveryTarget
  }
) => {
  if (ctx.executionContext?.room == null) return

  const db = getDb()
  const memberKey = ctx.executionContext.room.memberKey ?? `entity:${ctx.executionContext.entity.id}`
  const connection = db.findAgentRoomChannelConnections({
    channelId: input.target.channelId,
    channelKey: input.target.channelKey,
    channelType: input.target.channelType
  }).find(candidate =>
    candidate.roomId === ctx.executionContext?.room?.id &&
    (input.target.channelLinkName == null || candidate.channelLinkName === input.target.channelLinkName)
  )
  if (connection != null) {
    db.saveAgentRoomChannelConnection({
      ...connection,
      ...(input.error == null ? { lastError: undefined } : { lastError: input.error }),
      ...(input.status === 'sent' ? { lastSeenAt: Date.now() } : {}),
      status: input.status === 'sent' ? 'active' : 'unavailable',
      updatedAt: Date.now()
    })
  }

  const deliveryId = input.operationId ?? (input.messageId == null
    ? `channel-delivery:${input.status}:${randomUUID()}`
    : `channel-delivery:${input.target.channelType}:${input.target.channelKey}:${input.messageId}`)
  await createAgentRoomOwner({ db }).execute(ctx.executionContext.room.id, {
    delivery: {
      content: summarizePayload(input.message),
      ...(input.error != null ? { error: input.error } : {}),
      memberKey,
      ...(input.messageId != null ? { providerMessageId: input.messageId } : {}),
      ...(input.navigation != null ? { navigation: input.navigation } : {}),
      status: input.status,
      target: input.target
    },
    idempotencyKey: deliveryId,
    type: 'record_channel_delivery'
  })
}
