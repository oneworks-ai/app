import type { getDb } from '#~/db/index.js'

import { resumeChannelPendingIntent } from './dispatch.js'
import { listReadyChannelResumeIntents } from './intents.js'
import type { ResumeChannelIntentResult } from './types.js'

export const resumeReadyChannelIntents = async (input: {
  filter?: Parameters<ReturnType<typeof getDb>['listResolvedChannelPendingIntents']>[0]
  includeDeferred?: boolean
  limit?: number
  now?: number
} = {}) => {
  const limit = Number.isInteger(input.limit) && input.limit! > 0 ? input.limit! : 20
  const ready = listReadyChannelResumeIntents(input.filter, {
    includeDeferred: input.includeDeferred,
    now: input.now
  }).slice(0, limit)
  const results: ResumeChannelIntentResult[] = []
  for (const item of ready) {
    results.push(
      await resumeChannelPendingIntent({
        intentId: item.intent.id,
        now: input.now
      })
    )
  }
  return results
}
