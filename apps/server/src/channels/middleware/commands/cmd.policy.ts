/* eslint-disable max-lines -- policy, availability, and backlog operator commands share one permission surface. */
import { getDb } from '#~/db/index.js'
import {
  buildChannelPolicyKey,
  processOffhourBacklogDigest,
  resolvePolicySubject,
  setOperatorPolicyState
} from '#~/services/channel-policy/index.js'

import type { ChannelContext } from '../@types'
import { defineMessages } from '../i18n'
import { isAdmin } from './access'
import { command, optionalArg, requiredArg } from './command-system'

defineMessages('zh', {
  'cmd.policy.description': '查看或管理当前频道的发送者策略',
  'cmd.availability.description': '查看或临时切换当前频道的可用性',
  'cmd.backlog.description': '查看或处理当前频道的下班消息积压',
  'operator.policy.unavailable': '当前频道没有可用的策略链接。',
  'operator.policy.state': ({ state, target }) => `发送者 ${target} 的策略状态：${state}`,
  'operator.policy.updated': ({ action, target }) => `已对发送者 ${target} 执行策略操作：${action}。`,
  'operator.policy.audit': ({ count, target }) => `发送者 ${target} 最近策略审计：${count} 条。`,
  'operator.availability': ({ enabled }) => `当前频道可用性：${enabled}`,
  'operator.availability.updated': ({ enabled }) => `已将当前频道可用性设为：${enabled}。`,
  'operator.backlog.list': ({ count }) => `当前频道待处理下班消息：${count} 条。`,
  'operator.backlog.processed': ({ count }) => `已创建下班消息摘要任务，处理 ${count} 条。`,
  'operator.backlog.empty': '当前频道没有可处理的下班消息。',
  'operator.backlog.retried': ({ count }) => `已重新排队 ${count} 条下班消息。`
})

defineMessages('en', {
  'cmd.policy.description': 'Inspect or manage sender policy for the current channel',
  'cmd.availability.description': 'Inspect or temporarily switch current channel availability',
  'cmd.backlog.description': 'Inspect or process current channel off-hours backlog',
  'operator.policy.unavailable': 'The current channel has no policy link.',
  'operator.policy.state': ({ state, target }) => `Policy state for ${target}: ${state}`,
  'operator.policy.updated': ({ action, target }) => `Policy action ${action} applied to ${target}.`,
  'operator.policy.audit': ({ count, target }) => `Recent policy audit entries for ${target}: ${count}.`,
  'operator.availability': ({ enabled }) => `Current channel availability: ${enabled}`,
  'operator.availability.updated': ({ enabled }) => `Current channel availability is now: ${enabled}.`,
  'operator.backlog.list': ({ count }) => `Pending off-hours messages for this channel: ${count}.`,
  'operator.backlog.processed': ({ count }) => `Created an off-hours digest run for ${count} messages.`,
  'operator.backlog.empty': 'There are no off-hours messages to process for this channel.',
  'operator.backlog.retried': ({ count }) => `Requeued ${count} off-hours messages.`
})

const linkActor = (ctx: ChannelContext) => {
  if (ctx.channelLink == null) return undefined
  return {
    channelLinkName: ctx.channelLink.name,
    issuerKey: ctx.actor?.account.issuerKey ?? ctx.channelKey,
    moderation: ctx.channelLink.moderation
  }
}

const policySubjectForSender = (ctx: ChannelContext, senderId: string) => {
  const actor = linkActor(ctx)
  if (actor == null) return undefined
  const identityLink = getDb().getChannelIdentityLink(actor.issuerKey, senderId)
  const canonicalUserId = identityLink?.status === 'verified' ? identityLink.userId : undefined
  const subject = resolvePolicySubject({
    accountId: senderId,
    canonicalUserId,
    issuerKey: actor.issuerKey,
    moderation: actor.moderation
  })
  return { actor, canonicalUserId, subject }
}

const policyKeyForSender = (ctx: ChannelContext, senderId: string) => {
  const resolved = policySubjectForSender(ctx, senderId)
  return resolved == null ? undefined : buildChannelPolicyKey(resolved.actor.channelLinkName, resolved.subject)
}

const policyStatus = async (ctx: ChannelContext, senderId: string) => {
  const key = policyKeyForSender(ctx, senderId)
  if (key == null) return await ctx.reply(ctx.t('operator.policy.unavailable'))
  const state = getDb().getChannelPolicyState(key)
  await ctx.reply(ctx.t('operator.policy.state', { state: state?.state ?? 'normal', target: senderId }))
}

