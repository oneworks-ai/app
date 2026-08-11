import { getDb } from '#~/db/index.js'
import { resolveAmbientChannelThreadKey } from '#~/services/channel-continuity/index.js'
import { routeInboundChannelMessage } from '#~/services/channel-ingress-router/index.js'

import type { ChannelMiddleware } from './@types'

const observeInbound = (ctx: Parameters<ChannelMiddleware>[0], decision: 'observe' | 'defer') => {
  const threadKey = resolveAmbientChannelThreadKey({
    channelId: ctx.inbound.channelId,
    channelKey: ctx.channelKey,
    entity: ctx.channelLink?.entity ?? 'unbound'
  })
  const state = getDb().ensureChannelConversationState({
    channelId: ctx.inbound.channelId,
    channelKey: ctx.channelKey,
    channelLinkName: ctx.channelLink?.name,
    channelType: ctx.inbound.channelType,
    entity: ctx.channelLink?.entity,
    sessionType: ctx.inbound.sessionType,
    threadKey
  })
  getDb().appendChannelConversationTurn({
    actorAccountId: ctx.actor?.account.accountId ?? ctx.inbound.senderId,
    actorUserId: ctx.actor?.identityLink?.status === 'verified' ? ctx.actor.user?.id : undefined,
    channelId: ctx.inbound.channelId,
    channelKey: ctx.channelKey,
    channelLinkName: ctx.channelLink?.name,
    channelType: ctx.inbound.channelType,
    conversationStateId: state.id,
    entity: ctx.channelLink?.entity,
    messageId: ctx.inbound.messageId,
    metadata: { ingressDecision: decision },
    role: 'inbound',
    senderId: ctx.inbound.senderId,
    sessionType: ctx.inbound.sessionType,
    summary: (ctx.inbound.text ?? '').slice(0, 512),
    text: (ctx.inbound.text ?? '').slice(0, 512),
    threadKey
  })
}

export const ingressRouterMiddleware: ChannelMiddleware = async (ctx, next) => {
  if (ctx.channelLink == null) {
    if (ctx.inbound.sessionType === 'direct') return
    await next()
    return
  }
  const result = await routeInboundChannelMessage(ctx)
  ctx.ingressRoute = result.route
  ctx.ingressRouterRunId = result.audit.id
  if (result.decision.decision === 'create_child') {
    await next()
    return
  }
  if (result.decision.decision === 'observe' || result.decision.decision === 'defer') {
    observeInbound(ctx, result.decision.decision)
  }
}
