import { randomUUID } from 'node:crypto'

import type {
  ChannelConnection,
  ChannelConnectionOptions,
  ChannelEventHandlers,
  ChannelNavigationReference,
  ChannelWebhookResponse
} from '@oneworks/core/channel'
import { defineCreateChannelConnection } from '@oneworks/core/channel'

import type { OneWorksChannelConfig, OneWorksChannelMessage } from '#~/types.js'
import {
  createWebhookNonceReservation,
  isLoopbackRequest,
  isProductSimulationRequest,
  resolveSignedWebhook
} from '#~/webhook-auth.js'
import { normalizeInboundEvent } from './inbound.js'

export interface OneWorksOutboundMessage extends OneWorksChannelMessage {
  createdAt: number
  messageId: string
  updatedAt?: number
}

export interface OneWorksConnection extends ChannelConnection<OneWorksChannelMessage> {
  clearLocalOutboxMessages: () => void
  getLocalOutboxMessages: () => OneWorksOutboundMessage[]
}

const createWebhookResponse = (statusCode: number, body: Record<string, unknown>): ChannelWebhookResponse => ({
  body,
  statusCode
})

export const createChannelConnection = defineCreateChannelConnection(async (
  config: OneWorksChannelConfig,
  options?: ChannelConnectionOptions
): Promise<OneWorksConnection> => {
  let handlers: ChannelEventHandlers | undefined
  const outboundMessages: OneWorksOutboundMessage[] = []
  const logger = options?.logger
  const reserveWebhookNonce = createWebhookNonceReservation(options)
  const channelKey = options?.channelKey ?? 'default'
  const navigation: ChannelNavigationReference | undefined = config.serverBaseUrl == null
    ? undefined
    : { appHomeUrl: config.serverBaseUrl, embeddable: true }

  const persistOutbound = async (message: OneWorksOutboundMessage) => {
    await options?.outboundStore?.upsert({
      channelKey,
      channelType: 'oneworks',
      createdAt: message.createdAt,
      messageId: message.messageId,
      receiveId: message.receiveId,
      receiveIdType: message.receiveIdType,
      text: message.text,
      updatedAt: message.updatedAt
    })
  }

  return {
    sendMessage: async (message) => {
      const messageId = `oneworks-out-${randomUUID()}`
      const outbound = { ...message, createdAt: Date.now(), messageId }
      outboundMessages.push(outbound)
      await persistOutbound(outbound)
      await logger?.debug?.({
        channelType: 'oneworks',
        messageId,
        receiveId: message.receiveId,
        receiveIdType: message.receiveIdType
      }, '[oneworks-channel] outbound message recorded')
      return { messageId, ...(navigation != null ? { navigation } : {}) }
    },
    sendPrivateMessage: async ({ accountId, text }) => {
      const messageId = `oneworks-out-${randomUUID()}`
      const outbound = {
        createdAt: Date.now(),
        messageId,
        receiveId: accountId,
        receiveIdType: 'direct',
        text
      }
      outboundMessages.push(outbound)
      await persistOutbound(outbound)
      return { messageId, ...(navigation != null ? { navigation } : {}) }
    },
    updateMessage: async (messageId, message) => {
      const index = outboundMessages.findIndex(item => item.messageId === messageId)
      if (index >= 0) {
        outboundMessages[index] = {
          ...message,
          createdAt: outboundMessages[index]!.createdAt,
          messageId,
          updatedAt: Date.now()
        }
      } else {
        outboundMessages.push({ ...message, createdAt: Date.now(), messageId })
      }
      await persistOutbound(outboundMessages.find(item => item.messageId === messageId)!)
      return { messageId, ...(navigation != null ? { navigation } : {}) }
    },
    getLocalOutboxMessages: () => outboundMessages.map(message => ({ ...message })),
    clearLocalOutboxMessages: () => {
      outboundMessages.splice(0)
    },
    handleWebhook: async (request) => {
      const signed = resolveSignedWebhook(config, request) === true
      const insecureSimulation = !signed &&
        config.webhookSecret == null &&
        config.allowInsecureWebhooks === true &&
        isLoopbackRequest(request)
      const productSimulation = signed && isProductSimulationRequest(request)
      if (!signed && !insecureSimulation) {
        return createWebhookResponse(401, { error: 'unauthorized' })
      }

      if (handlers?.message == null) {
        return createWebhookResponse(503, { error: 'oneworks native channel is not receiving' })
      }

      const event = normalizeInboundEvent(
        request.body,
        productSimulation ? 'product_simulation' : insecureSimulation ? 'insecure_simulation' : 'native',
        navigation
      )
      if (event == null) {
        return createWebhookResponse(400, { error: 'invalid oneworks native channel payload' })
      }
      if (productSimulation && event.synthetic == null) {
        return createWebhookResponse(400, { error: 'product simulation metadata is required' })
      }

      const nonceReservation = signed ? await reserveWebhookNonce(request, Date.now()) : undefined
      if (signed && nonceReservation == null) {
        return createWebhookResponse(409, { error: 'replayed webhook' })
      }
      try {
        await handlers.message(event)
        await nonceReservation?.commit()
      } catch (error) {
        await nonceReservation?.release()
        throw error
      }
      return createWebhookResponse(200, {
        channelId: event.channelId,
        messageId: event.messageId,
        ok: true,
        sessionType: event.sessionType
      })
    },
    startReceiving: async ({ channelKey, handlers: nextHandlers }) => {
      handlers = nextHandlers
      await logger?.info?.({
        allowInsecureWebhooks: config.webhookSecret == null && config.allowInsecureWebhooks === true,
        channelKey,
        channelType: 'oneworks'
      }, '[oneworks-channel] native channel ready')
    },
    close: async () => {
      handlers = undefined
    }
  }
})
