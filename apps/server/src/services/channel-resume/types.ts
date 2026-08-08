import type { ChannelPendingIntentRow } from '#~/db/index.js'

export interface ChannelResumePayload {
  authorizationRequestId: string
  authorizationStatus?: string
  capability?: string
  claimId?: string
  claimedAt?: number
  createdByChildRunId?: string
  interactionResponse?: string
  leaseExpiresAt?: number
  mode?: 'immediate' | 'manual' | 'next_message'
  notBefore?: number
  readyAt?: number
  resolvedByAccountId?: string
  resolvedByUserId?: string
  resumeChildRunId?: string
  sessionId: string
  status: 'ready' | 'dispatching' | 'dispatched' | 'failed' | 'skipped'
  threadKey?: string
}

export interface ChannelResumeIntent {
  intent: ChannelPendingIntentRow
  resume: ChannelResumePayload
}

export interface ResumeChannelIntentResult {
  error?: string
  intentId: string
  resumeChildRunId?: string
  sessionId?: string
  status: 'dispatched' | 'failed' | 'skipped'
}

export interface ChannelResumeSchedulerRuntime {
  stop: () => void
}
