import {
  buildChannelResumeRuntimeContent,
  listNextMessageChannelResumeIntents
} from '#~/services/channel-resume/index.js'
import type { ChannelResumeIntent } from '#~/services/channel-resume/index.js'

import type { ChannelMiddleware } from '../@types'

const listNextMessageResumeIntentsForActor = (
  ctx: Parameters<ChannelMiddleware>[0],
  input: { conversationStateId: string; threadKey: string }
) => {
  const filters: Parameters<typeof listNextMessageChannelResumeIntents>[0][] = []
  const actorUserId = ctx.actor?.user?.id
  if (actorUserId != null && actorUserId.trim() !== '') {
    filters.push({
      channelType: ctx.inbound.channelType,
      conversationStateId: input.conversationStateId,
      ownerUserId: actorUserId,
      threadKey: input.threadKey
    })
  }

  const actorAccountId = ctx.actor?.account.accountId ?? ctx.inbound.senderId
  if (actorAccountId != null && actorAccountId.trim() !== '') {
    filters.push({
      channelType: ctx.inbound.channelType,
      conversationStateId: input.conversationStateId,
      ownerAccountId: actorAccountId,
      threadKey: input.threadKey
    })
  }

  const seen = new Set<string>()
  return filters
    .flatMap(filter => listNextMessageChannelResumeIntents(filter))
    .filter(item => {
      if (seen.has(item.intent.id)) return false
      seen.add(item.intent.id)
      return true
    })
}

const selectNextMessageResumesForSession = (
  items: ChannelResumeIntent[],
  sessionId: string | undefined
) => {
  const targetSessionId = sessionId ?? items[0]?.resume.sessionId
  if (targetSessionId == null) return { items: [], sessionId }
  return {
    items: items.filter(item => item.resume.sessionId === targetSessionId),
    sessionId: targetSessionId
  }
}

const buildNextMessageResumeRuntimeText = (items: readonly ChannelResumeIntent[]) => {
  if (items.length === 0) return undefined
  return [
    '<channel-next-message-resume>',
    '本轮消息命中了等待下一条相关消息继续的 pending intent。',
    ...items.map(item => buildChannelResumeRuntimeContent(item.intent, item.resume)),
    '</channel-next-message-resume>'
  ].join('\n')
}

export const prepareNextMessageResumes = (
  ctx: Parameters<ChannelMiddleware>[0],
  input: { conversationStateId: string; threadKey: string }
) => {
  const candidates = listNextMessageResumeIntentsForActor(ctx, input)
  const selected = selectNextMessageResumesForSession(candidates, ctx.sessionId)
  if (ctx.sessionId == null && selected.items.length > 0) {
    ctx.sessionId = selected.sessionId
  }
  return {
    items: selected.items,
    runtimeText: buildNextMessageResumeRuntimeText(selected.items)
  }
}
