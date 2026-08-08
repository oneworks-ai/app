import type { ChannelApprovalDecision } from '#~/services/channel-approval/index.js'

export const trimNonEmpty = (value: unknown) => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

export const readStringMetadata = (
  value: Record<string, unknown> | null | undefined,
  key: string
) => trimNonEmpty(value?.[key])

export const readRecordMetadata = (
  value: Record<string, unknown> | null | undefined,
  key: string
) => {
  const item = value?.[key]
  return item != null && typeof item === 'object' && !Array.isArray(item)
    ? item as Record<string, unknown>
    : undefined
}

export const normalizeResumePolicy = (value: Record<string, unknown> | undefined) => {
  const mode = trimNonEmpty(value?.mode)
  const delayMs = typeof value?.delayMs === 'number' && Number.isFinite(value.delayMs) && value.delayMs > 0
    ? value.delayMs
    : undefined
  return {
    delayMs,
    mode: mode === 'manual' || mode === 'next_message' || mode === 'immediate'
      ? mode
      : 'immediate'
  }
}

export const summarizeApprovalDecision = (decision: ChannelApprovalDecision) => ({
  actorAccountId: decision.actorAccountId,
  actorUserId: decision.actorUserId,
  authorizationRequestId: decision.authorizationRequest?.id,
  capability: decision.capability,
  credentialKey: decision.credentialKey,
  credentialSubjectUserId: decision.credentialSubjectUserId,
  missingScopes: decision.missingScopes,
  reasonCode: decision.reasonCode,
  status: decision.status
})
