import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { resolveAuthContext } from '../auth/permissions.js'
import { readRequestBody, sendJson } from '../http.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import { findRelayTeamMember, isRelayTeamRole, teamMemberCount } from '../teams.js'
import type {
  RelayAuthProvider,
  RelayServerArgs,
  RelayStore,
  RelayTeam,
  RelayTeamInvitation,
  RelayTeamMember,
  RelayUser
} from '../types.js'
import { now } from '../utils.js'
import {
  authUserId,
  canReadTeam,
  canWriteTeamMembers,
  cleanString,
  findUserByInput,
  isAdminAuth,
  policyLimitExceeded
} from './team-route-utils.js'

const teamInvitations = (store: RelayStore) => {
  store.teamInvitations ??= []
  return store.teamInvitations
}

const cleanEmail = (value: unknown) => cleanString(value).toLowerCase()

const isPendingInvitation = (invitation: RelayTeamInvitation) => invitation.status === 'pending'

const invitationMatchesTarget = (
  invitation: RelayTeamInvitation,
  input: { email?: string; userId?: string }
) => (
  (input.userId != null && input.userId !== '' && invitation.userId === input.userId) ||
  (input.email != null && input.email !== '' && invitation.email === input.email)
)

const invitationMatchesUser = (invitation: RelayTeamInvitation, user: RelayUser | undefined) => (
  user != null && (
    invitation.userId === user.id ||
    (invitation.email != null && invitation.email === user.email.toLowerCase())
  )
)

const serializeUserSummary = (user: RelayUser | undefined) => user == null
  ? null
  : {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl ?? null,
    provider: (user.provider ?? null) as RelayAuthProvider | null,
    role: user.role
  }

export const serializeTeamInvitation = (invitation: RelayTeamInvitation, store: RelayStore) => {
  const team = store.teams.find(item => item.id === invitation.teamId)
  const targetUser = invitation.userId == null
    ? invitation.email == null
      ? undefined
      : store.users.find(user => user.email.toLowerCase() === invitation.email)
    : store.users.find(user => user.id === invitation.userId)
  const inviter = store.users.find(user => user.id === invitation.createdByUserId)
  return {
    id: invitation.id,
    teamId: invitation.teamId,
    teamName: team?.name ?? null,
    teamSlug: team?.slug ?? null,
    teamAvatarUrl: team?.avatarUrl ?? null,
    email: invitation.email ?? targetUser?.email ?? null,
    userId: invitation.userId ?? targetUser?.id ?? null,
    user: serializeUserSummary(targetUser),
    inviter: serializeUserSummary(inviter),
    role: invitation.role,
    configEnabled: invitation.configEnabled !== false,
    defaultForPublishing: invitation.defaultForPublishing === true,
    status: invitation.status,
    createdByUserId: invitation.createdByUserId,
    createdAt: invitation.createdAt,
    updatedAt: invitation.updatedAt ?? null,
    respondedAt: invitation.respondedAt ?? null
  }
}

export const listTeamInvitations = (
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  auth: ReturnType<typeof resolveAuthContext>,
  team: RelayTeam
) => {
  if (auth == null || !canReadTeam(store, auth, team.id)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return
  }
  const invitations = teamInvitations(store)
    .filter(invitation => invitation.teamId === team.id)
    .slice()
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .map(invitation => serializeTeamInvitation(invitation, store))
  sendJson(res, 200, { invitations }, args.allowOrigin)
}

export const createTeamInvitation = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  auth: ReturnType<typeof resolveAuthContext>,
  team: RelayTeam
) => {
  if (auth == null || !canWriteTeamMembers(store, auth, team.id)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return
  }
  if (policyLimitExceeded(store.teamPolicy.maxMembersPerTeam, teamMemberCount(store, team.id))) {
    sendJson(res, 403, { error: 'Team member limit reached.' }, args.allowOrigin)
    return
  }

  const body = await readRequestBody(req)
  const email = cleanEmail(body.email)
  const targetUser = findUserByInput(store, body)
  const userId = cleanString(body.userId) !== '' ? cleanString(body.userId) : targetUser?.id
  const targetEmail = targetUser?.email.toLowerCase() ?? email
  if ((userId == null || userId === '') && targetEmail === '') {
    sendJson(res, 400, { error: 'Invitee email or user ID is required.' }, args.allowOrigin)
    return
  }
  if (targetUser != null && findRelayTeamMember(store, team.id, targetUser.id) != null) {
    sendJson(res, 409, { error: 'Team member already exists.' }, args.allowOrigin)
    return
  }

  const existingInvitation = teamInvitations(store).find(invitation =>
    invitation.teamId === team.id &&
    isPendingInvitation(invitation) &&
    invitationMatchesTarget(invitation, { email: targetEmail, userId })
  )
  if (existingInvitation != null) {
    sendJson(res, 409, { error: 'Pending team invitation already exists.' }, args.allowOrigin)
    return
  }

  const invitation: RelayTeamInvitation = {
    id: randomUUID(),
    teamId: team.id,
    ...(userId == null || userId === '' ? {} : { userId }),
    ...(targetEmail === '' ? {} : { email: targetEmail }),
    role: isRelayTeamRole(body.role) ? body.role : 'member',
    configEnabled: body.configEnabled !== false,
    defaultForPublishing: body.defaultForPublishing === true,
    status: 'pending',
    createdByUserId: authUserId(auth) ?? 'system',
    createdAt: now()
  }
  teamInvitations(store).push(invitation)
  await storeRepository.write(store)
  sendJson(res, 200, { invitation: serializeTeamInvitation(invitation, store) }, args.allowOrigin)
}

