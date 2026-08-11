import { z } from 'zod'

import type { ChannelLinkModeration } from '@oneworks/types'

export const moderationReviewSchema = z.object({
  severity: z.enum(['none', 'warn', 'mute', 'ban']),
  reason: z.string().trim().min(1).max(200),
  confidence: z.number().min(0).max(1),
  suggestedAction: z.object({
    type: z.enum(['none', 'warn', 'mute', 'mute_permanent']),
    durationMs: z.number().int().positive().optional(),
    scope: z.enum(['account', 'user']).optional()
  })
})

export type ModerationReview = z.infer<typeof moderationReviewSchema>

export interface ModerationReviewInput {
  moderation: ChannelLinkModeration
  recentBehaviorSummary: string
  text: string
}

type ModerationReviewInvoker = (input: ModerationReviewInput) => Promise<unknown>

let reviewInvoker: ModerationReviewInvoker | undefined

export const setModerationReviewInvokerForTests = (invoker: ModerationReviewInvoker | undefined) => {
  reviewInvoker = invoker
}

/**
 * The adapter bridge is deliberately opt-in. An unavailable adapter, timeout, or malformed
 * response produces an audit-only result; it must never turn into an automatic mute.
 */
export const reviewModerationMessage = async (input: ModerationReviewInput) => {
  if (reviewInvoker == null) {
    return { kind: 'unavailable' as const }
  }
  try {
    const output = await reviewInvoker(input)
    const parsed = moderationReviewSchema.safeParse(output)
    return parsed.success
      ? { kind: 'review' as const, review: parsed.data }
      : { kind: 'invalid' as const }
  } catch {
    return { kind: 'failed' as const }
  }
}
