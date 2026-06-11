import type { ChatMessageContent } from '@oneworks/core'

import { logger } from '#~/utils/logger.js'

import type { ChannelContext, ChannelMiddleware } from './@types'

const DEFAULT_GROUP_MESSAGE_DEBOUNCE_MS = 1200
const MAX_GROUP_MESSAGE_DEBOUNCE_MS = 30000

interface BufferedGroupMessage {
  commandText: string
  messageId?: string
  senderId?: string
  text: string
  ts: number
}

interface GroupMessageDebounceBucket {
  ctx: ChannelContext
  key: string
  messages: BufferedGroupMessage[]
  next: () => Promise<void>
  timer: ReturnType<typeof setTimeout>
}

const buckets = new Map<string, GroupMessageDebounceBucket>()

const getCommandPrefix = (ctx: ChannelContext) => {
  const prefix = ctx.config?.commandPrefix?.trim()
  return prefix == null || prefix === '' ? '/' : prefix
}

const isSlashCommand = (ctx: ChannelContext) => ctx.commandText.trimStart().startsWith(getCommandPrefix(ctx))

const hasNonTextContent = (ctx: ChannelContext) => (
  ctx.contentItems?.some(item => item.type !== 'text') === true
)

const resolveGroupMessageDebounceMs = (ctx: ChannelContext) => {
  const configured = ctx.config?.groupMessageDebounceMs
  if (typeof configured === 'number' && Number.isFinite(configured)) {
    return Math.min(Math.max(Math.trunc(configured), 0), MAX_GROUP_MESSAGE_DEBOUNCE_MS)
  }
  return DEFAULT_GROUP_MESSAGE_DEBOUNCE_MS
}

const buildDebounceKey = (ctx: ChannelContext) =>
  [
    ctx.channelKey,
    ctx.inbound.channelType,
    ctx.inbound.sessionType,
    ctx.inbound.channelId,
    ctx.sessionId ?? ''
  ].join(':')

const getBufferedMessage = (ctx: ChannelContext): BufferedGroupMessage => ({
  commandText: ctx.commandText,
  messageId: ctx.inbound.messageId,
  senderId: ctx.inbound.senderId,
  text: ctx.inbound.text ?? '',
  ts: Date.now()
})

const toMergedTextContent = (text: string): ChatMessageContent[] => [{ type: 'text', text }]

const mergeBufferedMessagesIntoContext = (ctx: ChannelContext, messages: BufferedGroupMessage[]) => {
  const mergedText = messages
    .map(message => message.text)
    .filter(text => text.trim() !== '')
    .join('\n\n')
  const mergedCommandText = messages
    .map(message => message.commandText.trim())
    .filter(Boolean)
    .join('\n\n')
  const latest = messages[messages.length - 1]
  const contentItems = toMergedTextContent(mergedText)
  const raw = typeof ctx.inbound.raw === 'object' && ctx.inbound.raw != null && !Array.isArray(ctx.inbound.raw)
    ? ctx.inbound.raw
    : {}

  ctx.inbound = {
    ...ctx.inbound,
    messageId: latest?.messageId ?? ctx.inbound.messageId,
    senderId: latest?.senderId ?? ctx.inbound.senderId,
    text: mergedText,
    raw: {
      ...raw,
      contentItems,
      debouncedMessages: messages.map(message => ({
        messageId: message.messageId,
        senderId: message.senderId,
        ts: message.ts
      }))
    }
  }
  ctx.commandText = mergedCommandText
  ctx.contentItems = contentItems
}

const flushBucket = async (key: string) => {
  const bucket = buckets.get(key)
  if (bucket == null) return
  buckets.delete(key)

  mergeBufferedMessagesIntoContext(bucket.ctx, bucket.messages)
  await bucket.next()
}

const scheduleBucket = (bucket: GroupMessageDebounceBucket, debounceMs: number) => {
  bucket.timer = setTimeout(() => {
    void flushBucket(bucket.key).catch((error) => {
      logger.error({
        channelKey: bucket.ctx.channelKey,
        channelType: bucket.ctx.inbound.channelType,
        channelId: bucket.ctx.inbound.channelId,
        sessionType: bucket.ctx.inbound.sessionType,
        error: error instanceof Error ? error.message : String(error)
      }, '[channel] Failed to flush debounced group messages')
    })
  }, debounceMs)
  ;(bucket.timer as { unref?: () => void }).unref?.()
}

export const clearGroupMessageDebounceStateForTests = () => {
  for (const bucket of buckets.values()) {
    clearTimeout(bucket.timer)
  }
  buckets.clear()
}

export const groupMessageDebounceMiddleware: ChannelMiddleware = async (ctx, next) => {
  if (
    ctx.inbound.sessionType !== 'group' ||
    isSlashCommand(ctx) ||
    hasNonTextContent(ctx) ||
    (ctx.inbound.text?.trim() ?? '') === ''
  ) {
    await next()
    return
  }

  const debounceMs = resolveGroupMessageDebounceMs(ctx)
  if (debounceMs <= 0) {
    await next()
    return
  }

  const key = buildDebounceKey(ctx)
  const existing = buckets.get(key)
  if (existing != null) {
    clearTimeout(existing.timer)
    existing.ctx = ctx
    existing.next = next
    existing.messages.push(getBufferedMessage(ctx))
    scheduleBucket(existing, debounceMs)
    return
  }

  const bucket: GroupMessageDebounceBucket = {
    ctx,
    key,
    messages: [getBufferedMessage(ctx)],
    next,
    timer: setTimeout(() => undefined, 0)
  }
  clearTimeout(bucket.timer)
  buckets.set(key, bucket)
  scheduleBucket(bucket, debounceMs)
}
