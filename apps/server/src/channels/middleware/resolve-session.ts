import { getDb } from '#~/db/index.js'

import { setBinding } from '../state'
import type { ChannelMiddleware } from './@types'

export const resolveSessionMiddleware: ChannelMiddleware = async (ctx, next) => {
  const db = getDb()
  const result = db.getChannelSession(
    ctx.channelKey,
    ctx.inbound.channelType,
    ctx.inbound.sessionType,
    ctx.inbound.channelId,
    ctx.inbound.threadId
  )
  const preference = db.getChannelPreference(
    ctx.channelKey,
    ctx.inbound.channelType,
    ctx.inbound.sessionType,
    ctx.inbound.channelId
  )
  ctx.sessionId = result?.sessionId
  ctx.channelAdapter = preference?.adapter
  ctx.channelPermissionMode = preference?.permissionMode
  ctx.channelEffort = preference?.effort
  if (result?.sessionId) {
    setBinding(result.sessionId, {
      channelType: result.channelType,
      channelKey: result.channelKey,
      channelId: result.channelId,
      threadId: result.threadId,
      sessionType: result.sessionType,
      senderId: result.senderId,
      replyReceiveId: result.replyReceiveId,
      replyReceiveIdType: result.replyReceiveIdType
    })
  }
  await next()
}
