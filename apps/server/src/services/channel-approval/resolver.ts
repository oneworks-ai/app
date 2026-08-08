import { getDb } from '#~/db/index.js'
import type { ChannelUserCredentialRow } from '#~/db/index.js'

import { ensureAuthorizationRequest } from './authorization-request.js'
import type { ChannelApprovalDecision, ChannelApprovalDecisionStatus, ChannelApprovalRequestInput } from './types.js'
import { hasAnyAdminRef, trimNonEmpty } from './values.js'

const isExpired = (credential: ChannelUserCredentialRow) =>
  credential.expiresAt != null && credential.expiresAt <= Date.now()

const getMissingScopes = (credential: ChannelUserCredentialRow, requiredScopes: readonly string[] = []) => {
  if (requiredScopes.length === 0) return []
  const granted = new Set(credential.scopes ?? [])
  return requiredScopes.filter(scope => !granted.has(scope))
}

const resolveCredentialAskStatus = (
  input: ChannelApprovalRequestInput,
  subjectUserId: string
): Extract<ChannelApprovalDecisionStatus, 'ask_trigger_user' | 'ask_resource_owner'> => (
  trimNonEmpty(input.actorUserId) === subjectUserId ? 'ask_trigger_user' : 'ask_resource_owner'
)

const makeDecision = (
  input: ChannelApprovalRequestInput,
  status: ChannelApprovalDecisionStatus,
  reasonCode: string,
  extra: Partial<ChannelApprovalDecision> = {}
): ChannelApprovalDecision => ({
  actorAccountId: trimNonEmpty(input.actorAccountId) ?? trimNonEmpty(input.senderId),
  actorUserId: trimNonEmpty(input.actorUserId),
  capability: input.capability,
  reasonCode,
  status,
  ...extra
})

const resolveCredentialDecision = (
  input: ChannelApprovalRequestInput
): ChannelApprovalDecision | undefined => {
  const credentialKey = trimNonEmpty(input.credential?.credentialKey)
  if (credentialKey == null) return undefined

  const subjectUserId = trimNonEmpty(input.credential?.subjectUserId) ?? trimNonEmpty(input.actorUserId)
  if (subjectUserId == null) {
    const reasonCode = 'credential-subject-unresolved'
    return makeDecision(input, 'ask_trigger_user', reasonCode, {
      authorizationRequest: ensureAuthorizationRequest(input, reasonCode),
      credentialKey
    })
  }

  const credential = getDb().getChannelUserCredential(subjectUserId, input.channelType, credentialKey)
  const askStatus = resolveCredentialAskStatus(input, subjectUserId)
  if (credential == null) {
    const reasonCode = 'credential-missing'
    return makeDecision(input, askStatus, reasonCode, {
      authorizationRequest: ensureAuthorizationRequest(input, reasonCode, subjectUserId),
      credentialKey,
      credentialSubjectUserId: subjectUserId
    })
  }

  if (credential.status !== 'active') {
    const reasonCode = `credential-${credential.status}`
    return makeDecision(input, askStatus, reasonCode, {
      authorizationRequest: ensureAuthorizationRequest(input, reasonCode, subjectUserId),
      credential,
      credentialKey,
      credentialSubjectUserId: subjectUserId
    })
  }

  if (isExpired(credential)) {
    const reasonCode = 'credential-expired'
    return makeDecision(input, askStatus, reasonCode, {
      authorizationRequest: ensureAuthorizationRequest(input, reasonCode, subjectUserId),
      credential,
      credentialKey,
      credentialSubjectUserId: subjectUserId
    })
  }

  const missingScopes = getMissingScopes(credential, input.credential?.requiredScopes)
  if (missingScopes.length > 0) {
    const reasonCode = 'credential-scope-missing'
    return makeDecision(input, askStatus, reasonCode, {
      authorizationRequest: ensureAuthorizationRequest(input, reasonCode, subjectUserId),
      credential,
      credentialKey,
      credentialSubjectUserId: subjectUserId,
      missingScopes
    })
  }

  return makeDecision(input, 'allow', 'credential-active', {
    credential,
    credentialKey,
    credentialSubjectUserId: subjectUserId
  })
}

export const resolveChannelApproval = (
  input: ChannelApprovalRequestInput
): ChannelApprovalDecision => {
  if (input.permission === 'admin' && !hasAnyAdminRef(input)) {
    return makeDecision(input, 'deny', 'admin-required')
  }

  const credentialDecision = resolveCredentialDecision(input)
  if (credentialDecision != null) return credentialDecision

  if (input.defaultDecision != null) {
    return makeDecision(input, input.defaultDecision.status, input.defaultDecision.reasonCode, {
      authorizationRequest: ensureAuthorizationRequest(input, input.defaultDecision.reasonCode)
    })
  }

  return makeDecision(input, 'allow', input.permission === 'admin' ? 'admin-allowed' : 'default-allow')
}
