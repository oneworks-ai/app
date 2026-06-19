import { defineChannel } from '@oneworks/core/channel'

import { imessageChannelConfigSchema, imessageChannelMessageSchema } from '#~/types.js'
import type { ImessageChannelConfig, ImessageChannelMessage } from '#~/types.js'

export const channelDefinition = defineChannel({
  type: 'imessage',
  label: 'iMessage',
  description: 'Send Messages locally on macOS through the user-authorized Messages automation bridge.',
  configSchema: imessageChannelConfigSchema,
  messageSchema: imessageChannelMessageSchema
})

export type { ImessageChannelConfig, ImessageChannelMessage }

declare module '@oneworks/core/channel' {
  interface ChannelMap {
    imessage: Omit<ImessageChannelConfig, 'type'>
  }
}
