import { defineChannel } from '@oneworks/core/channel'

import { qqChannelConfigSchema, qqChannelMessageSchema } from '#~/types.js'
import type { QQChannelConfig, QQChannelMessage } from '#~/types.js'

export const channelDefinition = defineChannel({
  type: 'qq-channel',
  label: 'QQ Channel',
  description: 'Receive official QQ Bot channel webhooks and reply through QQ Bot OpenAPI.',
  configSchema: qqChannelConfigSchema,
  messageSchema: qqChannelMessageSchema
})

export type { QQChannelConfig, QQChannelMessage }

declare module '@oneworks/core/channel' {
  interface ChannelMap {
    'qq-channel': Omit<QQChannelConfig, 'type'>
  }
}
