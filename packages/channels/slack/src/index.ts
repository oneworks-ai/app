import { defineChannel } from '@oneworks/core/channel'

import { slackChannelConfigSchema, slackChannelMessageSchema } from '#~/types.js'
import type { SlackChannelConfig, SlackChannelMessage } from '#~/types.js'

export const channelDefinition = defineChannel({
  type: 'slack',
  label: 'Slack',
  description: 'Receive Slack Socket Mode messages and reply through Slack Web API.',
  configSchema: slackChannelConfigSchema,
  messageSchema: slackChannelMessageSchema
})

export type { SlackChannelConfig, SlackChannelMessage }

declare module '@oneworks/core/channel' {
  interface ChannelMap {
    slack: Omit<SlackChannelConfig, 'type'>
  }
}
