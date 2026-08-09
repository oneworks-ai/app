import type { ChannelCommandRunSource } from '#~/db/index.js'

import type { ChannelContext, ChannelMiddleware } from '../@types'
import { hasExplicitChannelIntent } from '../@utils'
import type { CommandParseSuccess } from './command-system'
import { parseCommandString } from './command-system'
import { ensureSharedMessagesRegistered } from './messages'
import { getAllCommands, getPrefix, listRegisteredChannelCommandTools } from './registry'
import { executeParsedCommand } from './runner'
import { parseChannelCommandToolInput } from './tools'
import { splitCommand } from './utils'

export const listChannelCommandTools = (options: { prefix?: string } = {}) => listRegisteredChannelCommandTools(options)

const formatParseError = (ctx: ChannelContext, prefix: string, message: string, usage?: string) => {
  if (!usage) {
    return `${message}\n${ctx.t('system.helpHint').replace('{prefix}', prefix)}`
  }
  return `${message}\n${ctx.t('label.usage')}：${usage}`
}

const handleCommand = async (ctx: ChannelContext) => {
  const prefix = getPrefix(ctx)
  const parsed = parseCommandString(getAllCommands(), ctx.commandText, { t: ctx.t, prefix })

  if (!parsed.ok) {
    if (parsed.code === 'unknown-command') return false
    await ctx.reply(formatParseError(ctx, prefix, parsed.message, parsed.usage))
    return true
  }

  await executeParsedCommand(ctx, parsed, { source: 'slash' })
  return true
}

const canHandleGroupCommand = (ctx: ChannelContext) => {
  if (ctx.inbound.sessionType !== 'group' || ctx.channelLink == null) return true

  const ingress = ctx.channelLink.ingress
  return hasExplicitChannelIntent({
    commandText: ctx.commandText,
    config: ctx.config,
    createOnCommand: ingress?.createOnCommand,
    createOnMention: ingress?.createOnMention,
    mentionedBot: ctx.inbound.mentionedBot,
    mentionPatterns: ingress?.mentionPatterns,
    text: ctx.inbound.text
  })
}

export const invokeChannelCommandTool = async (
  ctx: ChannelContext,
  toolName: string,
  input: Record<string, unknown> = {},
  options: {
    replyOnError?: boolean
    source?: Exclude<ChannelCommandRunSource, 'slash'>
  } = {}
) => {
  ensureSharedMessagesRegistered(ctx)
  const prefix = getPrefix(ctx)
  const parsed = parseChannelCommandToolInput(getAllCommands(), toolName, input, { prefix })

  if (!parsed.ok) {
    if (options.replyOnError === true) {
      await ctx.reply(formatParseError(ctx, prefix, parsed.message, parsed.usage))
    }
    return parsed
  }

  return await executeParsedCommand(
    ctx,
    parsed as CommandParseSuccess<ChannelContext>,
    {
      source: options.source ?? 'natural_language',
      metadata: {
        actorAuthority: 'sender',
        toolName
      }
    }
  )
}

export const channelCommandMiddleware: ChannelMiddleware = async (ctx, next) => {
  ensureSharedMessagesRegistered(ctx)
  const prefix = getPrefix(ctx)
  const command = splitCommand(ctx.commandText)[0] ?? ''
  if (command === '' || !command.startsWith(prefix)) {
    await next()
    return
  }
  if (!canHandleGroupCommand(ctx)) {
    await next()
    return
  }

  await ctx.inbound.ack?.().catch(() => undefined)
  const handled = await handleCommand(ctx).catch(async (error) => {
    console.error('[channels] command execution failed:', error)
    await ctx.reply(ctx.t('system.executionFailed'))
    return true
  })
  await ctx.inbound.unack?.().catch(() => undefined)

  if (!handled) await next()
}
