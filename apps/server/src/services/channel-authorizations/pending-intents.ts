import { getDb } from '#~/db/index.js'
import type { ChannelAuthorizationRequestRow, ChannelPendingIntentRow } from '#~/db/index.js'

import { normalizeResumePolicy, readRecordMetadata, readStringMetadata, trimNonEmpty } from './metadata.js'
import type { EnsureChannelAuthorizationRequestInput } from './types.js'

const buildPendingAuthorizationIntentId = (authorizationRequestId: string) =>
  `channel-pending-auth:${authorizationRequestId}`

export const ensurePendingIntentForAuthorizationRequest = (input: {
  binding: EnsureChannelAuthorizationRequestInput['binding']
  event?: EnsureChannelAuthorizationRequestInput['event']
  link?: EnsureChannelAuthorizationRequestInput['link']
  request: ChannelAuthorizationRequestRow
  sessionId: string
}) => {
  const db = getDb()
  const snapshot = db.getSessionRuntimeState(input.sessionId)?.channelActorSnapshot
  const threadKey = trimNonEmpty(snapshot?.threadKey)
  if (threadKey == null) return

  db.upsertChannelPendingIntent({
    id: buildPendingAuthorizationIntentId(input.request.id),
    authorizationRequestId: input.request.id,
    channelId: trimNonEmpty(snapshot?.channelId) ?? input.binding.channelId,
    channelKey: trimNonEmpty(snapshot?.channelKey) ?? input.binding.channelKey,
    channelLinkName: trimNonEmpty(snapshot?.channelLinkName) ?? input.link?.name,
    channelType: input.binding.channelType,
    conversationStateId: trimNonEmpty(snapshot?.conversationStateId),
    createdByChildRunId: trimNonEmpty(snapshot?.childRunId),
    entity: trimNonEmpty(snapshot?.entity) ?? input.link?.entity,
    kind: 'need_approval',
    metadata: {
      interactionId: input.event?.id,
      sessionId: input.sessionId,
      source: 'interaction_request'
    },
    ownerAccountId: input.request.requesterAccountId ?? trimNonEmpty(snapshot?.actorAccountId),
    ownerUserId: input.request.credentialSubjectUserId ??
      input.request.requesterUserId ??
      trimNonEmpty(snapshot?.actorUserId),
    payload: {
      authorizationRequestId: input.request.id,
      capability: input.request.capability,
      credentialSubjectUserId: input.request.credentialSubjectUserId ?? undefined,
      interactionId: input.event?.id,
      subjectLookupKeys: input.event?.payload.permissionContext?.subjectLookupKeys
    },
    requiredAction: 'grant_authorization',
    sessionType: trimNonEmpty(snapshot?.sessionType) ?? input.binding.sessionType,
    status: input.request.status === 'pending' ? 'open' : 'resolved',
    threadKey
  })
}

export const buildResolvedAuthorizationResume = (input: {
  interactionHandled?: boolean
  interactionResponse?: 'allow_once' | 'deny_once'
  intent: ChannelPendingIntentRow
  request: ChannelAuthorizationRequestRow
  resolvedAt: number
  resolvedByAccountId?: string
  resolvedByUserId?: string
  status: 'granted' | 'denied'
}) => {
  const policy = normalizeResumePolicy(readRecordMetadata(input.request.metadata, 'resumePolicy'))
  const notBefore = policy.delayMs == null ? undefined : input.resolvedAt + policy.delayMs
  return {
    authorizationRequestId: input.request.id,
    authorizationStatus: input.status,
    capability: input.request.capability,
    createdByChildRunId: input.intent.createdByChildRunId ?? undefined,
    interactionResponse: input.interactionResponse,
    mode: policy.mode,
    ...(notBefore == null ? {} : { notBefore }),
    readyAt: input.resolvedAt,
    resolvedByAccountId: input.resolvedByAccountId,
    resolvedByUserId: input.resolvedByUserId,
    sessionId: readStringMetadata(input.request.metadata, 'sessionId') ?? undefined,
    ...(input.interactionHandled === true ? { skipReason: 'interaction-response-handled' } : {}),
    status: input.interactionHandled === true ? 'skipped' : 'ready',
    threadKey: input.intent.threadKey
  }
}
