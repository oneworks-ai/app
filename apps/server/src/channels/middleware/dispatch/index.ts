import type { ChatMessageContent } from '@oneworks/core'
import type { ChannelInboundEvent } from '@oneworks/core/channel'
import {
  filterChannelEmojiRegistryEntries,
  listChannelEmojiRegistryEntries,
  sortChannelEmojiRegistryEntriesByRecent
} from '@oneworks/utils'
import type { ChannelEmojiRegistryEntry } from '@oneworks/utils'

import { resolveChannelMemoryRoot } from '#~/services/session/channel-context.js'
import { createSessionWithInitialMessage } from '#~/services/session/create.js'
import { processUserMessage, writeChannelMessageContext } from '#~/services/session/index.js'

import type { ChannelMiddleware } from '../@types'
import { stripSpeakerPrefix } from '../@utils'
import { syncChannelSessionBinding } from '../bind-session'
import { buildSessionSystemPrompt } from './prompt'

const buildChannelTags = (inbound: ChannelInboundEvent) => {
  if (inbound.sessionType === 'direct' && inbound.senderId) {
    return [`channel:${inbound.channelType}:direct:${inbound.senderId}`]
  }
  if (inbound.sessionType === 'group') {
    return [`channel:${inbound.channelType}:group:${inbound.channelId}`]
  }
  return []
}

const buildChannelMessageContext = (
  channelKey: string,
  inbound: ChannelInboundEvent
): Parameters<typeof writeChannelMessageContext>[1] => ({
  channelId: inbound.channelId,
  channelKey,
  channelType: inbound.channelType,
  messageId: inbound.messageId,
  replyReceiveId: inbound.replyTo?.receiveId,
  replyReceiveIdType: inbound.replyTo?.receiveIdType,
  senderId: inbound.senderId,
  sessionType: inbound.sessionType
})

const hasMultimodalContent = (contentItems: ChatMessageContent[] | undefined) =>
  contentItems?.some(item => item.type === 'image') === true

const EMOJI_MOOD_HINT_LIMIT = 6

const GROUP_DELIVERY_RUNTIME_REMINDER = [
  '',
  '<channel-delivery-reminder>',
  '群聊消息。普通 assistant 回复不会自动发送到群里；Chat History 是内部记录，不是群聊消息；外部可见回复/表情/文件必须用 `oneworks channel send` 或对应子命令。',
  '外显风格：闲聊/调侃/图片梗用短句或表情；被调侃别正经辩解，明确任务才认真。',
  '单条文本消息最多 200 个可见字符；不要发大段文本，复杂内容先压成短结论。',
  "多行文本使用 `oneworks channel send --br '第一段⏎⏎- 第二段'`，不要把真实换行直接塞进 Bash 命令。",
  '只发送最终答复/必要澄清；不要发送思考过程、工具日志或中间状态；完成或 stop 时只写内部短摘要，已发过就别复述；权限/fatal 由系统通知。',
  '</channel-delivery-reminder>'
].join('\n')

const resolveChannelMultimodalModel = (ctx: Parameters<ChannelMiddleware>[0]) => {
  if (!hasMultimodalContent(ctx.contentItems)) {
    return undefined
  }

  const model = ctx.config?.multimodalModel?.trim()
  return model == null || model === '' ? undefined : model
}

const truncateInline = (value: string, maxLength: number) => (
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`
)

const isEmojiMoodHintCandidate = (content: string | ChatMessageContent[]): boolean => {
  if (typeof content !== 'string') {
    return content.some(item => item.type === 'image' || (item.type === 'text' && isEmojiMoodHintCandidate(item.text)))
  }

  const text = stripSpeakerPrefix(content).trim()
  if (text === '' || text.startsWith('/')) return false
  return text.length <= 160
}

const isMeaningfulEmojiEntry = (entry: ChannelEmojiRegistryEntry) => (
  entry.label != null ||
  entry.note != null ||
  (entry.aliases?.length ?? 0) > 0 ||
  (entry.tags?.length ?? 0) > 0
)

const formatEmojiMoodEntry = (entry: ChannelEmojiRegistryEntry) => {
  const name = entry.label ?? entry.aliases?.[0] ?? entry.id
  const details = [
    entry.tags == null ? undefined : `tags=${entry.tags.slice(0, 4).join(',')}`,
    entry.note == null ? undefined : `note=${truncateInline(entry.note, 36)}`
  ].filter((item): item is string => item != null)

  return `- ${name}: \`oneworks channel emoji send ${entry.id} --platform ${entry.platform}\`${
    details.length === 0 ? '' : ` (${details.join('; ')})`
  }`
}

