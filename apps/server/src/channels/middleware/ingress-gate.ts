import { logger } from '#~/utils/logger.js'

import type { ChannelContext, ChannelMiddleware } from './@types'
import { hasExplicitChannelIntent } from './@utils'

const shouldAllowByExplicitIntent = (ctx: ChannelContext) => {
  const ingress = ctx.channelLink?.ingress

  return hasExplicitChannelIntent({
    commandText: ctx.commandText,
    config: ctx.config,
    createOnCommand: ingress?.createOnCommand,
    createOnMention: ingress?.createOnMention,
    mentionPatterns: ingress?.mentionPatterns,
    text: ctx.inbound.text
  })
}

export const ingressGateMiddleware: ChannelMiddleware = async (ctx, next) => {
  const ingress = ctx.channelLink?.ingress
  if (
    ctx.channelLink == null ||
    ctx.inbound.sessionType !== 'group' ||
    ingress?.ambientRouting !== false ||
    shouldAllowByExplicitIntent(ctx)
  ) {
    await next()
    return
  }

  logger.info({
    channelId: ctx.inbound.channelId,
    channelKey: ctx.channelKey,
    channelLink: ctx.channelLink.name,
    channelType: ctx.inbound.channelType,
    messageId: ctx.inbound.messageId,
    senderId: ctx.inbound.senderId,
    sessionId: ctx.sessionId,
    sessionType: ctx.inbound.sessionType
  }, '[channel] ignored inbound group message by channel link ingress gate')
}
