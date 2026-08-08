import { getDb } from '#~/db/index.js'

import type { ChannelMiddleware } from './@types'

export const identityMiddleware: ChannelMiddleware = async (ctx, next) => {
  const senderId = ctx.inbound.senderId?.trim()
  if (senderId != null && senderId !== '') {
    const db = getDb()
    const account = db.upsertChannelAccount({
      channelType: ctx.inbound.channelType,
      accountId: senderId
    })
    const identityLink = db.getChannelIdentityLink(ctx.inbound.channelType, senderId)
    const user = identityLink?.status === 'verified'
      ? db.resolveCanonicalUserByChannelAccount(ctx.inbound.channelType, senderId)
      : undefined

    if (account != null) {
      ctx.actor = {
        account,
        identityLink,
        user
      }
    }
  }

  await next()
}
