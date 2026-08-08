import { z } from 'zod'

import { channelBaseSchema } from '@oneworks/core/channel'

export const discordChannelConfigSchema = channelBaseSchema.extend({
  type: z
    .literal('discord')
    .describe('频道类型'),
  botToken: z
    .string().min(1)
    .describe('Discord bot token'),
  botUserId: z
    .string().min(1).optional()
    .describe('Discord bot user id for mention detection'),
  gatewayUrl: z
    .string().url().optional()
    .describe('Discord Gateway URL. Defaults to wss://gateway.discord.gg/?v=10&encoding=json'),
  apiBaseUrl: z
    .string().url().optional()
    .describe('Discord REST API base URL. Defaults to https://discord.com/api/v10'),
  respondToAllGuildMessages: z
    .boolean().optional()
    .describe('Respond to every guild channel message. Default only handles DMs, @mentions, and / commands.')
})

export const discordToolCallSummarySchema = z.object({
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

export const discordChannelMessageSchema = z.object({
  receiveId: z.string().min(1).describe('Discord channel id'),
  receiveIdType: z.literal('channel').describe('Discord receive target type'),
  text: z.string().min(1).describe('Message text'),
  toolCallSummary: discordToolCallSummarySchema.optional().describe('Optional OneWorks tool-call summary metadata')
})

export type DiscordChannelConfig = z.infer<typeof discordChannelConfigSchema>
export type DiscordChannelMessage = z.infer<typeof discordChannelMessageSchema>
export type DiscordToolCallSummary = z.infer<typeof discordToolCallSummarySchema>

export interface DiscordGatewayPayload {
  op?: number
  t?: string | null
  s?: number | null
  d?: unknown
}

export interface DiscordMessagePayload {
  id?: string
  channel_id?: string
  guild_id?: string
  content?: string
  author?: {
    id?: string
    username?: string
    global_name?: string | null
    discriminator?: string
    bot?: boolean
  }
  mentions?: Array<{
    id?: string
  }>
  stickers?: Array<{
    id?: string
    name?: string
    format_type?: number
  }>
  embeds?: Array<{
    title?: string
    description?: string
    url?: string
  }>
}

export interface DiscordSendMessageResponse {
  id?: string
}
