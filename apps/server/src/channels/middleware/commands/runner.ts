import { getDb } from '#~/db/index.js'
import type { ChannelCommandRunSource } from '#~/db/index.js'
import { resolveChannelApproval } from '#~/services/channel-approval/index.js'
import type { ChannelApprovalDecision } from '#~/services/channel-approval/index.js'

import type { ChannelContext } from '../@types'
import type { CommandParseSuccess } from './command-system'

const createCommandRun = (
  ctx: ChannelContext,
  parsed: CommandParseSuccess<ChannelContext>,
  source: ChannelCommandRunSource,
  metadata?: Record<string, unknown>
) =>
  getDb().createChannelCommandRun({
    actorAccountId: ctx.inbound.senderId ?? ctx.actor?.account.accountId,
    actorUserId: ctx.actor?.user?.id,
    channelId: ctx.inbound.channelId,
    channelKey: ctx.channelKey,
    channelLinkName: ctx.channelLink?.name,
    channelType: ctx.inbound.channelType,
    commandName: parsed.command.name,
    commandPath: [...parsed.commandPath],
    entity: ctx.channelLink?.entity,
    messageId: ctx.inbound.messageId,
    metadata: {
      usage: parsed.usage,
      ...(metadata ?? {})
    },
    permission: parsed.command.permission,
    rawArgs: [...parsed.rawArgs],
    senderId: ctx.inbound.senderId,
    sessionType: ctx.inbound.sessionType,
    source
  })

const summarizeApprovalDecision = (decision: ChannelApprovalDecision) => ({
  actorAccountId: decision.actorAccountId,
  actorUserId: decision.actorUserId,
  authorizationRequestId: decision.authorizationRequest?.id,
  capability: decision.capability,
  credentialKey: decision.credentialKey,
  credentialSubjectUserId: decision.credentialSubjectUserId,
  reasonCode: decision.reasonCode,
  status: decision.status
})

const resolveCommandApproval = (
  ctx: ChannelContext,
  parsed: CommandParseSuccess<ChannelContext>,
  source: ChannelCommandRunSource
) => {
  const commandCapability = parsed.commandPath
    .map(segment => segment.replace(/^\/+/u, ''))
    .filter(segment => segment !== '')
    .join('.')
  return resolveChannelApproval({
    actorAccountId: ctx.inbound.senderId ?? ctx.actor?.account.accountId,
    actorUserId: ctx.actor?.user?.id,
    capability: `channel.command.${commandCapability}`,
    channelAdmins: ctx.config?.access?.admins,
    channelId: ctx.inbound.channelId,
    channelKey: ctx.channelKey,
    channelLinkName: ctx.channelLink?.name,
    channelType: ctx.inbound.channelType,
    entity: ctx.channelLink?.entity,
    permission: parsed.command.permission,
    senderId: ctx.inbound.senderId,
    sessionId: ctx.sessionId,
    sessionType: ctx.inbound.sessionType,
    source
  })
}

export const executeParsedCommand = async (
  ctx: ChannelContext,
  parsed: CommandParseSuccess<ChannelContext>,
  options: { source: ChannelCommandRunSource; metadata?: Record<string, unknown> }
) => {
  const approval = resolveCommandApproval(ctx, parsed, options.source)
  const commandRun = createCommandRun(ctx, parsed, options.source, {
    ...(options.metadata ?? {}),
    approval: summarizeApprovalDecision(approval)
  })
  if (approval.status !== 'allow') {
    await ctx.reply(ctx.t('system.noPermission'))
    if (commandRun != null) {
      getDb().finishChannelCommandRun(commandRun.id, { status: 'denied' })
    }
    return {
      commandPath: parsed.commandPath,
      commandRunId: commandRun?.id,
      source: options.source,
      status: 'denied' as const,
      usage: parsed.usage
    }
  }

  try {
    await parsed.command.action?.({
      ctx,
      args: [...parsed.args],
      rawArgs: parsed.rawArgs,
      commandPath: parsed.commandPath,
      usage: parsed.usage
    })
    if (commandRun != null) {
      getDb().finishChannelCommandRun(commandRun.id, { status: 'success' })
    }
  } catch (error) {
    if (commandRun != null) {
      getDb().finishChannelCommandRun(commandRun.id, {
        error: error instanceof Error ? error.message : String(error),
        status: 'failed'
      })
    }
    throw error
  }

  return {
    commandPath: parsed.commandPath,
    commandRunId: commandRun?.id,
    source: options.source,
    status: 'success' as const,
    usage: parsed.usage
  }
}
