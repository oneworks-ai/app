import { defineChannel } from '@oneworks/core/channel'

import { wecomChannelConfigSchema, wecomChannelMessageSchema } from '#~/types.js'
import type { WeComChannelConfig, WeComChannelMessage, WeComReceiveIdType } from '#~/types.js'

export const channelDefinition = defineChannel({
  type: 'wecom',
  label: '企业微信',
  description: 'Receive WeCom enterprise application callbacks and reply through WeCom application messages.',
  configSchema: wecomChannelConfigSchema,
  messageSchema: wecomChannelMessageSchema
})

export type { WeComChannelConfig, WeComChannelMessage, WeComReceiveIdType }

declare module '@oneworks/core/channel' {
  interface ChannelMap {
    wecom: Omit<WeComChannelConfig, 'type'>
  }
}
