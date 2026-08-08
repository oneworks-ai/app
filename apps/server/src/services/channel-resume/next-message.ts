import { getDb } from '#~/db/index.js'

import { withUpdatedResume } from './payload.js'
import type { ChannelResumeIntent } from './types.js'

export const markChannelResumeIntentsDispatchingForChildRun = (input: {
  childRunId: string
  dispatchReason: 'next_message'
  intents: ChannelResumeIntent[]
  now?: number
}) => {
  const now = input.now ?? Date.now()
  for (const item of input.intents) {
    getDb().updateChannelPendingIntent(item.intent.id, {
      metadata: withUpdatedResume(item.intent, item.resume, {
        claimedAt: now,
        dispatchReason: input.dispatchReason,
        resumeChildRunId: input.childRunId,
        status: 'dispatching'
      })
    })
  }
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
    getDb().updateChannelPendingIntent(item.intent.id, {
      metadata: withUpdatedResume(item.intent, item.resume, {
        ...(input.status === 'dispatched' ? { dispatchedAt: now } : { failedAt: now }),
        dispatchReason: input.dispatchReason,
        ...(input.error == null ? {} : { error: input.error }),
        resumeChildRunId: input.childRunId,
        ...(input.sessionId == null ? {} : { sessionId: input.sessionId }),
        status: input.status
      })
    })
  }
}
