import type { ChannelInboundEvent } from '@oneworks/core/channel'

import type { QQGuildMessageData, QQPayload, QQValidationData } from '#~/types.js'

interface NormalizedQQMessage {
  channelId: string
  eventId?: string
  messageId: string
  receiveId: string
  receiveIdType: 'channel_id' | 'guild_id'
  senderId?: string
  sessionType: 'direct' | 'group'
  text: string
}

const QQ_WEBHOOK_DISPATCH_OPCODE = 0
const SUPPORTED_CHANNEL_MESSAGE_EVENTS = new Set([
  'AT_MESSAGE_CREATE',
  'MESSAGE_CREATE',
  'DIRECT_MESSAGE_CREATE'
])

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

export const asQQPayload = (body: unknown): QQPayload | undefined => {
  if (!isRecord(body)) return undefined
  return body as QQPayload
}

export const asValidationData = (value: unknown): QQValidationData | undefined => {
  if (!isRecord(value)) return undefined
  return value as QQValidationData
}

const asGuildMessageData = (value: unknown): QQGuildMessageData | undefined => {
  if (!isRecord(value)) return undefined
  return value as QQGuildMessageData
}

const normalizeContent = (value: string | undefined) => value?.replace(/<@!?\d+>/gu, '').trim() ?? ''

const buildSenderLabel = (message: QQGuildMessageData) => {
  const senderId = message.author?.id
  const username = message.author?.username?.trim()
  if (senderId == null || senderId === '') return username
  if (username == null || username === '' || username === senderId) return senderId
  return `${senderId} (${username})`
}

export const normalizeQQChannelMessage = (payload: QQPayload): NormalizedQQMessage | null => {
  if (payload.op !== QQ_WEBHOOK_DISPATCH_OPCODE || payload.t == null) return null
  if (!SUPPORTED_CHANNEL_MESSAGE_EVENTS.has(payload.t)) return null

  const data = asGuildMessageData(payload.d)
  const messageId = data?.id
  const content = normalizeContent(data?.content)
  if (data == null || messageId == null || messageId === '' || content === '') return null

  const senderId = data.author?.id
  const senderLabel = buildSenderLabel(data) ?? senderId ?? 'unknown'
  const text = `[${senderLabel}]:\n${content}`

  if (payload.t === 'DIRECT_MESSAGE_CREATE') {
    if (data.guild_id == null || data.guild_id === '') return null
    return {
      channelId: data.guild_id,
      eventId: payload.id,
      messageId,
      receiveId: data.guild_id,
      receiveIdType: 'guild_id',
      senderId,
      sessionType: 'direct',
      text
    }
  }

  if (data.channel_id == null || data.channel_id === '') return null
  return {
    channelId: data.channel_id,
    eventId: payload.id,
    messageId,
    receiveId: data.channel_id,
    receiveIdType: 'channel_id',
    senderId,
    sessionType: 'group',
    text
  }
}

export const toInboundEvent = (
  message: NormalizedQQMessage,
  payload: QQPayload
): ChannelInboundEvent => ({
  channelType: 'qq-channel',
  sessionType: message.sessionType,
  channelId: message.channelId,
  senderId: message.senderId,
  messageId: message.messageId,
  text: message.text,
  replyTo: {
    receiveId: message.receiveId,
    receiveIdType: message.receiveIdType
  },
  raw: {
    payload,
    eventId: message.eventId,
    msgId: message.messageId
  }
})

export const getPayloadLogContext = (payload: QQPayload) => ({
  eventId: payload.id,
  op: payload.op,
  seq: payload.s,
  type: payload.t
})
