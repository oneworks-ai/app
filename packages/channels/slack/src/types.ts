import { z } from 'zod'

import { channelBaseSchema } from '@oneworks/core/channel'

export const slackChannelConfigSchema = channelBaseSchema.extend({
  type: z
    .literal('slack')
    .describe('频道类型'),
  botToken: z
    .string().min(1)
    .describe('Slack Bot User OAuth Token, starts with xoxb-'),
  appToken: z
    .string().min(1)
    .describe('Slack Socket Mode app-level token, starts with xapp-'),
  botUserId: z
    .string().min(1).optional()
    .describe('Slack bot user id. If omitted, auth.test is used when receiving starts.'),
  respondToAllChannelMessages: z
    .boolean().optional()
    .describe('Respond to every non-bot channel message. Default only handles DMs, @mentions, and thread replies.')
})

export const slackToolCallSummarySchema = z.object({
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

export const slackChannelMessageSchema = z.object({
  receiveId: z.string().min(1).describe('Slack channel id, optionally encoded as C123#thread=1700000000.000000'),
  receiveIdType: z.literal('channel').describe('Slack receive target type'),
  text: z.string().min(1).describe('Message text'),
  threadTs: z.string().min(1).optional().describe('Slack thread_ts override'),
  toolCallSummary: slackToolCallSummarySchema.optional().describe('Optional OneWorks tool-call summary metadata')
})

export type SlackChannelConfig = z.infer<typeof slackChannelConfigSchema>
export type SlackChannelMessage = z.infer<typeof slackChannelMessageSchema>
export type SlackToolCallSummary = z.infer<typeof slackToolCallSummarySchema>

export interface SlackApiResponse {
  ok?: boolean
  error?: string
  channel?: string
  ts?: string
  url?: string
  user_id?: string
  bot_id?: string
  file?: {
    id?: string
  }
}

export interface SlackSocketEnvelope {
  envelope_id?: string
  type?: string
  payload?: {
    type?: string
    event?: SlackMessageEvent
  }
}

export interface SlackMessageEvent {
  type?: string
  subtype?: string
  channel?: string
  channel_type?: string
  user?: string
  bot_id?: string
  text?: string
  ts?: string
  thread_ts?: string
  files?: unknown[]
  attachments?: unknown[]
}
