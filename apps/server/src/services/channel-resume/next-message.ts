import { randomUUID } from 'node:crypto'

import { getDb } from '#~/db/index.js'

import { withUpdatedResume } from './payload.js'
import type { ChannelResumeIntent } from './types.js'

export const claimNextMessageChannelResumeIntents = (input: {
  intents: ChannelResumeIntent[]
  now?: number
}) => {
  const now = input.now ?? Date.now()
  const claimed: ChannelResumeIntent[] = []
  for (const item of input.intents) {
    const claimId = randomUUID()
    const resume = {
      ...item.resume,
      claimId,
      claimedAt: now,
      dispatchReason: 'next_message' as const,
      leaseExpiresAt: now + 5 * 60 * 1000,
      status: 'dispatching' as const
    }
    const intent = getDb().claimChannelPendingIntentResume({
      id: item.intent.id,
      metadata: withUpdatedResume(item.intent, item.resume, {
        claimedAt: now,
        claimId,
        dispatchReason: 'next_message',
        leaseExpiresAt: resume.leaseExpiresAt,
        status: 'dispatching'
      }),
      now
    })
    if (intent != null) claimed.push({ intent, resume })
  }
  return claimed
}

export const finishChannelResumeIntentsForChildRun = (input: {
  childRunId: string
  dispatchReason: 'next_message'
  error?: string
  intents: ChannelResumeIntent[]
  now?: number
  sessionId?: string
  status: 'dispatched' | 'failed'
}) => {
  const now = input.now ?? Date.now()
  for (const item of input.intents) {
    if (item.resume.claimId == null) continue
    getDb().finishChannelPendingIntentResumeClaim({
      claimId: item.resume.claimId,
      id: item.intent.id,
      metadata: withUpdatedResume(item.intent, item.resume, {
        ...(input.status === 'dispatched' ? { dispatchedAt: now } : { failedAt: now }),
        dispatchReason: input.dispatchReason,
        ...(input.error == null ? {} : { error: input.error }),
        resumeChildRunId: input.childRunId,
        ...(input.sessionId == null ? {} : { sessionId: input.sessionId }),
        status: input.status
      }),
      now
    })
  }
}
