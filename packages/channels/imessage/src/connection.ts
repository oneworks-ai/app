import type { ChannelConnection, ChannelLogger } from '@oneworks/core/channel'
import { defineCreateChannelConnection } from '@oneworks/core/channel'

import type { ImessageChannelConfig, ImessageChannelMessage } from '#~/types.js'

import { sendImessageMessage } from './send'

export const createChannelConnection = defineCreateChannelConnection(async (
  config: ImessageChannelConfig,
  options?: {
    logger?: ChannelLogger
  }
): Promise<ChannelConnection<ImessageChannelMessage>> => {
  const logger = options?.logger

  return {
    sendMessage: async (message) => await sendImessageMessage(config, message),
    startReceiving: async ({ channelKey }) => {
      await logger?.info?.({
        channelKey,
        channelType: 'imessage'
      }, '[imessage] outbound-only macOS Messages bridge ready; inbound receiving is not enabled')
    },
    generateSystemPrompt: async () => [
      'iMessage channel runs through a local macOS Messages automation bridge.',
      'It can send outbound messages only from this Mac after the user grants Automation permission.',
      'It does not provide a cloud webhook or reliable background inbound listener.'
    ].join('\n')
  }
})
