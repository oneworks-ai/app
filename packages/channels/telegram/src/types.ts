import { z } from 'zod'

import { channelBaseSchema } from '@oneworks/core/channel'

export const telegramChannelConfigSchema = channelBaseSchema.extend({
  type: z
    .literal('telegram')
    .describe('频道类型'),
  botToken: z
    .string().min(1)
    .describe('Telegram Bot API token'),
  botUsername: z
    .string().min(1).optional()
    .describe('Telegram bot username without @, used to strip /command@bot suffixes'),
  apiBaseUrl: z
    .string().url().optional()
    .describe('Telegram Bot API base URL. Defaults to https://api.telegram.org'),
  webhookSecret: z
    .string().min(1).optional()
    .describe('Optional webhook secret checked from query secret or Telegram secret token header'),
  autoSetWebhook: z
    .boolean().optional()
    .describe('Call setWebhook on startup when serverBaseUrl is available. Default false.')
})

export const telegramToolCallSummarySchema = z.object({
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

export const telegramChannelMessageSchema = z.object({
  receiveId: z.string().min(1).describe('Telegram chat id, optionally encoded with #thread= and #reply='),
  receiveIdType: z.literal('chat_id').describe('Telegram receive target type'),
  text: z.string().min(1).describe('Message text'),
  messageThreadId: z.number().int().positive().optional().describe('Forum topic message_thread_id override'),
  replyMessageId: z.number().int().positive().optional().describe('Message id to reply to'),
  toolCallSummary: telegramToolCallSummarySchema.optional().describe('Optional OneWorks tool-call summary metadata')
})

export type TelegramChannelConfig = z.infer<typeof telegramChannelConfigSchema>
export type TelegramChannelMessage = z.infer<typeof telegramChannelMessageSchema>
export type TelegramToolCallSummary = z.infer<typeof telegramToolCallSummarySchema>

export interface TelegramUpdate {
  update_id?: number
  message?: TelegramMessage
  edited_message?: TelegramMessage
}

export interface TelegramMessage {
  message_id?: number
  message_thread_id?: number
  chat?: {
    id?: number | string
    type?: string
    title?: string
    username?: string
  }
  from?: {
    id?: number | string
    is_bot?: boolean
    first_name?: string
    last_name?: string
    username?: string
  }
  text?: string
  caption?: string
  sticker?: {
    emoji?: string
    set_name?: string
    file_id?: string
  }
  document?: {
    file_id?: string
    file_name?: string
    mime_type?: string
  }
  photo?: Array<{
    file_id?: string
    width?: number
    height?: number
  }>
}

export interface TelegramApiResponse<T = unknown> {
  ok?: boolean
  description?: string
  result?: T
}

export interface TelegramSendMessageResult {
  message_id?: number
}