const canReadPolicyTarget = async (ctx: ChannelContext, target: string) => {
  if (target === ctx.inbound.senderId || isAdmin(ctx)) return true
  await ctx.reply(ctx.t('system.noPermission'))
  return false
}

const mutatePolicy = async (
  ctx: ChannelContext,
  action: 'warn' | 'mute' | 'unmute',
  senderId: string,
  durationMinutes?: string,
  reason?: string
) => {
  const resolved = policySubjectForSender(ctx, senderId)
  if (resolved == null) {
    await ctx.reply(ctx.t('operator.policy.unavailable'))
    return
  }
  const parsedDuration = Number(durationMinutes)
  const durationMs = action !== 'mute' || !Number.isFinite(parsedDuration) || parsedDuration <= 0
    ? undefined
    : Math.floor(parsedDuration * 60_000)
  setOperatorPolicyState({
    accountId: senderId,
    action,
    actor: resolved.actor,
    canonicalUserId: resolved.canonicalUserId,
    durationMs,
    reason,
    updatedBy: ctx.inbound.senderId ?? 'channel_operator'
  })
  await ctx.reply(ctx.t('operator.policy.updated', { action, target: senderId }))
}

export const policyCommands = () => [
  command<ChannelContext>('policy')
    .description('cmd.policy.description')
    .subcommand(
      command<ChannelContext>('status').approval({
        capability: 'channel.policy.status',
        risk: 'low',
        visibility: 'dm'
      }).argument(optionalArg('senderId')).action(async ({ ctx, args: [senderId] }) => {
        const target = (senderId as string | undefined) ?? ctx.inbound.senderId ?? 'anonymous'
        if (await canReadPolicyTarget(ctx, target)) await policyStatus(ctx, target)
      })
    )
    .subcommand(
      command<ChannelContext>('warn').approval({
        capability: 'channel.policy.warn',
        risk: 'medium',
        visibility: 'none'
      }).adminOnly().argument(requiredArg('senderId')).argument(optionalArg('reason'))
        .action(
          async ({ ctx, args: [senderId, reason] }) => {
            await mutatePolicy(ctx, 'warn', senderId as string, undefined, reason as string | undefined)
          }
        )
    )
    .subcommand(
      command<ChannelContext>('mute').approval({
        capability: 'channel.policy.mute',
        risk: 'high',
        visibility: 'none'
      }).adminOnly().argument(requiredArg('senderId')).argument(optionalArg('minutes'))
        .argument(optionalArg('reason')).action(
          async ({ ctx, args: [senderId, minutes, reason] }) => {
            await mutatePolicy(
              ctx,
              'mute',
              senderId as string,
              minutes as string | undefined,
              reason as string | undefined
            )
          }
        )
    )
    .subcommand(
      command<ChannelContext>('unmute').approval({
        capability: 'channel.policy.unmute',
        risk: 'medium',
        visibility: 'none'
      }).adminOnly().argument(requiredArg('senderId')).action(
        async ({ ctx, args: [senderId] }) => {
          await mutatePolicy(ctx, 'unmute', senderId as string)
        }
      )
    )
    .subcommand(
      command<ChannelContext>('audit').approval({
        capability: 'channel.policy.audit',
        risk: 'medium',
        visibility: 'dm'
      }).argument(optionalArg('senderId')).action(async ({ ctx, args: [senderId] }) => {
        const target = (senderId as string | undefined) ?? ctx.inbound.senderId ?? 'anonymous'
        if (!await canReadPolicyTarget(ctx, target)) return
        const key = policyKeyForSender(ctx, target)
        if (key == null) {
          await ctx.reply(ctx.t('operator.policy.unavailable'))
          return
        }
        await ctx.reply(
          ctx.t('operator.policy.audit', { count: getDb().listChannelPolicyEvents(key, 20).length, target })
        )
      })
    )
    .build(),

  command<ChannelContext>('availability')
    .description('cmd.availability.description')
    .subcommand(
      command<ChannelContext>('status').approval({
        capability: 'channel.availability.status',
        risk: 'low',
        visibility: 'public'
      }).action(async ({ ctx }) => {
        const link = ctx.channelLink
        if (link == null) {
          await ctx.reply(ctx.t('operator.policy.unavailable'))
          return
        }
        const override = getDb().getChannelAvailabilityOverride(link.name)
        const enabled = override?.enabled ?? link.availability?.enabled !== false
        await ctx.reply(ctx.t('operator.availability', { enabled: enabled ? 'on' : 'off' }))
      })
    )
    .subcommand(
      command<ChannelContext>('off').approval({
        capability: 'channel.availability.disable',
        risk: 'high',
        visibility: 'none'
      }).adminOnly().action(async ({ ctx }) => {
        const link = ctx.channelLink
        if (link == null) {
          await ctx.reply(ctx.t('operator.policy.unavailable'))
          return
        }
        getDb().setChannelAvailabilityOverride({
          channelLinkName: link.name,
          enabled: false,
          updatedBy: ctx.inbound.senderId ?? 'channel_operator'
        })
        await ctx.reply(ctx.t('operator.availability.updated', { enabled: 'off' }))
      })
    )
    .subcommand(
      command<ChannelContext>('on').approval({
        capability: 'channel.availability.enable',
        risk: 'medium',
        visibility: 'none'
      }).adminOnly().action(async ({ ctx }) => {
        const link = ctx.channelLink
        if (link == null) {
          await ctx.reply(ctx.t('operator.policy.unavailable'))
          return
        }
        getDb().setChannelAvailabilityOverride({
          channelLinkName: link.name,
          enabled: true,
          updatedBy: ctx.inbound.senderId ?? 'channel_operator'
        })
        await ctx.reply(ctx.t('operator.availability.updated', { enabled: 'on' }))
      })
    )
    .build(),

  command<ChannelContext>('backlog')
    .description('cmd.backlog.description')
    .subcommand(
      command<ChannelContext>('list').approval({
        capability: 'channel.backlog.list',
        risk: 'medium',
        visibility: 'none'
      }).action(async ({ ctx }) => {
        const count =
          getDb().listPendingChannelOffhourBacklog({ channelLinkName: ctx.channelLink?.name, limit: 50 }).length
        await ctx.reply(ctx.t('operator.backlog.list', { count }))
      })
    )
    .subcommand(
      command<ChannelContext>('process').approval({
        capability: 'channel.backlog.process',
        risk: 'high',
        visibility: 'none'
      }).adminOnly().action(async ({ ctx }) => {
        const result = await processOffhourBacklogDigest({
          channelContext: {
            actorAccountId: ctx.actor?.account.accountId,
            actorUserId: ctx.actor?.user?.id,
            channelId: ctx.inbound.channelId,
            channelKey: ctx.channelKey,
            channelLinkName: ctx.channelLink?.name,
            channelType: ctx.inbound.channelType,
            entity: ctx.channelLink?.entity,
            replyReceiveId: ctx.inbound.replyTo?.receiveId,
            replyReceiveIdType: ctx.inbound.replyTo?.receiveIdType,
            senderId: ctx.inbound.senderId,
            sessionType: ctx.inbound.sessionType,
            threadId: ctx.inbound.threadId
          },
          channelId: ctx.inbound.channelId,
          channelKey: ctx.channelKey,
          channelLinkName: ctx.channelLink?.name,
          channelType: ctx.inbound.channelType,
          entity: ctx.channelLink?.entity,
          sessionType: ctx.inbound.sessionType
        })
        await ctx.reply(
          ctx.t(result.claimed === 0 ? 'operator.backlog.empty' : 'operator.backlog.processed', {
            count: result.processed
          })
        )
      })
    )
    .subcommand(
      command<ChannelContext>('retry').approval({
        capability: 'channel.backlog.retry',
        risk: 'high',
        visibility: 'none'
      }).adminOnly().argument(requiredArg('id')).action(async ({ ctx, args: [id] }) => {
        const item = getDb().getChannelOffhourBacklogItem(id as string)
        const belongsToCurrentChannel = item?.channelKey === ctx.channelKey &&
          item.channelId === ctx.inbound.channelId &&
          item.channelType === ctx.inbound.channelType &&
          item.channelLinkName === (ctx.channelLink?.name ?? null) &&
          item.entity === (ctx.channelLink?.entity ?? null) &&
          item.sessionType === ctx.inbound.sessionType
        const count = belongsToCurrentChannel
          ? getDb().retryChannelOffhourBacklogClaim({ ids: [id as string] })
          : 0
        await ctx.reply(ctx.t('operator.backlog.retried', { count }))
      })
    )
    .build()
]
