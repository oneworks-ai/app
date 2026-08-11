import { getDb } from '#~/db/index.js'
import { buildMutedNotice, evaluateInboundPolicy, resolvePolicySubject } from '#~/services/channel-policy/index.js'

import type { ChannelContext, ChannelMiddleware } from './@types'
import { hasExplicitChannelIntent } from './@utils'

const DEFAULT_MUTED_REPLY_THROTTLE_MS = 10 * 60 * 1000

const isAdmin = (ctx: ChannelContext) => {
  const senderId = ctx.inbound.senderId
  return senderId != null && ctx.config?.access?.admins?.includes(senderId) === true
}

const hasExplicitIntent = (ctx: ChannelContext) =>
  hasExplicitChannelIntent({
    commandText: ctx.commandText,
    config: ctx.config,
    createOnMention: ctx.channelLink?.ingress?.createOnMention,
    mentionedBot: ctx.inbound.mentionedBot,
    mentionPatterns: ctx.channelLink?.ingress?.mentionPatterns,
    text: ctx.inbound.text
  })

const buildActor = (ctx: ChannelContext) => {
  const accountId = ctx.actor?.account.accountId ?? ctx.inbound.senderId
  if (accountId == null || accountId === '' || ctx.channelLink == null) return undefined
  return {
    accountId,
    canonicalUserId: ctx.actor?.user?.id,
    channelLinkName: ctx.channelLink.name,
    channelType: ctx.inbound.channelType,
    isAdmin: isAdmin(ctx),
    messageId: ctx.inbound.messageId,
    moderation: ctx.channelLink.moderation,
    text: ctx.inbound.text ?? ctx.commandText
  }
}

const buildThrottleKey = (ctx: ChannelContext, subjectKey: string) =>
  [
    'muted-mention',
    ctx.channelKey,
    ctx.channelLink?.name ?? ctx.channelKey,
    ctx.inbound.channelType,
    ctx.inbound.channelId,
    subjectKey
  ].join('\0')

export const policyGateMiddleware: ChannelMiddleware = async (ctx, next) => {
  const actor = buildActor(ctx)
  if (actor == null || actor.moderation == null || actor.moderation.enabled === false) {
    await next()
    return
  }

  const decision = await evaluateInboundPolicy(actor)
  if (decision.kind !== 'drop' || decision.state == null) {
    await next()
    return
  }

  const subject = resolvePolicySubject(actor)
  if (hasExplicitIntent(ctx)) {
    const now = Date.now()
    const windowMs = actor.moderation.replyThrottleMs ?? DEFAULT_MUTED_REPLY_THROTTLE_MS
    const sent = getDb().consumeChannelReplyThrottle({
      throttleKey: buildThrottleKey(ctx, subject.subjectKey),
      policyType: 'muted_mention_notice',
      channelType: ctx.inbound.channelType,
      channelId: ctx.inbound.channelId,
      channelLinkName: ctx.channelLink?.name,
      actorUserId: actor.canonicalUserId,
      actorAccountId: actor.accountId,
      windowMs,
      now,
      metadata: { policyKey: decision.state.policyKey }
    })
    if (sent) {
      await ctx.reply(buildMutedNotice({ state: decision.state, moderation: actor.moderation, now }))
    }
  }
}
