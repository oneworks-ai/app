import { defineChannel } from '@oneworks/core/channel'

import { telegramChannelConfigSchema, telegramChannelMessageSchema } from '#~/types.js'
import type { TelegramChannelConfig, TelegramChannelMessage } from '#~/types.js'

export const channelDefinition = defineChannel({
  type: 'telegram',
  label: 'Telegram',
  description: 'Receive Telegram Bot API webhooks and reply through Telegram Bot API.',
  configSchema: telegramChannelConfigSchema,
  messageSchema: telegramChannelMessageSchema
})

export type { TelegramChannelConfig, TelegramChannelMessage }

declare module '@oneworks/core/channel' {
  interface ChannelMap {
    telegram: Omit<TelegramChannelConfig, 'type'>
  }
}
