import { getDb } from '#~/db/index.js'
import { encodeChannelRuntimeKey } from '#~/services/channel-runtime-key.js'
import { logger } from '#~/utils/logger.js'

import type { ChannelContext, ChannelMiddleware } from './@types'
import { hasExplicitChannelIntent, isChannelCommandText } from './@utils'
import { isChannelAdminContext } from './access-principal'
import { getAvailabilityNow, isWithinAvailabilityWorkHours } from './availability-work-hours'

export {
  clearAvailabilityGateStateForTests,
  isWithinAvailabilityWorkHours,
  setAvailabilityNowProviderForTests
} from './availability-work-hours'

const DEFAULT_OFF_HOURS_REPLY_TEXT = '我现在下班啦，消息会先记下，上班后统一处理。'
const DEFAULT_OFF_HOURS_REPLY_THROTTLE_MS = 20 * 60 * 1000

const isBypassSender = (ctx: ChannelContext) => {
  const account = ctx.actor?.account
  const senderId = ctx.inbound.senderId
  if (account == null || senderId == null || senderId === '') return false

  const availability = ctx.channelLink?.availability
  return isChannelAdminContext(ctx) ||
    availability?.bypassAccounts?.some(item =>
        item.issuerKey === account.issuerKey && item.accountId === account.accountId
      ) === true ||
    availability?.bypassSenders?.some(item =>
        item.issuerKey === account.issuerKey && item.accountId === account.accountId
      ) === true ||
    (ctx.actor?.identityLink?.status === 'verified' && ctx.actor.user?.id != null &&
      availability?.bypassUsers?.includes(ctx.actor.user.id) === true)
}

const shouldReplyOffHours = (ctx: ChannelContext) => (
  ctx.inbound.sessionType === 'direct' ||
  hasExplicitChannelIntent({
    commandText: ctx.commandText,
    config: ctx.config,
    createOnCommand: false,
    createOnMention: ctx.channelLink?.ingress?.createOnMention,
    mentionedBot: ctx.inbound.mentionedBot,
    mentionPatterns: ctx.channelLink?.ingress?.mentionPatterns,
    text: ctx.inbound.text
  })
)

const buildThrottleKey = (ctx: ChannelContext) =>
  encodeChannelRuntimeKey(
    'off-hours',
    ctx.channelKey,
    ctx.channelLink?.name ?? ctx.channelKey,
    ctx.inbound.channelType,
    ctx.inbound.sessionType,
    ctx.inbound.channelId,
    ctx.actor?.identityLink?.status === 'verified' && ctx.actor.user?.id != null
      ? ctx.actor.user.id
      : ctx.actor?.account == null
      ? ctx.inbound.senderId ?? 'anonymous'
      : encodeChannelRuntimeKey(ctx.actor.account.issuerKey, ctx.actor.account.accountId)
  )

const isTargetedChannelCommand = (ctx: ChannelContext) =>
  hasExplicitChannelIntent({
    commandText: ctx.commandText,
    config: ctx.config,
    createOnMention: false,
    mentionedBot: ctx.inbound.mentionedBot,
    text: ctx.inbound.text
  })

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
  if (ctx.inbound.sessionType === 'group' && ctx.inbound.mentionedBot === false) {
    return
  }

  const availability = ctx.channelLink?.availability
  const override = ctx.channelLink == null ? undefined : getDb().getChannelAvailabilityOverride(ctx.channelLink.name)
  if (
    ctx.channelLink == null ||
    availability == null ||
    override?.enabled === false ||
    (override == null && availability.enabled === false) ||
    isBypassSender(ctx) ||
    isWithinAvailabilityWorkHours(availability) ||
    (isChannelCommandText(ctx.commandText, ctx.config) && isTargetedChannelCommand(ctx))
  ) {
    await next()
    return
  }

  const now = getAvailabilityNow().getTime()
  if (availability.offHours?.mode !== 'drop') {
    rememberOffhourBacklog(ctx, now)
  }
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
