import type { ChannelContext } from '../@types'
import { getInboundAccessChannelId } from '../@utils'
import { defineMessages } from '../i18n'
import { addToAccessList, removeFromAccessList, updateChannelConfig } from './access'
import { command, optionalArg, requiredArg } from './command-system'
import { dedupe } from './utils'

defineMessages('zh', {
  'cmd.silent.description': '静默当前或指定 channel session，使其不能通过 oneworks channel 主动发送消息',
  'cmd.unsilent.description': '解除当前或指定 channel session 的静默，允许它通过 oneworks channel 主动发送消息',
  'cmd.stop.description': '停止接收当前群聊消息，后续普通消息会被拦截',
  'cmd.start.description': '恢复接收当前群聊消息',
  'cmd.ban.description': '屏蔽指定发送者，后续消息不会进入会话上下文',
  'channelControl.groupOnly': '该指令只支持在群聊中使用。',
  'channelControl.sessionMismatch': ({ current, target }) =>
    `当前频道绑定的是会话 ${current}，不能操作另一个会话 ${target}。`,
  'channelControl.silent.noSession': '当前频道没有可静默的会话，请传入 sessionId。',
  'channelControl.silent.success': ({ sessionId }) =>
    `已静默会话 ${sessionId}，它不能再通过 oneworks channel 主动发送频道消息。`,
  'channelControl.unsilent.noSession': '当前频道没有可解除静默的会话，请传入 sessionId。',
  'channelControl.unsilent.success': ({ sessionId }) =>
    `已解除静默会话 ${sessionId}，它可以继续通过 oneworks channel 主动发送频道消息。`,
  'channelControl.stop.success': ({ groupId }) =>
    `已停止接收当前群聊 ${groupId} 的普通消息。管理员仍可发送 /start 恢复。`,
  'channelControl.start.success': ({ groupId }) => `已恢复接收当前群聊 ${groupId} 的消息。`,
  'channelControl.ban.invalid': '请传入要屏蔽的 senderId，支持带 @ 前缀。',
  'channelControl.ban.success': ({ senderId }) => `已屏蔽发送者 ${senderId}，后续消息会被过滤。`
})

defineMessages('en', {
  'cmd.silent.description': 'Silence the current or specified channel session so it cannot send with oneworks channel',
  'cmd.unsilent.description': 'Unsilence the current or specified channel session so it can send with oneworks channel',
  'cmd.stop.description': 'Stop receiving normal messages from the current group chat',
  'cmd.start.description': 'Resume receiving messages from the current group chat',
  'cmd.ban.description': 'Ban a sender so future messages are filtered before session context',
  'channelControl.groupOnly': 'This command only works in group chats.',
  'channelControl.sessionMismatch': ({ current, target }) =>
    `This channel is bound to session ${current}; cannot operate on another session ${target}.`,
  'channelControl.silent.noSession': 'No session is available to silence. Pass a sessionId.',
  'channelControl.silent.success': ({ sessionId }) =>
    `Session ${sessionId} is now silent and cannot send channel messages through oneworks channel.`,
  'channelControl.unsilent.noSession': 'No session is available to unsilence. Pass a sessionId.',
  'channelControl.unsilent.success': ({ sessionId }) =>
    `Session ${sessionId} is no longer silent and can send channel messages through oneworks channel.`,
  'channelControl.stop.success': ({ groupId }) =>
    `Stopped receiving normal messages from group ${groupId}. Admins can still send /start to resume.`,
  'channelControl.start.success': ({ groupId }) => `Resumed receiving messages from group ${groupId}.`,
  'channelControl.ban.invalid': 'Pass the senderId to ban. A leading @ is accepted.',
  'channelControl.ban.success': ({ senderId }) => `Sender ${senderId} is banned and future messages will be filtered.`
})

const trimNonEmpty = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const addSilentSession = async (ctx: ChannelContext, sessionId: string) => {
  await updateChannelConfig(ctx, current => ({
    ...current,
    silentSessions: dedupe([...(current.silentSessions ?? []), sessionId])
  }))
}

const removeSilentSession = async (ctx: ChannelContext, sessionId: string) => {
  await updateChannelConfig(ctx, current => {
    const nextSilentSessions = (current.silentSessions ?? []).filter(item => item !== sessionId)
    const nextConfig = { ...current }
    if (nextSilentSessions.length > 0) {
      nextConfig.silentSessions = nextSilentSessions
    } else {
      delete nextConfig.silentSessions
    }
    return nextConfig
  })
}

