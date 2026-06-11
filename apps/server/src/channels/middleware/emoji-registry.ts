import { normalizeChannelEmojiRegistryEntry, upsertChannelEmojiRegistryEntry } from '@oneworks/utils'
import type { ChannelEmojiRegistryEntry } from '@oneworks/utils'

import { resolveChannelMemoryRoot } from '#~/services/session/channel-context.js'
import { logger } from '#~/utils/logger.js'

import type { ChannelMiddleware } from './@types'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const getRawEmojis = (raw: unknown) => {
  if (!isRecord(raw) || !Array.isArray(raw.emojis)) return []
  return raw.emojis
}

export const emojiRegistryMiddleware: ChannelMiddleware = async (ctx, next) => {
  const emojis = getRawEmojis(ctx.inbound.raw)
    .map(emoji =>
      normalizeChannelEmojiRegistryEntry({
        ...(isRecord(emoji) ? emoji : {}),
        platform: isRecord(emoji) && typeof emoji.platform === 'string' ? emoji.platform : ctx.inbound.channelType,
        source: {
          channelId: ctx.inbound.channelId,
          channelKey: ctx.channelKey,
          channelType: ctx.inbound.channelType,
          messageId: ctx.inbound.messageId,
          senderId: ctx.inbound.senderId,
          sessionType: ctx.inbound.sessionType
        }
      })
    )
    .filter((emoji): emoji is ChannelEmojiRegistryEntry => emoji != null)

  if (emojis.length > 0) {
    const root = resolveChannelMemoryRoot()
    for (const emoji of emojis) {
      await upsertChannelEmojiRegistryEntry(root, emoji)
    }
    logger.info({
      channelKey: ctx.channelKey,
      channelType: ctx.inbound.channelType,
      emojiCount: emojis.length,
      platforms: Array.from(new Set(emojis.map(emoji => emoji.platform)))
    }, '[channel] registered inbound emoji references')
  }

  await next()
}
