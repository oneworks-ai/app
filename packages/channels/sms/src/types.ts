import { z } from 'zod'

import { channelBaseSchema } from '@oneworks/core/channel'

export const smsChannelConfigSchema = channelBaseSchema.extend({
  type: z
    .literal('sms')
    .describe('频道类型'),
  accountSid: z
    .string().min(1)
    .describe('Twilio Account SID'),
  authToken: z
    .string().min(1)
    .describe('Twilio Auth Token'),
  fromNumber: z
    .string().min(1)
    .describe('Twilio 发送号码，E.164 格式'),
  apiBaseUrl: z
    .string().url().optional()
    .describe('Twilio API base URL，默认 https://api.twilio.com/2010-04-01'),
  webhookUrl: z
    .string().url().optional()
    .describe('Twilio 控制台配置的完整 webhook URL；未配置时用 serverBaseUrl 和 channelKey 推导'),
  verifyWebhookSignature: z
    .boolean().optional()
    .describe('是否校验 X-Twilio-Signature，默认 true')
})

export const smsToolCallSummarySchema = z.object({
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

export const smsChannelMessageSchema = z.object({
  receiveId: z.string().min(1).describe('接收方手机号，E.164 格式'),
  receiveIdType: z.literal('phone').describe('SMS 接收方类型'),
  text: z.string().min(1).describe('短信文本'),
  toolCallSummary: smsToolCallSummarySchema.optional().describe('Optional OneWorks tool-call summary metadata')
})

export type SmsChannelConfig = z.infer<typeof smsChannelConfigSchema>
export type SmsChannelMessage = z.infer<typeof smsChannelMessageSchema>
export type SmsToolCallSummary = z.infer<typeof smsToolCallSummarySchema>

export interface TwilioSendMessageResponse {
  error_code?: string | number | null
  error_message?: string | null
  message?: string
  sid?: string
}
