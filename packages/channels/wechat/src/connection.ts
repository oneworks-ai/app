import type { ChannelConnection, ChannelEventHandlers, ChannelLogger } from '@oneworks/core/channel'
import { defineCreateChannelConnection } from '@oneworks/core/channel'

import type { WechatChannelConfig, WechatChannelMessage } from '#~/types.js'

import {
  buildCallbackUrl,
  reconnectWechatAccount,
  redactCallbackUrl,
  registerCallback,
  sendWechatEmojiMessage,
  sendWechatMediaMessage,
  sendWechatTextMessage
} from './utils/api'
import { createWechatWebhookHandler } from './utils/webhook'

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

export const createChannelConnection = defineCreateChannelConnection(async (
  config: WechatChannelConfig,
  options?: {
    logger?: ChannelLogger
  }
): Promise<ChannelConnection<WechatChannelMessage>> => {
  let handlers: ChannelEventHandlers | undefined
  const appIdsByReceiveId = new Map<string, string>()
  const logger = options?.logger

  return {
    sendMessage: async (message) => await sendWechatTextMessage(config, appIdsByReceiveId, message, logger),
    sendEmojiMessage: async (message) => await sendWechatEmojiMessage(config, appIdsByReceiveId, message, logger),
    sendMediaMessage: async (message) => await sendWechatMediaMessage(config, appIdsByReceiveId, message, logger),
    handleWebhook: createWechatWebhookHandler({
      appIdsByReceiveId,
      config,
      getHandlers: () => handlers,
      logger
    }),
    startReceiving: async ({ channelKey, handlers: nextHandlers }) => {
      handlers = nextHandlers
      if (config.enableWebhook === false) {
        await logger?.info?.({
          channelKey,
          channelType: 'wechat'
        }, '[wechat] webhook disabled by channel config')
        return
      }

      if (channelKey == null) return

      const callbackUrl = buildCallbackUrl(config, channelKey)
      if (callbackUrl == null) {
        await logger?.info?.({
          channelKey,
          channelType: 'wechat'
        }, '[wechat] webhook ready; configure server public endpoint or channel serverBaseUrl to derive callback URL')
        return
      }

      await logger?.info?.({
        channelKey,
        channelType: 'wechat',
        callbackUrl: redactCallbackUrl(callbackUrl)
      }, '[wechat] webhook ready')

      if (config.autoReconnectOnStart === true || config.autoRegisterCallback !== false) {
        void (async () => {
          const appId = config.appId?.trim()
          if (config.autoReconnectOnStart === true) {
            if (appId == null || appId === '') {
              await logger?.warn?.({
                channelKey,
                channelType: 'wechat'
              }, '[wechat] account reconnection skipped because appId is missing')
            } else {
              try {
                await reconnectWechatAccount(config, appId)
                await logger?.info?.({
                  appId,
                  channelKey,
                  channelType: 'wechat'
                }, '[wechat] account reconnected')
              } catch (error) {
                await logger?.error?.({
                  appId,
                  channelKey,
                  channelType: 'wechat',
                  error: getErrorMessage(error)
                }, '[wechat] account reconnection failed')
              }
            }
          }

          if (config.autoRegisterCallback === false) return

          try {
            await registerCallback(config, callbackUrl)
            await logger?.info?.({
              channelKey,
              channelType: 'wechat',
              callbackUrl: redactCallbackUrl(callbackUrl)
            }, '[wechat] callback registered')
          } catch (error) {
            await logger?.error?.({
              channelKey,
              channelType: 'wechat',
              error: getErrorMessage(error)
            }, '[wechat] callback registration failed')
          }
        })()
      }
    }
  }
})
