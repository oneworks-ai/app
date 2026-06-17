import { z } from 'zod'

import { channelBaseSchema } from '@oneworks/core/channel'

export const imessageServiceTypeSchema = z.enum(['iMessage', 'SMS', 'RCS'])
export const imessageReceiveIdTypeSchema = z.enum(['handle', 'participant', 'chat', 'chat_id'])

export const imessageChannelConfigSchema = channelBaseSchema.extend({
  type: z
    .literal('imessage')
    .describe('频道类型'),
  accountId: z
    .string().min(1).optional()
    .describe('Messages account id；未配置时使用第一个匹配 serviceType 的账号'),
  serviceType: imessageServiceTypeSchema
    .optional()
    .describe('Messages service type，默认 iMessage；SMS/RCS 需要用户明确选择'),
  defaultReceiveIdType: z
    .enum(['handle', 'chat']).optional()
    .describe('当通用 CLI 默认传入 chat_id 时采用的接收方类型，默认 handle'),
  osascriptPath: z
    .string().min(1).optional()
    .describe('osascript 可执行文件路径，默认 osascript'),
  sendTimeoutMs: z
    .number().int().min(1000).max(120000).optional()
    .describe('AppleScript 发送超时时间，默认 30000ms'),
  inboundMode: z
    .literal('disabled').optional()
    .describe('入站监听模式；当前仅支持 disabled，避免伪装不稳定的 iMessage 后台收信能力')
})

export const imessageChannelMessageSchema = z.object({
  receiveId: z.string().min(1).describe('接收方 phone/email handle，或 Messages chat id'),
  receiveIdType: imessageReceiveIdTypeSchema.optional().describe(
    '接收方类型：handle/participant 表示联系人 handle；chat 表示 Messages chat id；通用 chat_id 默认按 handle 处理'
  ),
  text: z.string().min(1).describe('消息文本')
})

export type ImessageServiceType = z.infer<typeof imessageServiceTypeSchema>
export type ImessageReceiveIdType = z.infer<typeof imessageReceiveIdTypeSchema>
export type ImessageChannelConfig = z.infer<typeof imessageChannelConfigSchema>
export type ImessageChannelMessage = z.infer<typeof imessageChannelMessageSchema>
