import type { ChannelBaseConfig, ChannelInboundEvent } from '@oneworks/core/channel'

import { logger } from '#~/utils/logger.js'

import type { ChannelMiddleware } from './@types'
import { isChannelAdminPrincipal, matchesAnyAccessRef, resolveChannelAccessPrincipal } from './access-principal'
import type { ChannelAccessPrincipal } from './access-principal'
import { splitCommand } from './commands/utils'

interface ChannelAccessCheckOptions extends ChannelAccessPrincipal {
  commandText?: string
}

const getCommandPrefix = (config: ChannelBaseConfig | undefined) => {
  const prefix = config?.commandPrefix?.trim()
  return prefix == null || prefix === '' ? '/' : prefix
}

const isStartCommand = (
  commandText: string | undefined,
  config: ChannelBaseConfig | undefined
) => {
  const command = splitCommand(commandText ?? '')[0]
  return command === `${getCommandPrefix(config)}start`
}

export const checkChannelAccess = (
  inbound: ChannelInboundEvent,
  config: ChannelBaseConfig | undefined,
  options: ChannelAccessCheckOptions = {}
): boolean => {
  if (!config) return true
  const access = config.access
  if (!access) return true
  const senderId = inbound.senderId
  const principal = { ...options, accountId: options.accountId ?? senderId }

  // Stopped groups block everyone, including admins; admins can only send /start to resume.
  if (inbound.sessionType === 'group') {
    const channelId = inbound.channelId
    if (access.blockedGroups && access.blockedGroups.includes(channelId)) {
      return isChannelAdminPrincipal(access.admins, principal) && isStartCommand(options.commandText, config)
    }
  }

  // Admins bypass the remaining access controls.
  if (isChannelAdminPrincipal(access.admins, principal)) return true

  // Check chat type permissions (default: both allowed)
  if (inbound.sessionType === 'direct' && access.allowPrivateChat === false) return false
  if (inbound.sessionType === 'group' && access.allowGroupChat === false) return false

  // Group-level whitelist (only applies to group messages)
  if (inbound.sessionType === 'group') {
    const channelId = inbound.channelId
    if (access.allowedGroups && access.allowedGroups.length > 0 && !access.allowedGroups.includes(channelId)) {
      return false
    }
  }

  // Sender blacklist (takes priority over whitelist)
  if (matchesAnyAccessRef(access.blockedSenders, principal)) return false

  // Sender whitelist
  if (access.allowedSenders && access.allowedSenders.length > 0) {
    if (!matchesAnyAccessRef(access.allowedSenders, principal)) return false
  }

  return true
}

export const accessControlMiddleware: ChannelMiddleware = async (ctx, next) => {
  if (
    !checkChannelAccess(ctx.inbound, ctx.config, {
      commandText: ctx.commandText,
      ...resolveChannelAccessPrincipal(ctx)
    })
  ) {
    logger.info({
      channelId: ctx.inbound.channelId,
      channelType: ctx.inbound.channelType,
      commandText: ctx.commandText,
      messageId: ctx.inbound.messageId,
      senderId: ctx.inbound.senderId,
      sessionType: ctx.inbound.sessionType
    }, '[channel] blocked inbound message by access control')
    return
  }
  await next()
}
