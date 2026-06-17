import { z } from 'zod'

import { channelBaseSchema } from '@oneworks/core/channel'

export const qqChannelConfigSchema = channelBaseSchema.extend({
  type: z
    .literal('qq-channel')
    .describe('频道类型'),
  appId: z
    .string().min(1)
    .describe('QQ 机器人 AppID'),
  appSecret: z
    .string().min(1)
    .describe('QQ 机器人 AppSecret / Bot Secret'),
  apiBaseUrl: z
    .string().url().optional()
    .describe('QQ OpenAPI base URL，默认 https://api.sgroup.qq.com；沙箱可配置 https://sandbox.api.sgroup.qq.com'),
  accessTokenUrl: z
    .string().url().optional()
    .describe('QQ AccessToken 获取地址，默认 https://bots.qq.com/app/getAppAccessToken'),
  verifyWebhookSignature: z
    .boolean().optional()
    .describe('是否校验 QQ webhook Ed25519 签名，默认 true'),
  verifyWebhookAppId: z
    .boolean().optional()
    .describe('是否校验 X-Bot-Appid 与 appId 一致，默认 true')
})

export const qqChannelMessageSchema = z.object({
  receiveId: z.string().min(1).describe('接收方 ID；文字子频道为 channel_id，频道私信为 guild_id'),
  receiveIdType: z.enum(['channel_id', 'guild_id']).describe('接收方类型'),
  text: z.string().min(1).describe('消息文本'),
  msgId: z.string().min(1).optional().describe('前置用户消息 ID，用于 QQ 被动回复'),
  eventId: z.string().min(1).optional().describe('前置事件 ID，用于 QQ 被动回复'),
  msgSeq: z.number().int().min(1).optional().describe('同一 msg_id 的回复序号，避免重复回复')
})

export type QQChannelConfig = z.infer<typeof qqChannelConfigSchema>
export type QQChannelMessage = z.infer<typeof qqChannelMessageSchema>
export type QQChannelReceiveIdType = QQChannelMessage['receiveIdType']

export interface QQAccessTokenResponse {
  access_token?: string
  expires_in?: number | string
  code?: number
  message?: string
}

export interface QQSendMessageResponse {
  id?: string
  timestamp?: string | number
  code?: number
  message?: string
}

export interface QQPayload<TData = unknown> {
  id?: string
  op?: number
  d?: TData
  s?: number
  t?: string
}

export interface QQValidationData {
  plain_token?: string
  event_ts?: string
}

export interface QQMessageAuthor {
  avatar?: string
  bot?: boolean
  id?: string
  username?: string
}

export interface QQGuildMessageData {
  author?: QQMessageAuthor
  channel_id?: string
  content?: string
  guild_id?: string
  id?: string
  member?: unknown
  seq?: number
  timestamp?: string
}
