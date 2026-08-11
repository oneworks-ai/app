import { z } from 'zod'

import { channelBaseSchema } from '@oneworks/core/channel'

const channelTextMentionSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  platform: z.string().optional(),
  type: z.enum(['all', 'user']).optional()
})

export const oneworksChannelConfigSchema = channelBaseSchema.extend({
  type: z.literal('oneworks').describe('OneWorks native channel type'),
  webhookSecret: z
    .string()
    .min(1)
    .optional()
    .describe('Secret used to verify signed OneWorks webhook requests.'),
  allowInsecureWebhooks: z
    .boolean()
    .optional()
    .describe('Allow unsigned synthetic simulation only from a loopback socket. Defaults to false.')
})

export const oneworksToolCallSummarySchema = z.object({
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

export const oneworksChannelMessageSchema = z.object({
  mentions: z.array(channelTextMentionSchema).optional(),
  receiveId: z.string().min(1),
  receiveIdType: z.string().min(1),
  text: z.string().min(1),
  toolCallSummary: oneworksToolCallSummarySchema.optional()
})

export const oneworksInboundWebhookSchema = z.object({
  channelId: z.string().min(1).optional(),
  contentItems: z.array(z.unknown()).optional(),
  messageId: z.string().min(1).optional(),
  mentionedBot: z.boolean().optional(),
  replyMessageId: z.string().min(1).optional(),
  mentions: z.array(channelTextMentionSchema).optional(),
  replyTo: z.object({
    receiveId: z.string().min(1),
    receiveIdType: z.string().min(1)
  }).optional(),
  roomId: z.string().min(1).optional(),
  rootMessageId: z.string().min(1).optional(),
  senderId: z.string().min(1),
  simulation: z.object({
    actorRole: z.enum(['admin', 'participant']),
    userLabel: z.string().trim().min(1).max(80)
  }).strict().optional(),
  sessionType: z.enum(['group', 'direct']).optional(),
  text: z.string().optional(),
  threadId: z.string().min(1).optional()
})

export type OneWorksChannelConfig = z.infer<typeof oneworksChannelConfigSchema>
export type OneWorksChannelMessage = z.infer<typeof oneworksChannelMessageSchema>
export type OneWorksInboundWebhook = z.infer<typeof oneworksInboundWebhookSchema>
