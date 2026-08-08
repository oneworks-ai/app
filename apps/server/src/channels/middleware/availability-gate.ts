import { getDb } from '#~/db/index.js'
import { logger } from '#~/utils/logger.js'

import type { ChannelContext, ChannelMiddleware } from './@types'
import { hasExplicitChannelIntent, isChannelCommandText } from './@utils'
import { getAvailabilityNow, isWithinAvailabilityWorkHours } from './availability-work-hours'

export {
  clearAvailabilityGateStateForTests,
  isWithinAvailabilityWorkHours,
  setAvailabilityNowProviderForTests
} from './availability-work-hours'

const DEFAULT_OFF_HOURS_REPLY_TEXT = '我现在下班啦，消息会先记下，上班后统一处理。'
const DEFAULT_OFF_HOURS_REPLY_THROTTLE_MS = 20 * 60 * 1000

const isBypassSender = (ctx: ChannelContext) => {
  const senderId = ctx.inbound.senderId
  if (senderId == null || senderId === '') return false

  const availability = ctx.channelLink?.availability
  return ctx.config?.access?.admins?.includes(senderId) === true ||
    availability?.bypassSenders?.includes(senderId) === true ||
    availability?.bypassUsers?.includes(senderId) === true ||
    (ctx.actor?.user?.id != null && availability?.bypassUsers?.includes(ctx.actor.user.id) === true)
}

const shouldReplyOffHours = (ctx: ChannelContext) => (
  ctx.inbound.sessionType === 'direct' ||
  hasExplicitChannelIntent({
    commandText: ctx.commandText,
    config: ctx.config,
    createOnCommand: false,
    createOnMention: ctx.channelLink?.ingress?.createOnMention,
    mentionPatterns: ctx.channelLink?.ingress?.mentionPatterns,
    text: ctx.inbound.text
  })
)

const buildThrottleKey = (ctx: ChannelContext) =>
  [
    'off-hours',
    ctx.channelKey,
    ctx.channelLink?.name ?? ctx.channelKey,
    ctx.inbound.channelType,
    ctx.inbound.sessionType,
    ctx.inbound.channelId
  ].join('\0')

const shouldSendThrottledReply = (ctx: ChannelContext, now: number) => {
  const throttleMs = ctx.channelLink?.availability?.offHours?.replyThrottleMs ??
    DEFAULT_OFF_HOURS_REPLY_THROTTLE_MS
  return getDb().consumeChannelReplyThrottle({
    throttleKey: buildThrottleKey(ctx),
    policyType: 'off_hours_notice',
    channelType: ctx.inbound.channelType,
    channelId: ctx.inbound.channelId,
    channelLinkName: ctx.channelLink?.name,
    actorUserId: ctx.actor?.user?.id,
    actorAccountId: ctx.actor?.account.accountId ?? ctx.inbound.senderId,
    windowMs: throttleMs,
    now,
    metadata: {
      channelKey: ctx.channelKey,
      sessionType: ctx.inbound.sessionType
    }
  })
}

const rememberOffhourBacklog = (ctx: ChannelContext, now: number) => {
  getDb().appendChannelOffhourBacklog({
    channelType: ctx.inbound.channelType,
    channelKey: ctx.channelKey,
    channelId: ctx.inbound.channelId,
    sessionType: ctx.inbound.sessionType,
    channelLinkName: ctx.channelLink?.name,
    entity: ctx.channelLink?.entity,
    senderId: ctx.inbound.senderId,
    actorUserId: ctx.actor?.user?.id,
    messageId: ctx.inbound.messageId,
    text: ctx.inbound.text,
    raw: ctx.inbound.raw,
    createdAt: now
  })
}

export const availabilityGateMiddleware: ChannelMiddleware = async (ctx, next) => {
  const availability = ctx.channelLink?.availability
  if (
    ctx.channelLink == null ||
    availability == null ||
    availability.enabled === false ||
    isBypassSender(ctx) ||
    isWithinAvailabilityWorkHours(availability) ||
    isChannelCommandText(ctx.commandText, ctx.config)
  ) {
    await next()
    return
  }

  const now = getAvailabilityNow().getTime()
  rememberOffhourBacklog(ctx, now)
  if (shouldReplyOffHours(ctx) && shouldSendThrottledReply(ctx, now)) {
    await ctx.reply(availability.offHours?.replyText?.trim() || DEFAULT_OFF_HOURS_REPLY_TEXT)
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
  }, '[channel] ignored inbound message by channel link availability gate')
}
