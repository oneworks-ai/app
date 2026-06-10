import { z } from 'zod'

import { channelBaseSchema } from '@oneworks/core/channel'

const channelTextMentionSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  platform: z.string().optional(),
  type: z.enum(['all', 'user']).optional()
})

export const wechatChannelConfigSchema = channelBaseSchema.extend({
  type: z
    .literal('wechat')
    .describe('频道类型'),
  token: z
    .string().min(1)
    .describe('WechatApi VideosApi-token'),
  appId: z
    .string().min(1).optional()
    .describe('WechatApi 设备 appId；未配置时会优先使用最近一次回调里的 Appid'),
  apiBaseUrl: z
    .string().url().optional()
    .describe('WechatApi API base URL，默认 http://api.wechatapi.net/finder/v2/api'),
  webhookSecret: z
    .string().min(1)
    .describe('公网 webhook secret；必须通过 query secret 或 header 校验'),
  autoRegisterCallback: z
    .boolean().optional()
    .describe('启动频道时是否调用 WechatApi /login/setCallback 自动设置回调地址，默认 true'),
  autoReconnectOnStart: z
    .boolean().optional()
    .describe('启动频道时是否调用 WechatApi /login/reconnection 重连 appId，默认 false'),
  callbackToken: z
    .string().min(1).optional()
    .describe('调用 /login/setCallback body.token；默认复用 token')
})

export const wechatToolCallSummarySchema = z.object({
  title: z.string().optional(),
  items: z.array(z.object({
    toolUseId: z.string().min(1),
    name: z.string().min(1),
    status: z.enum(['pending', 'success', 'error']),
    argsText: z.string().optional(),
    resultText: z.string().optional(),
    detailUrl: z.string().optional(),
    exportJsonUrl: z.string().optional()
  })).min(1)
})

export const wechatChannelMessageSchema = z.object({
  mentions: z.array(channelTextMentionSchema).optional().describe(
    'Optional text mentions. WeChat maps these to postText ats; content must still include visible @ text.'
  ),
  receiveId: z.string().min(1).describe('接收方 wxid 或群 ID'),
  receiveIdType: z.string().min(1).describe('接收方类型，WechatApi 会忽略该字段'),
  text: z.string().min(1).describe('消息文本'),
  toolCallSummary: wechatToolCallSummarySchema.optional()
})

export type WechatChannelConfig = z.infer<typeof wechatChannelConfigSchema>
export type WechatChannelMessage = z.infer<typeof wechatChannelMessageSchema>

export interface WechatStringField {
  string?: string
}

export interface WechatCallbackPayload {
  TypeName?: string
  Appid?: string
  Wxid?: string
  Data?: {
    [key: string]: unknown
    MsgId?: string | number
    NewMsgId?: string | number
    MsgType?: string | number
    FromUserName?: WechatStringField
    ToUserName?: WechatStringField
    Content?: WechatStringField
    PushContent?: string
    ImgBuf?: unknown
    CreateTime?: string | number
  }
}

export interface WechatPostTextResponse {
  ret?: number
  msg?: string
  data?: {
    msgId?: number
    newMsgId?: number
  }
}

export interface WechatPostMediaResponse {
  ret?: number
  msg?: string
  data?: {
    createTime?: number | null
    msgId?: number
    newMsgId?: number
    toWxid?: string
    type?: number | null
  }
}

export interface WechatDownloadImageResponse {
  ret?: number
  msg?: string
  data?: {
    fileUrl?: string
  }
}

export interface WechatChatroomMember {
  wxid?: string
  userName?: string
  nickName?: string | null
  displayName?: string | null
  memberFlag?: number | null
}

export interface WechatChatroomMemberListResponse {
  ret?: number
  msg?: string
  data?: {
    memberList?: WechatChatroomMember[]
    chatroomOwner?: string
    adminWxid?: string[]
  }
}