const normalizeBanTarget = (value: string) => {
  const trimmed = value.trim()
  const idAttr = trimmed.match(/\b(?:id|user_id|userId|wxid|open_id|openId)=["']([^"']+)["']/u)?.[1]
  if (idAttr != null && idAttr.trim() !== '') return idAttr.trim()

  return trimmed
    .replace(/^<at\b[^>]*>/iu, '')
    .replace(/<\/at>$/iu, '')
    .replace(/^@+/u, '')
    .trim()
}

const ensureGroupChat = async (ctx: ChannelContext) => {
  if (ctx.inbound.sessionType === 'group') return true
  await ctx.reply(ctx.t('channelControl.groupOnly'))
  return false
}

const ensureCurrentSessionTarget = async (ctx: ChannelContext, targetSessionId: string | undefined) => {
  if (targetSessionId == null || ctx.sessionId == null || targetSessionId === ctx.sessionId) return true
  await ctx.reply(ctx.t('channelControl.sessionMismatch', {
    current: ctx.sessionId,
    target: targetSessionId
  }))
  return false
}

export const channelControlCommands = () => [
  command<ChannelContext>('silent')
    .description('cmd.silent.description')
    .adminOnly()
    .argument(optionalArg('sessionId'))
    .action(async ({ ctx, args: [sessionIdArg] }) => {
      const sessionId = trimNonEmpty(sessionIdArg) ?? ctx.sessionId
      if (sessionId == null) {
        await ctx.reply(ctx.t('channelControl.silent.noSession'))
        return
      }

      await addSilentSession(ctx, sessionId)
      await ctx.reply(ctx.t('channelControl.silent.success', { sessionId }))
    }),

  command<ChannelContext>('unsilent')
    .description('cmd.unsilent.description')
    .adminOnly()
    .argument(optionalArg('sessionId'))
    .action(async ({ ctx, args: [sessionIdArg] }) => {
      const sessionId = trimNonEmpty(sessionIdArg) ?? ctx.sessionId
      if (sessionId == null) {
        await ctx.reply(ctx.t('channelControl.unsilent.noSession'))
        return
      }

      await removeSilentSession(ctx, sessionId)
      await ctx.reply(ctx.t('channelControl.unsilent.success', { sessionId }))
    }),

  command<ChannelContext>('stop')
    .description('cmd.stop.description')
    .adminOnly()
    .argument(optionalArg('sessionId'))
    .action(async ({ ctx, args: [sessionIdArg] }) => {
      const targetSessionId = trimNonEmpty(sessionIdArg)
      const isGroupChat = await ensureGroupChat(ctx)
      const isCurrentSession = await ensureCurrentSessionTarget(ctx, targetSessionId)
      if (!isGroupChat || !isCurrentSession) return

      const groupId = getInboundAccessChannelId(ctx.inbound)
      await addToAccessList(ctx, 'blockedGroups', groupId)
      await ctx.reply(ctx.t('channelControl.stop.success', { groupId }))
    }),

  command<ChannelContext>('start')
    .description('cmd.start.description')
    .adminOnly()
    .argument(optionalArg('sessionId'))
    .action(async ({ ctx, args: [sessionIdArg] }) => {
      const targetSessionId = trimNonEmpty(sessionIdArg)
      const isGroupChat = await ensureGroupChat(ctx)
      const isCurrentSession = await ensureCurrentSessionTarget(ctx, targetSessionId)
      if (!isGroupChat || !isCurrentSession) return

      const groupId = getInboundAccessChannelId(ctx.inbound)
      await removeFromAccessList(ctx, 'blockedGroups', groupId)
      await ctx.reply(ctx.t('channelControl.start.success', { groupId }))
    }),

  command<ChannelContext>('ban')
    .description('cmd.ban.description')
    .adminOnly()
    .argument(requiredArg('senderId'))
    .action(async ({ ctx, args: [rawSenderId] }) => {
      const senderId = normalizeBanTarget(rawSenderId as string)
      if (senderId === '') {
        await ctx.reply(ctx.t('channelControl.ban.invalid'))
        return
      }

      await addToAccessList(ctx, 'blockedSenders', senderId)
      await ctx.reply(ctx.t('channelControl.ban.success', { senderId }))
    })
]
