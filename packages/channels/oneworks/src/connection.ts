import { randomUUID } from 'node:crypto'

import type {
  ChannelConnection,
  ChannelConnectionOptions,
  ChannelEventHandlers,
  ChannelInboundEvent,
  ChannelWebhookResponse
} from '@oneworks/core/channel'
import { defineCreateChannelConnection } from '@oneworks/core/channel'

import { oneworksInboundWebhookSchema } from '#~/types.js'
import type { OneWorksChannelConfig, OneWorksChannelMessage } from '#~/types.js'
import { createWebhookNonceReservation, isLoopbackRequest, resolveSignedWebhook } from '#~/webhook-auth.js'

export interface OneWorksDebugOutboundMessage extends OneWorksChannelMessage {
  createdAt: number
  messageId: string
  updatedAt?: number
}

export interface OneWorksDebugConnection extends ChannelConnection<OneWorksChannelMessage> {
  clearDebugOutboundMessages: () => void
  getDebugOutboundMessages: () => OneWorksDebugOutboundMessage[]
}

const resolveChannelId = (payload: { channelId?: string; roomId?: string; senderId: string; threadId?: string }) =>
  payload.channelId ?? payload.roomId ?? payload.threadId ?? `direct:${payload.senderId}`

const resolveSessionType = (payload: { roomId?: string; sessionType?: 'direct' | 'group' }) =>
  payload.sessionType ?? (payload.roomId == null ? 'direct' : 'group')

const normalizeInboundEvent = (payload: unknown, synthetic: boolean): ChannelInboundEvent | undefined => {
  const parsed = oneworksInboundWebhookSchema.safeParse(payload)
  if (!parsed.success) return undefined

  const data = parsed.data
  const channelId = resolveChannelId(data)
  const sessionType = resolveSessionType(data)
  return {
    channelType: 'oneworks',
    sessionType,
    channelId,
    senderId: synthetic ? `oneworks-simulation:${data.senderId}` : data.senderId,
    messageId: data.messageId ?? `oneworks-in-${randomUUID()}`,
    text: data.text,
    threadId: data.threadId,
    replyTo: data.replyTo ?? {
      receiveId: channelId,
      receiveIdType: sessionType === 'group' ? 'room' : 'direct'
    },
    raw: {
      ...data,
      contentItems: data.contentItems,
      mentions: data.mentions,
      source: 'oneworks-native'
    }
  }
}

const createWebhookResponse = (statusCode: number, body: Record<string, unknown>): ChannelWebhookResponse => ({
  body,
  statusCode
})

export const createChannelConnection = defineCreateChannelConnection(async (
  config: OneWorksChannelConfig,
  options?: ChannelConnectionOptions
): Promise<OneWorksDebugConnection> => {
  let handlers: ChannelEventHandlers | undefined
  const outboundMessages: OneWorksDebugOutboundMessage[] = []
  const logger = options?.logger
  const reserveWebhookNonce = createWebhookNonceReservation(options)

  return {
    sendMessage: async (message) => {
      const messageId = `oneworks-out-${randomUUID()}`
      outboundMessages.push({ ...message, createdAt: Date.now(), messageId })
      await logger?.debug?.({
        channelType: 'oneworks',
        messageId,
        receiveId: message.receiveId,
        receiveIdType: message.receiveIdType
      }, '[oneworks-channel] outbound message recorded')
      return { messageId }
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
      return { messageId }
    },
    getDebugOutboundMessages: () => outboundMessages.map(message => ({ ...message })),
    clearDebugOutboundMessages: () => {
      outboundMessages.splice(0)
    },
    handleWebhook: async (request) => {
      const signed = resolveSignedWebhook(config, request) === true
      const insecureSimulation = !signed &&
        config.webhookSecret == null &&
        config.allowInsecureWebhooks === true &&
        isLoopbackRequest(request)
      if (!signed && !insecureSimulation) {
        return createWebhookResponse(401, { error: 'unauthorized' })
      }

      if (handlers?.message == null) {
        return createWebhookResponse(503, { error: 'oneworks native channel is not receiving' })
      }

      const event = normalizeInboundEvent(request.body, insecureSimulation)
      if (event == null) {
        return createWebhookResponse(400, { error: 'invalid oneworks native channel payload' })
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
