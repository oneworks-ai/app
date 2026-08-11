import type { ChannelExecutionContext } from '@oneworks/core'
import type { ChannelBaseConfig, ChannelInboundEvent } from '@oneworks/core/channel'

import { buildChannelRuntimeSystemPrompt } from '#~/services/session/channel-context.js'

export const buildChannelContextPrompt = (
  inbound: ChannelInboundEvent,
  config: ChannelBaseConfig | undefined,
  executionContext?: ChannelExecutionContext
): string | undefined => {
  const lines: string[] = []

  // Channel platform context
  const channelLabel = inbound.channelType === 'lark' ? '飞书（Lark）' : inbound.channelType
  lines.push(`你正在通过 ${channelLabel} 频道进行对话。`)

  // Bot's display name on this channel
  const botName = config?.title
  if (botName) {
    lines.push(`你在此频道上的名字是「${botName}」。`)
  }

  if (inbound.synthetic?.kind === 'product_simulation') {
    const roleLabel = inbound.synthetic.actorRole === 'admin' ? '管理员' : '参与者'
    lines.push(
      `这是来自 OneWorks 聊天室的受信任场景模拟，模拟用户为「${inbound.synthetic.userLabel}」，场景角色为「${roleLabel}」。`,
      '该场景角色只用于模拟对话上下文，不授予任何真实权限；所有操作仍按当前调用者和频道权限检查。'
    )
  }

  // Admin identities
  const admins = config?.access?.admins
  if (admins && admins.length > 0) {
    lines.push(`以下用户 ID 是本频道的管理员：${admins.join('、')}。`)
  }

  const runtimePrompt = buildChannelRuntimeSystemPrompt({
    channelId: inbound.channelId,
    channelType: inbound.channelType,
    messageId: inbound.messageId,
    replyReceiveId: inbound.replyTo?.receiveId,
    replyReceiveIdType: inbound.replyTo?.receiveIdType,
    senderId: inbound.senderId,
    sessionType: inbound.sessionType,
    executionContext
  })
  if (runtimePrompt != null) {
    lines.push(runtimePrompt)
  }

  return lines.join('\n')
}
