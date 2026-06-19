import { defineChannel } from '@oneworks/core/channel'

import { smsChannelConfigSchema, smsChannelMessageSchema } from '#~/types.js'
import type { SmsChannelConfig, SmsChannelMessage } from '#~/types.js'

export const channelDefinition = defineChannel({
  type: 'sms',
  label: 'SMS',
  description: 'Receive Twilio SMS webhooks and reply through the Twilio Messages REST API.',
  configSchema: smsChannelConfigSchema,
  messageSchema: smsChannelMessageSchema
})

export type { SmsChannelConfig, SmsChannelMessage }

declare module '@oneworks/core/channel' {
  interface ChannelMap {
    sms: Omit<SmsChannelConfig, 'type'>
  }
}
