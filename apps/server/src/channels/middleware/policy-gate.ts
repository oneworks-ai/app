import { getDb } from '#~/db/index.js'
import {
  buildChannelAccountPrincipal,
  buildMutedNotice,
  evaluateInboundPolicy,
  resolvePolicySubject
} from '#~/services/channel-policy/index.js'
import { encodeChannelRuntimeKey } from '#~/services/channel-runtime-key.js'

import type { ChannelContext, ChannelMiddleware } from './@types'
import { hasExplicitChannelIntent } from './@utils'
import { isChannelAdminContext } from './access-principal'

const DEFAULT_MUTED_REPLY_THROTTLE_MS = 10 * 60 * 1000

const buildActor = (ctx: ChannelContext) => {
  const account = ctx.actor?.account
  if (account == null || ctx.channelLink?.moderation == null) return undefined
  return {
    accountId: account.accountId,
    canonicalUserId: ctx.actor?.identityLink?.status === 'verified' ? ctx.actor.user?.id : undefined,
    channelLinkName: ctx.channelLink.name,
    channelType: ctx.inbound.channelType,
    isAdmin: isChannelAdminContext(ctx),
    issuerKey: account.issuerKey,
    messageId: ctx.inbound.messageId,
    moderation: ctx.channelLink.moderation,
    text: ctx.inbound.text ?? ctx.commandText
  }
}

const hasExplicitIntent = (ctx: ChannelContext) =>
  hasExplicitChannelIntent({
    commandText: ctx.commandText,
    config: ctx.config,
    createOnMention: ctx.channelLink?.ingress.createOnMention,
    mentionedBot: ctx.inbound.mentionedBot,
    mentionPatterns: ctx.channelLink?.ingress.mentionPatterns,
    text: ctx.inbound.text
  })

export const policyGateMiddleware: ChannelMiddleware = async (ctx, next) => {
  const channelLink = ctx.channelLink
  const actor = buildActor(ctx)
  if (channelLink == null || actor == null || actor.moderation.enabled === false) {
    await next()
    return
  }
  const decision = await evaluateInboundPolicy(actor)
  if (decision.kind !== 'drop' || decision.state == null) {
    await next()
    return
  }
  if (!hasExplicitIntent(ctx)) return
  const now = Date.now()
  const subject = resolvePolicySubject(actor)
  const sent = getDb().consumeChannelReplyThrottle({
    actorAccountId: buildChannelAccountPrincipal(actor.issuerKey, actor.accountId),
    actorUserId: actor.canonicalUserId,
    channelId: ctx.inbound.channelId,
    channelLinkName: channelLink.name,
    channelType: ctx.inbound.channelType,
    metadata: { policyKey: decision.state.policyKey },
    now,
    policyType: 'muted_mention_notice',
    throttleKey: encodeChannelRuntimeKey('muted-mention', channelLink.name, ctx.inbound.channelId, subject.subjectKey),
    windowMs: actor.moderation.replyThrottleMs ?? DEFAULT_MUTED_REPLY_THROTTLE_MS
  })
  if (sent) await ctx.reply(buildMutedNotice({ moderation: actor.moderation, now, state: decision.state }))
}