const resolveInvitationTargetUser = (
  invitation: RelayTeamInvitation,
  store: RelayStore,
  auth: ReturnType<typeof resolveAuthContext>
) => {
  if (auth?.kind === 'session' && invitationMatchesUser(invitation, auth.user)) return auth.user
  if (invitation.userId != null) return store.users.find(user => user.id === invitation.userId)
  if (invitation.email != null) return store.users.find(user => user.email.toLowerCase() === invitation.email)
  return undefined
}

const canRespondInvitation = (
  invitation: RelayTeamInvitation,
  store: RelayStore,
  auth: ReturnType<typeof resolveAuthContext>
) => (
  auth != null && (
    isAdminAuth(auth) ||
    (auth.kind === 'session' && invitationMatchesUser(invitation, auth.user)) ||
    canWriteTeamMembers(store, auth, invitation.teamId)
  )
)

const acceptTeamInvitation = async (
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  auth: ReturnType<typeof resolveAuthContext>,
  invitation: RelayTeamInvitation
) => {
  const targetUser = resolveInvitationTargetUser(invitation, store, auth)
  if (targetUser == null) {
    sendJson(res, 404, { error: 'Invited user not found.' }, args.allowOrigin)
    return
  }
  if (findRelayTeamMember(store, invitation.teamId, targetUser.id) != null) {
    sendJson(res, 409, { error: 'Team member already exists.' }, args.allowOrigin)
    return
  }
  if (policyLimitExceeded(store.teamPolicy.maxMembersPerTeam, teamMemberCount(store, invitation.teamId))) {
    sendJson(res, 403, { error: 'Team member limit reached.' }, args.allowOrigin)
    return
  }

  const acceptedAt = now()
  const member: RelayTeamMember = {
    id: randomUUID(),
    teamId: invitation.teamId,
    userId: targetUser.id,
    role: invitation.role,
    configEnabled: invitation.configEnabled !== false,
    defaultForPublishing: invitation.defaultForPublishing === true,
    createdByUserId: invitation.createdByUserId,
    createdAt: acceptedAt
  }
  store.teamMembers.push(member)
  invitation.userId = targetUser.id
  invitation.email = targetUser.email.toLowerCase()
  invitation.status = 'accepted'
  invitation.respondedAt = acceptedAt
  invitation.updatedAt = acceptedAt
  await storeRepository.write(store)
  sendJson(res, 200, {
    invitation: serializeTeamInvitation(invitation, store),
    member
  }, args.allowOrigin)
}

const declineTeamInvitation = async (
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  invitation: RelayTeamInvitation
) => {
  const declinedAt = now()
  invitation.status = 'declined'
  invitation.respondedAt = declinedAt
  invitation.updatedAt = declinedAt
  await storeRepository.write(store)
  sendJson(res, 200, { invitation: serializeTeamInvitation(invitation, store) }, args.allowOrigin)
}

export const handleTeamInvitationActionsRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url: URL
) => {
  const match = /^\/api\/admin\/team-invitations\/([^/]+)\/(accept|decline)$/u.exec(url.pathname)
  if (match == null) return false
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
    return true
  }

  const auth = resolveAuthContext(req, args, store)
  if (auth == null) {
    sendJson(res, 401, { error: 'Authentication required.' }, args.allowOrigin)
    return true
  }

  const invitation = teamInvitations(store).find(item => item.id === decodeURIComponent(match[1]))
  if (invitation == null) {
    sendJson(res, 404, { error: 'Team invitation not found.' }, args.allowOrigin)
    return true
  }
  if (!isPendingInvitation(invitation)) {
    sendJson(res, 409, { error: 'Team invitation is not pending.' }, args.allowOrigin)
    return true
  }
  if (!canRespondInvitation(invitation, store, auth)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return true
  }

  if (match[2] === 'accept') {
    await acceptTeamInvitation(res, args, store, storeRepository, auth, invitation)
    return true
  }
  await declineTeamInvitation(res, args, store, storeRepository, invitation)
  return true
}

export const handleAdminMessagesRoute = (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  url: URL
) => {
  if (url.pathname !== '/api/admin/messages') return false
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
    return true
  }
  const auth = resolveAuthContext(req, args, store)
  if (auth == null) {
    sendJson(res, 401, { error: 'Authentication required.' }, args.allowOrigin)
    return true
  }
  const invitations = teamInvitations(store)
    .filter(invitation =>
      auth.kind === 'session'
        ? invitationMatchesUser(invitation, auth.user) || invitation.createdByUserId === auth.user.id
        : isPendingInvitation(invitation)
    )
    .slice()
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .map(invitation => serializeTeamInvitation(invitation, store))
  sendJson(res, 200, { invitations }, args.allowOrigin)
  return true
}
