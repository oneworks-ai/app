import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { resolveAuthContext } from '../auth/permissions.js'
import { readRequestBody, sendJson } from '../http.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import { canManageRelayTeamMembers, findRelayTeamMember, isRelayTeamRole, teamMemberCount } from '../teams.js'
import type {
  RelayAuthProvider,
  RelayMessage,
  RelayMessageAudience,
  RelayMessageKind,
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

const relayMessages = (store: RelayStore) => {
  store.messages ??= []
  return store.messages
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

const serializeUserSummary = (user: RelayUser | undefined) =>
  user == null
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

const relayMessageKinds = new Set<RelayMessageKind>(['announcement', 'personal', 'system'])

const normalizeMessageKind = (value: unknown): RelayMessageKind => (
  typeof value === 'string' && relayMessageKinds.has(value as RelayMessageKind)
    ? value as RelayMessageKind
    : 'personal'
)

const cleanUserIds = (value: unknown) => (
  Array.isArray(value)
    ? [
      ...new Set(
        value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
          .map(item => item.trim())
      )
    ]
    : []
)

const cleanEmailList = (value: unknown) => (
  Array.isArray(value)
    ? [
      ...new Set(
        value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
          .map(item => item.trim().toLowerCase())
      )
    ]
    : []
)

const messageAudienceUsers = (store: RelayStore, body: Record<string, unknown>) => {
  const userIds = cleanUserIds(body.userIds)
  const emails = cleanEmailList(body.emails)
  const singleUserId = cleanString(body.userId)
  const singleEmail = cleanEmail(body.email)
  const resolvedUserIds = new Set(userIds)
  if (singleUserId !== '') resolvedUserIds.add(singleUserId)
  for (const email of [...emails, singleEmail].filter(Boolean)) {
    const user = store.users.find(item => item.email.toLowerCase() === email)
    if (user != null) resolvedUserIds.add(user.id)
  }
  return [...resolvedUserIds]
}

const serializeMessageAudience = (audience: RelayMessageAudience, store: RelayStore) => {
  const team = audience.teamId == null ? undefined : store.teams.find(item => item.id === audience.teamId)
  const users = (audience.userIds ?? [])
    .map(userId => store.users.find(user => user.id === userId))
    .filter((user): user is RelayUser => user != null)
    .map(serializeUserSummary)
  return {
    scope: audience.scope,
    teamId: audience.teamId ?? null,
    team: team == null
      ? null
      : {
        id: team.id,
        name: team.name,
        slug: team.slug,
        avatarUrl: team.avatarUrl ?? null
      },
    userIds: audience.userIds ?? [],
    users
  }
}

const serializeRelayMessage = (message: RelayMessage, store: RelayStore) => ({
  id: message.id,
  kind: message.kind,
  title: message.title,
  body: message.body,
  audience: serializeMessageAudience(message.audience, store),
  createdByUserId: message.createdByUserId,
  createdBy: serializeUserSummary(store.users.find(user => user.id === message.createdByUserId)),
  createdAt: message.createdAt,
  updatedAt: message.updatedAt ?? null
})

const authCanCreateMessage = (
  store: RelayStore,
  auth: ReturnType<typeof resolveAuthContext>,
  audience: RelayMessageAudience
) => {
  if (auth == null) return false
  if (audience.scope === 'all') return isAdminAuth(auth)
  if (audience.scope === 'users' && audience.teamId == null) return isAdminAuth(auth)
  if (audience.scope === 'team' && audience.teamId != null) {
    return authCanManageMessageTeam(store, auth, audience.teamId)
  }
  if (
    audience.scope !== 'users' ||
    audience.teamId == null ||
    !authCanManageMessageTeam(store, auth, audience.teamId)
  ) {
    return false
  }
  const teamUserIds = new Set(
    store.teamMembers
      .filter(member => member.teamId === audience.teamId)
      .map(member => member.userId)
  )
  return (audience.userIds ?? []).every(userId => teamUserIds.has(userId))
}

const authCanManageMessageTeam = (
  store: RelayStore,
  auth: ReturnType<typeof resolveAuthContext>,
  teamId: string
) => (
  auth?.kind === 'session' && canManageRelayTeamMembers(findRelayTeamMember(store, teamId, auth.user.id))
)

const isPlatformScopedMessageAudience = (audience: RelayMessageAudience) => (
  audience.scope === 'all' || (audience.scope === 'users' && audience.teamId == null)
)

const readMessageAudience = (store: RelayStore, body: Record<string, unknown>) => {
  const scope = cleanString(body.scope)
  const teamId = cleanString(body.teamId)
  if (scope === 'all') return { ok: true as const, value: { scope: 'all' as const } }
  if (scope === 'team') {
    if (teamId === '' || store.teams.every(team => team.id !== teamId)) {
      return { error: 'Team target is required.', ok: false as const }
    }
    return { ok: true as const, value: { scope: 'team' as const, teamId } }
  }
  const userIds = messageAudienceUsers(store, body)
  if (userIds.length === 0) return { error: 'Message recipients are required.', ok: false as const }
  return {
    ok: true as const,
    value: {
      scope: 'users' as const,
      ...(teamId === '' ? {} : { teamId }),
      userIds
    }
  }
}

const messageVisibleToAuth = (
  message: RelayMessage,
  store: RelayStore,
  auth: ReturnType<typeof resolveAuthContext>
) => {
  if (auth == null) return false
  if (auth.kind !== 'session') return message.audience.scope === 'all'
  if (message.audience.scope === 'all') return true
  if (message.audience.scope === 'users') return (message.audience.userIds ?? []).includes(auth.user.id)
  return message.audience.teamId != null && findRelayTeamMember(store, message.audience.teamId, auth.user.id) != null
}

const messageSentHistoryVisibleToAuth = (
  message: RelayMessage,
  store: RelayStore,
  auth: ReturnType<typeof resolveAuthContext>
) => {
  if (auth == null) return false
  if (message.audience.teamId != null) return authCanManageMessageTeam(store, auth, message.audience.teamId)
  if (isAdminAuth(auth) && isPlatformScopedMessageAudience(message.audience)) return true
  return auth.kind === 'session' &&
    message.createdByUserId === auth.user.id &&
    isPlatformScopedMessageAudience(message.audience)
}

const createRelayMessage = (
  store: RelayStore,
  input: {
    audience: RelayMessageAudience
    body: string
    createdByUserId: string
    kind: RelayMessageKind
    title: string
  }
) => {
  const timestamp = now()
  const message: RelayMessage = {
    id: randomUUID(),
    kind: input.kind,
    title: input.title,
    body: input.body,
    audience: input.audience,
    createdByUserId: input.createdByUserId,
    createdAt: timestamp
  }
  relayMessages(store).push(message)
  return message
}

const headerValue = (req: IncomingMessage, name: string) => {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

const requestIp = (req: IncomingMessage) => {
  const forwarded = headerValue(req, 'x-forwarded-for').split(',')[0]?.trim()
  return forwarded || headerValue(req, 'cf-connecting-ip') || headerValue(req, 'x-real-ip') ||
    req.socket.remoteAddress || '未知 IP'
}

const requestLocation = (req: IncomingMessage) => {
  const city = headerValue(req, 'x-vercel-ip-city')
  const country = headerValue(req, 'x-vercel-ip-country') || headerValue(req, 'cf-ipcountry')
  let decodedCity = city
  try {
    decodedCity = city === '' ? '' : decodeURIComponent(city)
  } catch {
    decodedCity = city
  }
  return [decodedCity, country].filter(Boolean).join(' ') || '未知位置'
}

export const recordLoginNotificationMessage = (
  req: IncomingMessage,
  store: RelayStore,
  user: RelayUser
) => {
  const ip = requestIp(req)
  const location = requestLocation(req)
  const userAgent = headerValue(req, 'user-agent') || '未知设备'
  createRelayMessage(store, {
    kind: 'personal',
    title: '新设备登录提醒',
    body:
      `检测到账号从 IP ${ip} 在 ${location} 完成登录。设备信息：${userAgent}。如果不是你本人操作，请及时修改密码或联系管理员。`,
    audience: { scope: 'users', userIds: [user.id] },
    createdByUserId: 'system'
  })
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

export const handleAdminMessagesRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url: URL
) => {
  if (url.pathname !== '/api/admin/messages') return false
  const auth = resolveAuthContext(req, args, store)
  if (auth == null) {
    sendJson(res, 401, { error: 'Authentication required.' }, args.allowOrigin)
    return true
  }

  if (req.method === 'POST') {
    const body = await readRequestBody(req)
    const title = cleanString(body.title)
    const messageBody = cleanString(body.body)
    if (title === '' || messageBody === '') {
      sendJson(res, 400, { error: 'Message title and body are required.' }, args.allowOrigin)
      return true
    }
    const audience = readMessageAudience(store, body)
    if (!audience.ok) {
      sendJson(res, 400, { error: audience.error }, args.allowOrigin)
      return true
    }
    if (!authCanCreateMessage(store, auth, audience.value)) {
      sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
      return true
    }
    const message = createRelayMessage(store, {
      kind: normalizeMessageKind(body.kind),
      title,
      body: messageBody,
      audience: audience.value,
      createdByUserId: authUserId(auth) ?? 'system'
    })
    await storeRepository.write(store)
    sendJson(res, 200, { message: serializeRelayMessage(message, store) }, args.allowOrigin)
    return true
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
    return true
  }

  const sentHistoryView = url.searchParams.get('view') === 'sent'
  const messages = relayMessages(store)
    .filter(message =>
      sentHistoryView
        ? messageSentHistoryVisibleToAuth(message, store, auth)
        : messageVisibleToAuth(message, store, auth)
    )
    .slice()
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .map(message => serializeRelayMessage(message, store))
  const invitations = sentHistoryView
    ? []
    : teamInvitations(store)
      .filter(invitation =>
        auth.kind === 'session'
          ? invitationMatchesUser(invitation, auth.user) || invitation.createdByUserId === auth.user.id
          : isPendingInvitation(invitation)
      )
      .slice()
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .map(invitation => serializeTeamInvitation(invitation, store))
  sendJson(res, 200, { invitations, messages }, args.allowOrigin)
  return true
}
