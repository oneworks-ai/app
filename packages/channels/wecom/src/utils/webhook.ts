import type {
  ChannelEventHandlers,
  ChannelInboundEvent,
  ChannelLogger,
  ChannelWebhookRequest,
  ChannelWebhookResponse
} from '@oneworks/core/channel'

import type { WeComCallbackMessage, WeComChannelConfig } from '#~/types.js'

import { decryptWeComPayload, verifyWeComMessageSignature } from './callback-crypto'
import { getEncryptedBody } from './xml'

export interface CreateWeComWebhookHandlerOptions {
  config: WeComChannelConfig
  getHandlers: () => ChannelEventHandlers | undefined
  logger?: ChannelLogger
}

const getFirstString = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) return value[0]
  return value
}

const buildMessageId = (message: WeComCallbackMessage) => {
  const msgId = message.MsgId?.trim()
  if (msgId != null && msgId !== '') return msgId
  return [
    message.FromUserName,
    message.CreateTime,
    message.MsgType,
    message.Event
  ].filter((item): item is string => item != null && item !== '').join(':')
}

const normalizeWeComMessage = (message: WeComCallbackMessage): ChannelInboundEvent | undefined => {
  const msgType = message.MsgType?.trim()
  if (msgType !== 'text') return undefined

  const senderId = message.FromUserName?.trim()
  const content = message.Content?.trim()
  if (senderId == null || senderId === '' || content == null || content === '') return undefined

  return {
    channelType: 'wecom',
    sessionType: 'direct',
    channelId: senderId,
    senderId,
    messageId: buildMessageId(message),
    text: `[${senderId}]:\n${content}`,
    replyTo: {
      receiveId: senderId,
      receiveIdType: 'user'
    },
    raw: {
      message,
      contentItems: [{
        type: 'text',
        text: `[${senderId}]:\n${content}`
      }]
    }
  }
}

const handleWeComVerification = (
  config: WeComChannelConfig,
  request: ChannelWebhookRequest
): ChannelWebhookResponse => {
  const encrypted = getFirstString(request.query.echostr)
  const timestamp = getFirstString(request.query.timestamp)
  const nonce = getFirstString(request.query.nonce)
  const msgSignature = getFirstString(request.query.msg_signature)
  if (encrypted == null || encrypted === '') {
    return {
      statusCode: 400,
      body: { error: 'missing echostr' }
    }
  }

  if (!verifyWeComMessageSignature(config, { encrypted, msgSignature, nonce, timestamp })) {
    return {
      statusCode: 403,
      body: { error: 'invalid wecom signature' }
    }
  }

  return {
    statusCode: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8'
    },
    body: decryptWeComPayload(config, encrypted).messageXml
  }
}

const handleWeComPost = async (
  config: WeComChannelConfig,
  request: ChannelWebhookRequest,
  handlers: ChannelEventHandlers | undefined,
  logger?: ChannelLogger
): Promise<ChannelWebhookResponse> => {
  const encrypted = getEncryptedBody(request.rawBody ?? request.body)
  const timestamp = getFirstString(request.query.timestamp)
  const nonce = getFirstString(request.query.nonce)
  const msgSignature = getFirstString(request.query.msg_signature)
  if (encrypted == null || encrypted === '') {
    return {
      statusCode: 400,
      body: { error: 'missing Encrypt' }
    }
  }

  if (!verifyWeComMessageSignature(config, { encrypted, msgSignature, nonce, timestamp })) {
    return {
      statusCode: 403,
      body: { error: 'invalid wecom signature' }
    }
  }

  const decrypted = decryptWeComPayload(config, encrypted)
  const inbound = normalizeWeComMessage(decrypted.message)
  if (inbound != null) {
    await handlers?.message?.(inbound)
  } else {
    await logger?.debug?.({
      channelType: 'wecom',
      messageType: decrypted.message.MsgType,
      event: decrypted.message.Event
    }, '[wecom] ignored callback message')
  }

  return {
    statusCode: 200,
    body: ''
  }
}

export const createWeComWebhookHandler = (options: CreateWeComWebhookHandlerOptions) => (
  async (request: ChannelWebhookRequest): Promise<ChannelWebhookResponse> => {
    if (request.method.toUpperCase() === 'GET') {
      return handleWeComVerification(options.config, request)
    }

    if (request.method.toUpperCase() !== 'POST') {
      return {
        statusCode: 405,
        body: { error: 'method not allowed' }
      }
    }

    return await handleWeComPost(
      options.config,
      request,
      options.getHandlers(),
      options.logger
    )
  }
)
