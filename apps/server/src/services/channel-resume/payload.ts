import type { ChannelPendingIntentRow } from '#~/db/index.js'

import type { ChannelResumePayload } from './types.js'

export const trimNonEmpty = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const readNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined

export const normalizeChannelResumePayload = (value: unknown): ChannelResumePayload | undefined => {
  if (!isRecord(value)) return undefined
  const authorizationRequestId = trimNonEmpty(value.authorizationRequestId)
  const sessionId = trimNonEmpty(value.sessionId)
  const status = trimNonEmpty(value.status)
  if (authorizationRequestId == null || sessionId == null) return undefined
  if (
    status !== 'ready' &&
    status !== 'dispatching' &&
    status !== 'dispatched' &&
    status !== 'failed' &&
    status !== 'skipped'
  ) {
    return undefined
  }

  return {
    authorizationRequestId,
    authorizationStatus: trimNonEmpty(value.authorizationStatus),
    capability: trimNonEmpty(value.capability),
    claimId: trimNonEmpty(value.claimId),
    claimedAt: readNumber(value.claimedAt),
    createdByChildRunId: trimNonEmpty(value.createdByChildRunId),
    interactionResponse: trimNonEmpty(value.interactionResponse),
    leaseExpiresAt: readNumber(value.leaseExpiresAt),
    mode: value.mode === 'manual' || value.mode === 'next_message' || value.mode === 'immediate'
      ? value.mode
      : undefined,
    notBefore: readNumber(value.notBefore),
    readyAt: readNumber(value.readyAt),
    resolvedByAccountId: trimNonEmpty(value.resolvedByAccountId),
    resolvedByUserId: trimNonEmpty(value.resolvedByUserId),
    resumeChildRunId: trimNonEmpty(value.resumeChildRunId),
    sessionId,
    status,
    threadKey: trimNonEmpty(value.threadKey)
  }
}

export const readResumePayload = (intent: ChannelPendingIntentRow) => (
  normalizeChannelResumePayload(intent.metadata?.resume)
)

export const withUpdatedResume = (
  intent: ChannelPendingIntentRow,
  resume: ChannelResumePayload,
  patch: Partial<ChannelResumePayload> & Record<string, unknown>
) => ({
  ...(intent.metadata ?? {}),
  resume: {
    ...resume,
    ...patch
  }
})
