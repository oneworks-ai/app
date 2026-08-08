import { isDuplicateMessage, releaseMessageDeduplication } from '../state'
import type { ChannelMiddleware } from './@types'

export const deduplicateMiddleware: ChannelMiddleware = async (ctx, next) => {
  const { inbound } = ctx
  const messageKey =
    `${ctx.channelKey}:${inbound.channelType}:${inbound.sessionType}:${inbound.channelId}:${inbound.messageId}`
  if (isDuplicateMessage(messageKey)) return
  try {
    await next()
  } catch (error) {
    releaseMessageDeduplication(messageKey)
    throw error
  }
}
