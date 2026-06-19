import { defineChannel } from '@oneworks/core/channel'

import { discordChannelConfigSchema, discordChannelMessageSchema } from '#~/types.js'
import type { DiscordChannelConfig, DiscordChannelMessage } from '#~/types.js'

export const channelDefinition = defineChannel({
  type: 'discord',
  label: 'Discord',
  description: 'Receive Discord Gateway messages and reply through Discord REST API.',
  configSchema: discordChannelConfigSchema,
  messageSchema: discordChannelMessageSchema
})

export type { DiscordChannelConfig, DiscordChannelMessage }

declare module '@oneworks/core/channel' {
  interface ChannelMap {
    discord: Omit<DiscordChannelConfig, 'type'>
  }
}
