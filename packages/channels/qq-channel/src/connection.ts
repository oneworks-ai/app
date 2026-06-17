import type { ChannelConnection, ChannelEventHandlers, ChannelLogger } from '@oneworks/core/channel'
import { defineCreateChannelConnection } from '@oneworks/core/channel'

import type { QQChannelConfig, QQChannelMessage } from '#~/types.js'

import { sendQQChannelTextMessage } from './utils/api'
import { createQQChannelWebhookHandler } from './utils/webhook'

export const createChannelConnection = defineCreateChannelConnection(async (
  config: QQChannelConfig,
  options?: {
    logger?: ChannelLogger
  }
): Promise<ChannelConnection<QQChannelMessage>> => {
  let handlers: ChannelEventHandlers | undefined
  const logger = options?.logger

  return {
    sendMessage: async (message) => await sendQQChannelTextMessage(config, message, logger),
    handleWebhook: createQQChannelWebhookHandler({
      config,
      getHandlers: () => handlers,
      logger
    }),
    startReceiving: async ({ channelKey, handlers: nextHandlers }) => {
      handlers = nextHandlers
      if (config.enableWebhook === false) {
        await logger?.info?.({
          channelKey,
          channelType: 'qq-channel'
        }, '[qq-channel] webhook disabled by channel config')
        return
      }

      await logger?.info?.({
        channelKey,
        channelType: 'qq-channel',
        webhookPath: channelKey == null ? undefined : `/channels/qq-channel/${encodeURIComponent(channelKey)}/webhook`
      }, '[qq-channel] webhook ready')
    }
  }
})
