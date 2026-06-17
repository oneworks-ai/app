import type {
  ChannelEventHandlers,
  ChannelLogger,
  ChannelWebhookRequest,
  ChannelWebhookResponse
} from '@oneworks/core/channel'

import type { QQChannelConfig } from '#~/types.js'

import {
  asQQPayload,
  asValidationData,
  getPayloadLogContext,
  normalizeQQChannelMessage,
  toInboundEvent
} from './payload'
import { signQQWebhookValidation, verifyQQWebhookAppId, verifyQQWebhookSignature } from './signature'

interface CreateQQWebhookHandlerOptions {
  config: QQChannelConfig
  logger?: ChannelLogger
  getHandlers: () => ChannelEventHandlers | undefined
}

const QQ_WEBHOOK_VALIDATION_OPCODE = 13

const ackWebhookResponse = (): ChannelWebhookResponse => ({
  statusCode: 200,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: { op: 12 }
})

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

export const createQQChannelWebhookHandler = ({
  config,
  getHandlers,
  logger
}: CreateQQWebhookHandlerOptions) =>
async (
  request: ChannelWebhookRequest
): Promise<ChannelWebhookResponse> => {
  const payload = asQQPayload(request.body)
  if (payload == null) {
    await logger?.warn?.({
      channelType: 'qq-channel',
      bodyType: request.body == null ? 'nullish' : typeof request.body
    }, '[qq-channel] ignored webhook because payload is invalid')
    return {
      statusCode: 400,
      body: { error: 'invalid webhook payload' }
    }
  }

  if (!verifyQQWebhookAppId(config, request)) {
    return {
      statusCode: 403,
      body: { error: 'invalid webhook appid' }
    }
  }

  if (payload.op === QQ_WEBHOOK_VALIDATION_OPCODE) {
    const validation = asValidationData(payload.d)
    if (validation?.plain_token == null || validation.event_ts == null) {
      return {
        statusCode: 400,
        body: { error: 'invalid webhook validation payload' }
      }
    }

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: {
        plain_token: validation.plain_token,
        signature: signQQWebhookValidation(config.appSecret, {
          eventTs: validation.event_ts,
          plainToken: validation.plain_token
        })
      }
    }
  }

  if (!verifyQQWebhookSignature(config, request)) {
    return {
      statusCode: 403,
      body: { error: 'invalid webhook signature' }
    }
  }

  const message = normalizeQQChannelMessage(payload)
  if (message == null) {
    await logger?.info?.({
      channelType: 'qq-channel',
      ...getPayloadLogContext(payload)
    }, '[qq-channel] ignored webhook because payload is not a supported QQ Channel message')
    return ackWebhookResponse()
  }

  const inbound = toInboundEvent(message, payload)
  await logger?.info?.({
    channelType: 'qq-channel',
    channelId: inbound.channelId,
    sessionType: inbound.sessionType,
    senderId: inbound.senderId,
    messageId: inbound.messageId,
    receiveId: message.receiveId,
    receiveIdType: message.receiveIdType,
    textLength: message.text.length
  }, '[qq-channel] received inbound webhook')

  void Promise.resolve(getHandlers()?.message?.(inbound)).catch((error) => {
    void logger?.error?.({
      channelType: 'qq-channel',
      channelId: inbound.channelId,
      messageId: inbound.messageId,
      error: getErrorMessage(error)
    }, '[qq-channel] failed to handle inbound webhook message')
  })

  return ackWebhookResponse()
}
