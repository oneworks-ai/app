import { createHash } from 'node:crypto'

import { getDb } from '#~/db/index.js'
import type { ChannelAuthorizationRequestRow } from '#~/db/index.js'
import { buildChannelApproverPrincipals } from '#~/services/channel-authorizations/approvers.js'

import type { ChannelApprovalRequestInput } from './types.js'
import { trimNonEmpty } from './values.js'

const buildAuthorizationRequestId = (
  input: ChannelApprovalRequestInput,
  reasonCode: string,
  subjectUserId?: string
) => {
  const hash = createHash('sha256')
    .update(JSON.stringify({
      actorAccountId: input.actorAccountId,
      actorUserId: input.actorUserId,
      capability: input.capability,
      channelId: input.channelId,
      channelKey: input.channelKey,
      channelType: input.channelType,
      credentialKey: input.credential?.credentialKey,
      reasonCode,
      senderId: input.senderId,
      subjectUserId
    }))
    .digest('hex')
    .slice(0, 24)
  return `channel-approval:${hash}`
}

const buildPendingIntentId = (authorizationRequestId: string) => `channel-pending-auth:${authorizationRequestId}`

const ensureAuthorizationPendingIntent = (
  input: ChannelApprovalRequestInput,
  request: ChannelAuthorizationRequestRow,
  reasonCode: string,
  credentialSubjectUserId?: string
) => {
  const threadKey = trimNonEmpty(input.threadKey)
  if (threadKey == null) return
  const requesterUserId = trimNonEmpty(input.actorUserId)
  const ownerUserId = trimNonEmpty(credentialSubjectUserId) ??
    trimNonEmpty(request.credentialSubjectUserId) ??
    requesterUserId
  const requesterAccountId = trimNonEmpty(input.actorAccountId) ?? trimNonEmpty(input.senderId)
  const ownerAccountId = ownerUserId == null || ownerUserId === requesterUserId
    ? requesterAccountId
    : getDb().listChannelAccountsForUser(ownerUserId).find(account => account.issuerKey === input.channelKey)?.accountId

  getDb().upsertChannelPendingIntent({
    id: buildPendingIntentId(request.id),
    authorizationRequestId: request.id,
    channelId: trimNonEmpty(input.channelId),
    channelKey: trimNonEmpty(input.channelKey),
    channelLinkName: trimNonEmpty(input.channelLinkName),
    channelType: input.channelType,
    conversationStateId: trimNonEmpty(input.conversationStateId),
    createdByChildRunId: trimNonEmpty(input.childRunId),
    entity: trimNonEmpty(input.entity),
    expiresAt: request.expiresAt,
    kind: 'need_approval',
    metadata: {
      credentialSubjectUserId: ownerUserId,
      reasonCode,
      requesterUserId,
      sessionId: trimNonEmpty(input.sessionId),
      source: input.source
    },
    ownerAccountId,
    ownerUserId,
    payload: {
      authorizationRequestId: request.id,
      capability: input.capability,
      credentialKey: trimNonEmpty(input.credential?.credentialKey),
      credentialSubjectUserId: trimNonEmpty(credentialSubjectUserId),
      reasonCode,
      requiredScopes: input.credential?.requiredScopes == null ? undefined : [...input.credential.requiredScopes]
    },
    requiredAction: 'grant_authorization',
    sessionType: trimNonEmpty(input.sessionType),
    status: request.status === 'pending' ? 'open' : 'resolved',
    threadKey
  })
}

export const ensureAuthorizationRequest = (
  input: ChannelApprovalRequestInput,
  reasonCode: string,
  subjectUserId?: string
) => {
  if (input.createAuthorizationRequest !== true) return undefined

  const requesterAccountId = trimNonEmpty(input.actorAccountId) ?? trimNonEmpty(input.senderId)
  const requesterUserId = trimNonEmpty(input.actorUserId)
  const credentialSubjectUserId = trimNonEmpty(subjectUserId)
  if (requesterAccountId == null && requesterUserId == null && credentialSubjectUserId == null) return undefined

  const db = getDb()
  const id = buildAuthorizationRequestId(input, reasonCode, credentialSubjectUserId)
  const existing = db.getChannelAuthorizationRequest(id)
  if (existing != null) {
    ensureAuthorizationPendingIntent(input, existing, reasonCode, credentialSubjectUserId)
    return existing
  }

  const request = db.createChannelAuthorizationRequest({
    id,
    channelType: input.channelType,
    issuerKey: trimNonEmpty(input.channelKey),
    channelKey: trimNonEmpty(input.channelKey),
    channelId: trimNonEmpty(input.channelId),
    channelLinkName: trimNonEmpty(input.channelLinkName),
    requesterUserId,
    requesterAccountId,
    credentialSubjectUserId,
    credentialKey: trimNonEmpty(input.credential?.credentialKey),
    capability: input.capability,
    message: `Capability ${input.capability} requires authorization.`,
    allowedApprovers: buildChannelApproverPrincipals({
      channelAdmins: input.channelAdmins,
      credentialSubjectUserId,
      issuerKey: trimNonEmpty(input.channelKey),
      requesterAccountId,
      requesterUserId
    }),
    metadata: {
      actorAccountId: requesterAccountId,
      actorUserId: trimNonEmpty(input.actorUserId),
      channelId: trimNonEmpty(input.channelId),
      channelKey: trimNonEmpty(input.channelKey),
      childRunId: trimNonEmpty(input.childRunId),
      conversationStateId: trimNonEmpty(input.conversationStateId),
      credentialSubjectUserId,
      entity: trimNonEmpty(input.entity),
      reasonCode,
      requiredScopes: input.credential?.requiredScopes == null ? undefined : [...input.credential.requiredScopes],
      sessionId: trimNonEmpty(input.sessionId),
      sessionType: trimNonEmpty(input.sessionType),
      source: input.source,
      threadKey: trimNonEmpty(input.threadKey),
      ...(input.metadata ?? {})
    }
  })
  if (request != null) {
    ensureAuthorizationPendingIntent(input, request, reasonCode, credentialSubjectUserId)
  }
  return request
}
