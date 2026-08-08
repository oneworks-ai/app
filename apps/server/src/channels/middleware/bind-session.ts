import type { ChannelInboundEvent } from '@oneworks/core/channel'

import { getDb } from '#~/db/index.js'

import { setBinding, setPendingUnack } from '../state'
import type { ChannelMiddleware } from './@types'

const isSameChannel = (
  row: {
    channelKey: string
    channelType: string
    sessionType: string
    channelId: string
    threadId?: string
  },
  input: {
    channelKey: string
    channelType: string
    sessionType: string
    channelId: string
    threadId?: string
  }
) => (
  row.channelKey === input.channelKey &&
  row.channelType === input.channelType &&
  row.sessionType === input.sessionType &&
  row.channelId === input.channelId &&
  row.threadId === input.threadId
)

export const bindChannelSession = (input: {
  channelType: string
  sessionType: string
  channelId: string
  threadId?: string
  channelKey: string
  senderId?: string
  replyReceiveId?: string
  replyReceiveIdType?: string
  unack?: () => Promise<void>
  sessionId: string
}) => {
  const {
    channelType,
    sessionType,
    channelId,
    threadId,
    channelKey,
    senderId,
    replyReceiveId,
    replyReceiveIdType,
    unack,
    sessionId
  } = input
  const db = getDb()
  const previousChannelBinding = db.getChannelSession(channelKey, channelType, sessionType, channelId, threadId)
  const transferredBinding = db.getChannelSessionBySessionId(sessionId)

  const transferChangesDelivery = transferredBinding != null && !isSameChannel(transferredBinding, {
    channelKey,
    channelType,
    sessionType,
    channelId,
    threadId
  })
  if (transferChangesDelivery) {
    db.deleteChannelSession(
      transferredBinding.channelKey,
      transferredBinding.channelType,
      transferredBinding.sessionType,
      transferredBinding.channelId,
      transferredBinding.threadId
    )
  }

  setPendingUnack(sessionId, unack)
  db.upsertChannelSession({
    channelType,
    sessionType,
    channelId,
    threadId,
    channelKey,
    senderId,
    replyReceiveId,
    replyReceiveIdType,
    sessionId
  })
  setBinding(sessionId, {
    channelType,
    channelKey,
    channelId,
    threadId,
    sessionType,
    senderId,
    replyReceiveId,
    replyReceiveIdType
  })

  return {
    alreadyBound: previousChannelBinding?.sessionId === sessionId,
    previousSessionId: previousChannelBinding?.sessionId !== sessionId
      ? previousChannelBinding?.sessionId
      : undefined,
    transferredFrom: transferChangesDelivery
      ? transferredBinding
      : undefined
  }
}

export const syncChannelSessionBinding = (input: {
  channelKey: string
  inbound: ChannelInboundEvent
  sessionId: string
}) => {
  const { channelKey, inbound, sessionId } = input
  return bindChannelSession({
    channelType: inbound.channelType,
    sessionType: inbound.sessionType,
    channelId: inbound.channelId,
    threadId: inbound.threadId,
    channelKey,
    senderId: inbound.senderId,
    replyReceiveId: inbound.replyTo?.receiveId,
    replyReceiveIdType: inbound.replyTo?.receiveIdType,
    unack: inbound.unack,
    sessionId
  })
}

export const bindSessionMiddleware: ChannelMiddleware = async (ctx, next) => {
  const { channelKey, inbound, sessionId } = ctx
  if (!sessionId) return

  syncChannelSessionBinding({
    channelKey,
    inbound,
    sessionId
  })

  await next()
}
