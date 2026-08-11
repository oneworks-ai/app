import type { ChannelExecutionContext, ChatMessageContent } from '@oneworks/core'
import type { ChannelInboundEvent } from '@oneworks/core/channel'

import { getDb } from '#~/db/index.js'
import type { writeChannelMessageContext } from '#~/services/session/index.js'

import type { ChannelMiddleware } from '../@types'
import { stripSpeakerPrefix } from '../@utils'

export { buildChannelExecutionContext, projectInboundMessageToRoom } from './execution-context'

const THREAD_SEGMENT_MAX_LENGTH = 120

const toThreadSegment = (value: string | undefined, fallback: string) => {
  const trimmed = value?.trim()
  const source = trimmed == null || trimmed === '' ? fallback : trimmed
  return source.replace(/[^\w.-]+/gu, '_').slice(0, THREAD_SEGMENT_MAX_LENGTH)
}

export const buildChannelTags = (inbound: ChannelInboundEvent) => {
  if (inbound.sessionType === 'direct' && inbound.senderId) {
    return [`channel:${inbound.channelType}:direct:${inbound.senderId}`]
  }
  if (inbound.sessionType === 'group') {
    return [`channel:${inbound.channelType}:group:${inbound.channelId}`]
  }
  return []
}

export const buildChannelMessageContext = (
  ctx: Parameters<ChannelMiddleware>[0],
  runtime: {
    childRunId?: string
    conversationStateId?: string
    executionContext?: ChannelExecutionContext
    threadKey?: string
  } = {}
): Parameters<typeof writeChannelMessageContext>[1] => ({
  actorAccountId: ctx.actor?.account.accountId ?? ctx.inbound.senderId,
  actorUserId: ctx.actor?.user?.id,
  channelId: ctx.inbound.channelId,
  channelKey: ctx.channelKey,
  channelLinkName: ctx.channelLink?.name,
  channelType: ctx.inbound.channelType,
  childRunId: runtime.childRunId,
  conversationStateId: runtime.conversationStateId,
  entity: ctx.channelLink?.entity,
  executionContext: runtime.executionContext,
  messageId: ctx.inbound.messageId,
  replyReceiveId: ctx.inbound.replyTo?.receiveId,
  replyReceiveIdType: ctx.inbound.replyTo?.receiveIdType,
  senderId: ctx.inbound.senderId,
  sessionType: ctx.inbound.sessionType,
  threadId: ctx.inbound.threadId,
  threadKey: runtime.threadKey
})

export const resolveChannelThread = (ctx: Parameters<ChannelMiddleware>[0]) => {
  const entitySegment = toThreadSegment(ctx.channelLink?.entity ?? ctx.channelKey, 'default')
  const threadId = ctx.inbound.threadId ?? ctx.inbound.rootMessageId
  if (threadId != null && threadId.trim() !== '') {
    return {
      reason: 'platform_reply',
      threadKey: `reply:thread:${toThreadSegment(threadId, 'unknown')}`
    }
  }
  const replyMessageId = ctx.inbound.replyMessageId
  if (replyMessageId != null && replyMessageId.trim() !== '') {
    const state = getDb().getChannelConversationStateByLastBotReply({
      channelId: ctx.inbound.channelId,
      channelKey: ctx.channelKey,
      channelType: ctx.inbound.channelType,
      entity: ctx.channelLink?.entity,
      messageId: replyMessageId
    })
    if (state != null) {
      return { reason: 'reply_to_bot', threadKey: state.threadKey }
    }
  }
  if (ctx.inbound.sessionType === 'direct') {
    return {
      reason: 'direct_entity',
      threadKey: `direct:${entitySegment}:${toThreadSegment(ctx.inbound.channelId, 'direct')}`
    }
  }

  const actorSegment = toThreadSegment(
    ctx.actor?.user?.id ?? ctx.actor?.account.accountId ?? ctx.inbound.senderId,
    'anonymous'
  )
  return {
    reason: 'group_entity_actor',
    threadKey: `group:${entitySegment}:actor:${actorSegment}`
  }
}

export const ensureDispatchConversation = (
  ctx: Parameters<ChannelMiddleware>[0],
  thread: ReturnType<typeof resolveChannelThread>
) =>
  getDb().ensureChannelConversationState({
    channelId: ctx.inbound.channelId,
    channelKey: ctx.channelKey,
    channelLinkName: ctx.channelLink?.name,
    channelType: ctx.inbound.channelType,
    entity: ctx.channelLink?.entity,
    metadata: {
      resolver: 'deterministic-v1',
      threadReason: thread.reason
    },
    sessionType: ctx.inbound.sessionType,
    threadKey: thread.threadKey
  })

export const summarizeDispatchContent = (content: string | ChatMessageContent[]) => {
  if (typeof content === 'string') {
    return stripSpeakerPrefix(content).trim().slice(0, 1000)
  }
  return content
    .map(item => item.type === 'text' ? item.text : `[${item.type}]`)
    .join('\n')
    .trim()
    .slice(0, 1000)
}
