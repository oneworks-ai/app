import { z } from 'zod'

export const oneworksRoomChannelConnectionAttachInputSchema = z.object({
  channelLinkName: z.string().trim().min(1)
}).strict()

export const oneworksRoomChannelConnectionPatchInputSchema = z.object({
  commandPrefix: z.string().trim().max(80).nullable().optional(),
  muted: z.boolean().optional(),
  requireMention: z.boolean().optional()
}).strict().refine(value => Object.keys(value).length > 0, 'At least one connection field is required.')

export const oneworksRoomChannelConnectionCandidateSchema = z.object({
  accountLabel: z.string().optional(),
  channelLinkName: z.string(),
  channelType: z.string(),
  conversationLabel: z.string(),
  entityId: z.string(),
  entityName: z.string(),
  status: z.enum(['connected', 'disabled', 'error'])
}).strict()

export type OneWorksRoomChannelConnectionAttachInput = z.infer<
  typeof oneworksRoomChannelConnectionAttachInputSchema
>
export type OneWorksRoomChannelConnectionCandidate = z.infer<
  typeof oneworksRoomChannelConnectionCandidateSchema
>
export type OneWorksRoomChannelConnectionPatchInput = z.infer<
  typeof oneworksRoomChannelConnectionPatchInputSchema
>
