import { defineChannel } from '@oneworks/core/channel'

import { oneworksChannelConfigSchema, oneworksChannelMessageSchema } from '#~/types.js'
import type { OneWorksChannelConfig, OneWorksChannelMessage } from '#~/types.js'

export const channelDefinition = defineChannel({
  type: 'oneworks',
  label: 'OneWorks',
  description: 'OneWorks native channel for product rooms, demos, and local simulation.',
  configSchema: oneworksChannelConfigSchema,
  messageSchema: oneworksChannelMessageSchema
})

export type { OneWorksChannelConfig, OneWorksChannelMessage }

declare module '@oneworks/core/channel' {
  interface ChannelMap {
    oneworks: Omit<OneWorksChannelConfig, 'type'>
  }
}