const buildEmojiMoodHint = async (
  inbound: ChannelInboundEvent,
  content: string | ChatMessageContent[]
) => {
  if (!isEmojiMoodHintCandidate(content)) return undefined

  const entries = await listChannelEmojiRegistryEntries(resolveChannelMemoryRoot(), inbound.channelType)
    .catch(() => [])
  const candidates = sortChannelEmojiRegistryEntriesByRecent(
    filterChannelEmojiRegistryEntries(entries, { sendable: true })
      .filter(isMeaningfulEmojiEntry)
  ).slice(0, EMOJI_MOOD_HINT_LIMIT)

  if (candidates.length === 0) return undefined
  return [
    '',
    '<channel-emoji-mood-hint>',
    '当前可发表情小抄（按聊天心情选，不是必须发；严肃任务可忽略）：',
    ...candidates.map(formatEmojiMoodEntry),
    '如果这轮是闲聊、接梗、调侃、贴图/图片反应或一句文本显得太硬，优先挑一个合适表情作为全部或部分外部回复。',
    '</channel-emoji-mood-hint>'
  ].join('\n')
}

const buildRuntimeContentForAgent = async (
  inbound: ChannelInboundEvent,
  content: string | ChatMessageContent[]
): Promise<string | ChatMessageContent[] | undefined> => {
  const emojiHint = await buildEmojiMoodHint(inbound, content)
  if (inbound.sessionType !== 'group' && emojiHint == null) {
    return undefined
  }

  const reminder = inbound.sessionType === 'group' ? GROUP_DELIVERY_RUNTIME_REMINDER : ''
  const runtimeText = `${reminder}${emojiHint ?? ''}`

  if (typeof content === 'string') {
    return `${content}${runtimeText}`
  }

  return [
    ...content,
    {
      type: 'text',
      text: runtimeText.trimStart()
    }
  ]
}

export const dispatchMiddleware: ChannelMiddleware = async (ctx, next) => {
  const { inbound, connection, config } = ctx
  const hasContent = ctx.contentItems != null && ctx.contentItems.length > 0
  const multimodalModel = resolveChannelMultimodalModel(ctx)
  const channelContext = buildChannelMessageContext(ctx.channelKey, inbound)
  const dispatchContent = hasContent ? ctx.contentItems! : inbound.text ?? ''
  const runtimeContent = await buildRuntimeContentForAgent(inbound, dispatchContent)

  if (!ctx.sessionId) {
    const systemPrompt = await buildSessionSystemPrompt(inbound, config, connection)
    const session = await createSessionWithInitialMessage({
      title: stripSpeakerPrefix(inbound.text ?? '').split('\n')[0],
      initialMessage: hasContent ? undefined : inbound.text,
      initialContent: hasContent ? ctx.contentItems : undefined,
      initialRuntimeContent: runtimeContent,
      shouldStart: true,
      adapter: ctx.channelAdapter,
      effort: ctx.channelEffort,
      model: multimodalModel,
      permissionMode: ctx.channelPermissionMode,
      tags: buildChannelTags(inbound),
      systemPrompt,
      channelContext,
      beforeStart: async (sessionId) => {
        syncChannelSessionBinding({
          channelKey: ctx.channelKey,
          inbound,
          sessionId
        })
        await writeChannelMessageContext(sessionId, channelContext)
      }
    })
    ctx.sessionId = session.id
  } else {
    await processUserMessage(
      ctx.sessionId,
      dispatchContent,
      {
        channelContext,
        ...(runtimeContent == null ? {} : { runtimeContent }),
        ...(multimodalModel == null ? {} : { model: multimodalModel })
      }
    )
  }

  await next()
}
