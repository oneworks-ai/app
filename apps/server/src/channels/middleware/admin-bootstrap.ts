import { randomBytes } from 'node:crypto'

import type { ConfigSource } from '@oneworks/core'
import type { ChannelBaseConfig } from '@oneworks/core/channel'

import { logger } from '#~/utils/logger.js'

import type { ChannelMiddleware } from './@types'
import { addToAccessList } from './commands/access'
import { splitCommand } from './commands/utils'

export const ADMIN_BOOTSTRAP_REPLY_TEXT = '管理员尚未初始化，请联系服务维护者获取授权指令。'

const ADMIN_BOOTSTRAP_COMMAND = 'authorize-admin'
const bootstrapTokens = new Map<string, string>()
const loggedBootstrapCommands = new Set<string>()

interface AdminBootstrapAuthorizationContext {
  channelKey: string
  channelType: string
  channelId?: string
  config?: ChannelBaseConfig
  configSource?: ConfigSource
  senderId?: string
  sessionType?: string
}

export const hasChannelAdmins = (config: ChannelBaseConfig | undefined) => (config?.access?.admins?.length ?? 0) > 0

const getPrefix = (ctx: { config?: ChannelBaseConfig }) =>
  ((ctx.config as Record<string, unknown> | undefined)?.commandPrefix as string | undefined) ?? '/'

const getBootstrapKey = (ctx: Pick<AdminBootstrapAuthorizationContext, 'channelKey' | 'configSource'>) =>
  [
    ctx.configSource ?? 'project',
    ctx.channelKey
  ].join('\0')

const getBootstrapToken = (ctx: Pick<AdminBootstrapAuthorizationContext, 'channelKey' | 'configSource'>) => {
  const key = getBootstrapKey(ctx)
  const existing = bootstrapTokens.get(key)
  if (existing != null) return existing

  const token = randomBytes(12).toString('hex')
  bootstrapTokens.set(key, token)
  return token
}

const buildAuthorizationCommand = (ctx: AdminBootstrapAuthorizationContext) =>
  `${getPrefix(ctx)}${ADMIN_BOOTSTRAP_COMMAND} ${getBootstrapToken(ctx)}`

export const logAdminBootstrapAuthorizationCommand = (ctx: AdminBootstrapAuthorizationContext) => {
  if (hasChannelAdmins(ctx.config)) return

  const key = getBootstrapKey(ctx)
  if (loggedBootstrapCommands.has(key)) return
  loggedBootstrapCommands.add(key)

  logger.warn({
    channelKey: ctx.channelKey,
    channelType: ctx.channelType,
    channelId: ctx.channelId,
    configSource: ctx.configSource,
    sessionType: ctx.sessionType,
    senderId: ctx.senderId,
    authorizationCommand: buildAuthorizationCommand(ctx)
  }, '[channel] 管理员尚未初始化，请将授权指令发送到频道完成管理员授权')
}

const getAuthorizationContext = (ctx: Parameters<ChannelMiddleware>[0]): AdminBootstrapAuthorizationContext => ({
  channelKey: ctx.channelKey,
  channelType: ctx.inbound.channelType,
  channelId: ctx.inbound.channelId,
  config: ctx.config,
  configSource: ctx.configSource,
  senderId: ctx.inbound.senderId,
  sessionType: ctx.inbound.sessionType
})

const tryAuthorizeFirstAdmin = async (ctx: Parameters<ChannelMiddleware>[0]) => {
  const [command, token, ...rest] = splitCommand(ctx.commandText)
  if (command !== `${getPrefix(ctx)}${ADMIN_BOOTSTRAP_COMMAND}`) return false

  if (ctx.inbound.senderId == null || ctx.inbound.senderId === '') {
    logger.warn({
      channelKey: ctx.channelKey,
      channelType: ctx.inbound.channelType,
      channelId: ctx.inbound.channelId
    }, '[channel] 管理员初始化失败，入站消息缺少 senderId')
    await ctx.reply('管理员初始化失败：入站消息缺少 senderId。')
    return true
  }

  const authorizationContext = getAuthorizationContext(ctx)
  const expectedToken = getBootstrapToken(authorizationContext)
  if (token !== expectedToken || rest.length > 0) {
    logAdminBootstrapAuthorizationCommand(authorizationContext)
    await ctx.reply(ADMIN_BOOTSTRAP_REPLY_TEXT)
    return true
  }

  await addToAccessList(ctx, 'admins', ctx.inbound.senderId)
  bootstrapTokens.delete(getBootstrapKey(authorizationContext))
  loggedBootstrapCommands.delete(getBootstrapKey(authorizationContext))
  await ctx.reply(`已完成授权：${ctx.inbound.senderId} 已加入管理员列表。`)
  return true
}

export const adminBootstrapMiddleware: ChannelMiddleware = async (ctx, next) => {
  if (hasChannelAdmins(ctx.config)) {
    await next()
    return
  }

  await ctx.inbound.ack?.().catch(() => undefined)
  const authorized = await tryAuthorizeFirstAdmin(ctx)
  if (!authorized) {
    logAdminBootstrapAuthorizationCommand(getAuthorizationContext(ctx))
    await ctx.reply(ADMIN_BOOTSTRAP_REPLY_TEXT)
  }
  await ctx.inbound.unack?.().catch(() => undefined)
}
