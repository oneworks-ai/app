import { z } from 'zod'

import { channelBaseSchema } from '@oneworks/core/channel'

export const wecomReceiveIdTypeSchema = z.enum(['user', 'party', 'tag', 'all', 'appchat'])

export const wecomChannelConfigSchema = channelBaseSchema.extend({
  type: z
    .literal('wecom')
    .describe('频道类型'),
  corpId: z
    .string().min(1)
    .describe('企业微信企业 ID（corpid）'),
  corpSecret: z
    .string().min(1)
    .describe('企业微信自建应用 Secret，用于获取 access_token'),
  agentId: z
    .number().int().positive()
    .describe('企业微信自建应用 AgentId'),
  token: z
    .string().min(1)
    .describe('企业微信接收消息 API 的 Token，用于校验 msg_signature'),
  encodingAesKey: z
    .string().length(43)
    .describe('企业微信接收消息 API 的 EncodingAESKey'),
  apiBaseUrl: z
    .string().url().optional()
    .describe('企业微信 API base URL，默认 https://qyapi.weixin.qq.com')
})

export const wecomChannelMessageSchema = z.object({
  receiveId: z.string().min(1).describe('接收方 ID；user/party/tag 可用 | 分隔多个值，all 会被映射为 @all'),
  receiveIdType: wecomReceiveIdTypeSchema.describe(
    '接收方类型：user/party/tag/all 使用应用消息，appchat 使用应用群聊消息'
  ),
  text: z.string().min(1).describe('消息文本'),
  msgtype: z.enum(['text', 'markdown']).optional().describe('企业微信消息类型，默认 text'),
  safe: z.union([z.literal(0), z.literal(1)]).optional().describe('是否保密消息，默认 0'),
  enableDuplicateCheck: z.boolean().optional().describe('是否开启企业微信重复消息检查'),
  duplicateCheckInterval: z.number().int().min(1).max(14_400).optional().describe('重复消息检查时间间隔，单位秒')
})

export type WeComChannelConfig = z.infer<typeof wecomChannelConfigSchema>
export type WeComChannelMessage = z.infer<typeof wecomChannelMessageSchema>
export type WeComReceiveIdType = z.infer<typeof wecomReceiveIdTypeSchema>

export interface WeComAccessTokenResponse {
  access_token?: string
  errcode?: number
  errmsg?: string
  expires_in?: number
}

export interface WeComSendMessageResponse {
  errcode?: number
  errmsg?: string
  invalidparty?: string
  invalidtag?: string
  invaliduser?: string
  msgid?: string
  response_code?: string
  unlicenseduser?: string
}

export interface WeComAppChatSendResponse {
  errcode?: number
  errmsg?: string
}

export interface WeComCallbackMessage {
  AgentID?: string
  Content?: string
  CreateTime?: string
  Event?: string
  FromUserName?: string
  MsgId?: string
  MsgType?: string
  ToUserName?: string
}
