import { getDb } from '#~/db/index.js'

import { readResumePayload } from './payload.js'
import type { ChannelResumeIntent, ChannelResumePayload } from './types.js'

const isAutoResumeReady = (
  resume: ChannelResumePayload,
  now = Date.now()
) => (
  (resume.status === 'ready' || (resume.status === 'dispatching' && (resume.leaseExpiresAt ?? Infinity) <= now)) &&
  (resume.mode == null || resume.mode === 'immediate') &&
  (resume.notBefore == null || resume.notBefore <= now)
)

const isNextMessageResumeReady = (
  resume: ChannelResumePayload,
  now = Date.now()
) => (
  (resume.status === 'ready' || (resume.status === 'dispatching' && (resume.leaseExpiresAt ?? Infinity) <= now)) &&
  resume.mode === 'next_message' &&
  (resume.notBefore == null || resume.notBefore <= now)
)

export const listReadyChannelResumeIntents = (
  filter: Parameters<ReturnType<typeof getDb>['listResolvedChannelPendingIntents']>[0] = {},
  options: {
    includeDeferred?: boolean
    now?: number
  } = {}
): ChannelResumeIntent[] => (
  getDb().listResolvedChannelPendingIntents(filter)
    .map(intent => {
      const resume = readResumePayload(intent)
      if (
        resume == null ||
        (resume.status !== 'ready' &&
          !(resume.status === 'dispatching' && (resume.leaseExpiresAt ?? Infinity) <= (options.now ?? Date.now())))
      ) return undefined
      if (options.includeDeferred !== true && !isAutoResumeReady(resume, options.now)) return undefined
      return { intent, resume }
    })
    .filter((item): item is ChannelResumeIntent => item != null)
)

export const listNextMessageChannelResumeIntents = (
  filter: Parameters<ReturnType<typeof getDb>['listResolvedChannelPendingIntents']>[0],
  options: {
    limit?: number
    now?: number
  } = {}
): ChannelResumeIntent[] => {
  const limit = Number.isInteger(options.limit) && options.limit! > 0 ? options.limit! : 20
  return getDb().listResolvedChannelPendingIntents(filter)
    .map(intent => {
      const resume = readResumePayload(intent)
      if (resume == null || !isNextMessageResumeReady(resume, options.now)) return undefined
      return { intent, resume }
    })
    .filter((item): item is ChannelResumeIntent => item != null)
    .slice(0, limit)
}
