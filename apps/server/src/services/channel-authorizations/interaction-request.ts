import { getDb } from '#~/db/index.js'
import { resolveChannelApproval } from '#~/services/channel-approval/index.js'

import { buildChannelApproverPrincipals } from './approvers.js'

import { summarizeApprovalDecision, trimNonEmpty } from './metadata.js'
import { ensurePendingIntentForAuthorizationRequest } from './pending-intents.js'
import type { EnsureChannelAuthorizationRequestInput, InteractionRequestEvent } from './types.js'

const AUTHORIZATION_REQUEST_ID_PREFIX = 'channel-interaction'

export const buildChannelInteractionAuthorizationRequestId = (sessionId: string, interactionId: string) =>
  `${AUTHORIZATION_REQUEST_ID_PREFIX}:${sessionId}:${interactionId}`

const isPermissionInteraction = (event: InteractionRequestEvent) => event.payload.kind === 'permission'

const resolveCapability = (event: InteractionRequestEvent) => {
  const permissionContext = event.payload.permissionContext
  return trimNonEmpty(permissionContext?.subjectKey) ??
    trimNonEmpty(permissionContext?.subjectLabel) ??
    trimNonEmpty(permissionContext?.deniedTools?.[0]) ??
    'permission'
}

const resolveRequesterAccountId = (binding: EnsureChannelAuthorizationRequestInput['binding']) => (
  trimNonEmpty(binding.senderId) ?? (binding.sessionType === 'direct' ? trimNonEmpty(binding.channelId) : undefined)
)

export const ensureChannelAuthorizationRequestForInteraction = (input: EnsureChannelAuthorizationRequestInput) => {
  if (!isPermissionInteraction(input.event)) {
    return undefined
  }

  const id = buildChannelInteractionAuthorizationRequestId(input.sessionId, input.event.id)
  const db = getDb()
  const existing = db.getChannelAuthorizationRequest(id)
  if (existing != null) {
    ensurePendingIntentForAuthorizationRequest({
      binding: input.binding,
      event: input.event,
      link: input.link,
      request: existing,
      sessionId: input.sessionId
    })
    return existing
  }

  const requesterAccountId = resolveRequesterAccountId(input.binding)
  const requesterUser = requesterAccountId == null
    ? undefined
    : db.resolveCanonicalUserByChannelAccount(input.binding.channelKey, requesterAccountId)
  const permissionContext = input.event.payload.permissionContext
  const capability = resolveCapability(input.event)
  const approval = resolveChannelApproval({
    actorAccountId: requesterAccountId,
    actorUserId: requesterUser?.id,
    capability,
    channelId: input.binding.channelId,
    channelKey: input.binding.channelKey,
    channelLinkName: input.link?.name,
    channelType: input.binding.channelType,
    defaultDecision: {
      reasonCode: 'session-permission-required',
      status: 'ask_trigger_user'
    },
    entity: input.link?.entity,
    metadata: {
      interactionId: input.event.id
    },
    senderId: requesterAccountId,
    sessionId: input.sessionId,
    sessionType: input.binding.sessionType,
    source: 'system'
  })
  const request = db.createChannelAuthorizationRequest({
    id,
    channelType: input.binding.channelType,
    issuerKey: input.binding.channelKey,
    channelKey: input.binding.channelKey,
    channelId: input.binding.channelId,
    channelLinkName: input.link?.name,
    requesterUserId: requesterUser?.id,
    requesterAccountId,
    capability,
    message: input.event.payload.question,
    allowedApprovers: buildChannelApproverPrincipals({
      credentialSubjectUserId: undefined,
      issuerKey: input.binding.channelKey,
      requesterAccountId,
      requesterUserId: requesterUser?.id
    }),
    metadata: {
      adapter: permissionContext?.adapter,
      approval: summarizeApprovalDecision(approval),
      channelId: input.binding.channelId,
      channelKey: input.binding.channelKey,
      deniedTools: permissionContext?.deniedTools,
      entity: input.link?.entity,
      interactionId: input.event.id,
      options: input.event.payload.options?.map(option => ({
        label: option.label,
        value: option.value
      })),
      projectConfigPath: permissionContext?.projectConfigPath,
      reasons: permissionContext?.reasons,
      resumePolicy: input.link?.authorization?.resume,
      scope: permissionContext?.scope,
      sessionId: input.sessionId,
      sessionType: input.binding.sessionType,
      subjectLookupKeys: permissionContext?.subjectLookupKeys
    }
  })
  if (request != null) {
    ensurePendingIntentForAuthorizationRequest({
      binding: input.binding,
      event: input.event,
      link: input.link,
      request,
      sessionId: input.sessionId
    })
  }
  return request
}
