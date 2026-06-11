import { defineChannel } from '@oneworks/core/channel'

import { wechatChannelConfigSchema, wechatChannelMessageSchema } from '#~/types.js'
import type { WechatChannelConfig, WechatChannelMessage } from '#~/types.js'

export const channelDefinition = defineChannel({
  type: 'wechat',
  label: 'WeChat',
  description: 'Receive WechatApi callbacks and reply through WechatApi.',
  configSchema: wechatChannelConfigSchema,
  messageSchema: wechatChannelMessageSchema
})

export type { WechatChannelConfig, WechatChannelMessage }

declare module '@oneworks/core/channel' {
  interface ChannelMap {
    wechat: Omit<WechatChannelConfig, 'type'>
  }
}
