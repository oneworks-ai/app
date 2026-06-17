import type { ChannelConnection, ChannelEventHandlers, ChannelLogger } from '@oneworks/core/channel'
import { defineCreateChannelConnection } from '@oneworks/core/channel'

import type { WeComChannelConfig, WeComChannelMessage } from '#~/types.js'

import { sendWeComMessage } from './utils/api'
import { createWeComWebhookHandler } from './utils/webhook'

export const createChannelConnection = defineCreateChannelConnection(async (
  config: WeComChannelConfig,
  options?: {
    logger?: ChannelLogger
  }
): Promise<ChannelConnection<WeComChannelMessage>> => {
  let handlers: ChannelEventHandlers | undefined
  const logger = options?.logger

  return {
    sendMessage: async message => await sendWeComMessage(config, message),
    handleWebhook: createWeComWebhookHandler({
      config,
      getHandlers: () => handlers,
      logger
    }),
    startReceiving: async ({ channelKey, handlers: nextHandlers }) => {
      handlers = nextHandlers
      if (config.enableWebhook === false) {
        await logger?.info?.({
          channelKey,
          channelType: 'wecom'
        }, '[wecom] webhook disabled by channel config')
        return
      }

      await logger?.info?.({
        channelKey,
        channelType: 'wecom'
      }, '[wecom] webhook ready')
    }
  }
})
