/* eslint-disable max-lines -- profile route keeps current-account security handlers in one boundary. */
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { RegistrationResponseJSON } from '@simplewebauthn/server'

import { defaultPlatformAccessGroupIds, defaultTeamAccessGroupIds } from '../access-groups.js'
import {
  createRelayAccessToken,
  listPublicRelayAccessTokens,
  publicRelayAccessToken,
  revokeRelayAccessToken,
  updateRelayAccessToken
} from '../auth/access-tokens.js'
import { ensureAuthIdentity } from '../auth/identities.js'
import {
  RelayPasskeyError,
  prepareRelayCurrentUserPasskeyRegistration,
  verifyRelayCurrentUserPasskeyRegistration
} from '../auth/passkeys.js'
import { PasswordValidationError, hashPassword, verifyPassword } from '../auth/passwords.js'
import { resolveAuthContext } from '../auth/permissions.js'
import { readRequestBody, sendJson } from '../http.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayAccessTokenScope, RelayOpenApiAuditEvent, RelayServerArgs, RelayStore, RelayUser } from '../types.js'
import { now } from '../utils.js'

const cleanString = (value: unknown) => typeof value === 'string' ? value.trim() : ''

const pathId = (url: URL, prefix: string) => {
  if (url.pathname === prefix) return undefined
  const escaped = url.pathname.slice(prefix.length + 1)
  return escaped === '' ? undefined : decodeURIComponent(escaped)
}

const responseFromBody = <TResponse>(body: Record<string, unknown>) => (
  body.response != null && typeof body.response === 'object' && !Array.isArray(body.response)
    ? body.response as TResponse
    : undefined
)

const credentialNameFromBody = (body: Record<string, unknown>) => (
  cleanString(body.credentialName) || cleanString(body.passkeyName) || cleanString(body.name)
)

const requireProfileUser = (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  options: { sessionOnly?: boolean } = {}
) => {
  const auth = resolveAuthContext(req, args, store)
  if (auth == null || auth.kind === 'admin-token') {
    sendJson(res, 401, { error: 'Relay login session required.' }, args.allowOrigin)
    return undefined
  }
  if (options.sessionOnly === true && auth.kind !== 'session') {
    sendJson(res, 403, { error: 'Relay login session required.' }, args.allowOrigin)
    return undefined
  }
  return {
    auth,
    user: auth.user
  }
}

const normalizeStringArray = (value: unknown) => (
  Array.isArray(value)
    ? [...new Set(value.map(cleanString).filter((item): item is string => item !== ''))]
    : []
)

const normalizeAccessTokenScope = (value: unknown): RelayAccessTokenScope => {
  if (value === 'team' || value === 'user') return value
  return 'platform'
}

const accessTokenPermissionGrantFromBody = (body: Record<string, unknown>, store: RelayStore, user: RelayUser) => {
  const scope = normalizeAccessTokenScope(body.scope)
  if (scope === 'user') {
    return {
      permissionGroupIds: [],
      permissionGroupMode: 'all' as const,
      scope
    }
  }

  const permissionGroupMode = body.permissionGroupMode === 'custom' ? 'custom' : 'all'
  const permissionGroupIds = permissionGroupMode === 'custom'
    ? normalizeStringArray(body.permissionGroupIds)
    : []
  if (scope === 'team') {
    const teamId = cleanString(body.teamId)
    if (teamId === '') return { error: 'Team access token requires a team id.' }
    const team = store.teams.find(item => item.id === teamId)
    if (team == null) return { error: 'Team not found.' }
    const member = store.teamMembers.find(item => item.teamId === teamId && item.userId === user.id)
    if (member == null) return { error: 'Access token cannot grant groups for a team the user has not joined.' }
    const memberGroupIds = member.groupIds ?? defaultTeamAccessGroupIds(member.role)
    const memberGroupIdSet = new Set(memberGroupIds)
    const unknownGroupIds = permissionGroupIds.filter(groupId => !memberGroupIdSet.has(groupId))
    return unknownGroupIds.length === 0
      ? { permissionGroupIds, permissionGroupMode, scope, teamId }
      : { error: `Access token cannot grant unassigned team member groups: ${unknownGroupIds.join(', ')}` }
  }

  const userGroupIds = user.groupIds ?? defaultPlatformAccessGroupIds(user.role)
  const userGroupIdSet = new Set(userGroupIds)
  const unknownGroupIds = permissionGroupIds.filter(groupId => !userGroupIdSet.has(groupId))
  return unknownGroupIds.length === 0
    ? { permissionGroupIds, permissionGroupMode, scope }
    : { error: `Access token cannot grant unassigned access groups: ${unknownGroupIds.join(', ')}` }
}

const passkeySummary = (store: RelayStore, user: RelayUser, args: RelayServerArgs) => {
  const passkeys = store.passkeys.filter(passkey => passkey.userId === user.id)
  const lastUsedAt = passkeys
    .map(passkey => passkey.lastUsedAt)
    .filter((value): value is string => value != null && value !== '')
    .sort()
    .at(-1) ?? null
  return {
    count: passkeys.length,
    enabled: args.passkey?.enabled !== false,
    lastUsedAt
  }
}

const serializeOpenApiAuditEvent = (event: RelayOpenApiAuditEvent) => ({
  id: event.id,
  tokenId: event.tokenId,
  tokenPreview: event.tokenPreview,
  userId: event.userId,
  method: event.method,
  path: event.path,
  status: event.status,
  ip: event.ip ?? null,
  userAgent: event.userAgent ?? null,
  permission: event.permission ?? null,
  error: event.error ?? null,
  createdAt: event.createdAt
})

const statusMatches = (event: RelayOpenApiAuditEvent, status: string) => {
  if (status === '') return true
  if (status === 'success') return event.status >= 200 && event.status < 400
  if (status === 'failure') return event.status >= 400
  const statusCode = Number(status)
  return Number.isFinite(statusCode) && event.status === Math.trunc(statusCode)
}

const isAfterDate = (value: string, from: string) => from === '' || Date.parse(value) >= Date.parse(from)
const isBeforeDate = (value: string, to: string) => to === '' || Date.parse(value) <= Date.parse(to)

const sendOpenApiAuditEvents = (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  url: URL
) => {
  const profile = requireProfileUser(req, res, args, store, { sessionOnly: true })
  if (profile == null) return
  const key = cleanString(url.searchParams.get('key')).toLowerCase()
  const path = cleanString(url.searchParams.get('path')).toLowerCase()
  const status = cleanString(url.searchParams.get('status')).toLowerCase()
  const from = cleanString(url.searchParams.get('from'))
  const to = cleanString(url.searchParams.get('to'))
  const events = (store.openApiAuditEvents ?? [])
    .filter(event => event.userId === profile.user.id)
    .filter(event =>
      key === '' ||
      event.tokenId.toLowerCase().includes(key) ||
      event.tokenPreview.toLowerCase().includes(key)
    )
    .filter(event => path === '' || event.path.toLowerCase().includes(path))
    .filter(event => statusMatches(event, status))
    .filter(event => isAfterDate(event.createdAt, from))
    .filter(event => isBeforeDate(event.createdAt, to))
    .slice()
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 500)
    .map(serializeOpenApiAuditEvent)
  sendJson(res, 200, { events }, args.allowOrigin)
}

const sendSecuritySummary = (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore
) => {
  const profile = requireProfileUser(req, res, args, store)
  if (profile == null) return
  sendJson(res, 200, {
    accessTokens: listPublicRelayAccessTokens(store, profile.user.id),
    accountDeletion: {
      available: true
    },
    password: {
      enabled: profile.user.passwordHash != null
    },
    passkeys: passkeySummary(store, profile.user, args),
    twoFactor: {
      available: false,
      enabled: false
    }
  }, args.allowOrigin)
}

const deleteUserFromMessageAudience = (message: NonNullable<RelayStore['messages']>[number], userId: string) => {
  if (message.audience.scope !== 'users') return message
  const userIds = (message.audience.userIds ?? []).filter(item => item !== userId)
  return userIds.length === 0
    ? undefined
    : {
      ...message,
      audience: {
        ...message.audience,
        userIds
      }
    }
}

const deleteProfileAccount = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository
) => {
  const profile = requireProfileUser(req, res, args, store)
  if (profile == null) return
  const userId = profile.user.id
  store.users = store.users.filter(user => user.id !== userId)
  store.authIdentities = store.authIdentities.filter(identity => identity.userId !== userId)
  store.sessions = store.sessions.filter(session => session.userId !== userId)
  store.accessTokens = store.accessTokens.filter(token => token.userId !== userId)
  store.openApiAuditEvents = (store.openApiAuditEvents ?? []).filter(event => event.userId !== userId)
  store.passkeys = store.passkeys.filter(passkey => passkey.userId !== userId)
  store.passkeyChallenges = store.passkeyChallenges.filter(challenge => challenge.userId !== userId)
  store.devices = store.devices.filter(device => device.userId !== userId)
  store.deviceSessions = store.deviceSessions.filter(session => session.userId !== userId)
  store.forwardingJobs = store.forwardingJobs.filter(job => job.userId !== userId)
  store.teamMembers = store.teamMembers.filter(member => member.userId !== userId)
  store.teamInvitations = (store.teamInvitations ?? []).filter(invitation =>
    invitation.userId !== userId && invitation.createdByUserId !== userId
  )
  store.messages = (store.messages ?? [])
    .filter(message => message.createdByUserId !== userId)
    .map(message => deleteUserFromMessageAudience(message, userId))
    .filter((message): message is NonNullable<RelayStore['messages']>[number] => message != null)
  store.configAssignments = store.configAssignments.map(assignment => ({
    ...assignment,
    target: assignment.target?.userIds == null
      ? assignment.target
      : {
        ...assignment.target,
        userIds: assignment.target.userIds.filter(item => item !== userId)
      }
  }))
  store.configProfileAssignments = store.configProfileAssignments.map(assignment => ({
    ...assignment,
    target: assignment.target?.userIds == null
      ? assignment.target
      : {
        ...assignment.target,
        userIds: assignment.target.userIds.filter(item => item !== userId)
      }
  }))
  await storeRepository.write(store)
  sendJson(res, 200, { deleted: true, userId }, args.allowOrigin)
}

const createAccessToken = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository
) => {
  const profile = requireProfileUser(req, res, args, store, { sessionOnly: true })
  if (profile == null) return
  const body = await readRequestBody(req)
  const permissionGrant = accessTokenPermissionGrantFromBody(body, store, profile.user)
  if ('error' in permissionGrant) {
    sendJson(res, 400, { error: permissionGrant.error }, args.allowOrigin)
    return
  }
  const result = createRelayAccessToken(store, {
    name: body.name,
    permissionGroupIds: permissionGrant.permissionGroupIds,
    permissionGroupMode: permissionGrant.permissionGroupMode,
    scope: permissionGrant.scope,
    teamId: permissionGrant.teamId,
    userId: profile.user.id
  })
  await storeRepository.write(store)
  sendJson(res, 200, {
    accessToken: result.token,
    token: publicRelayAccessToken(result.accessToken)
  }, args.allowOrigin)
}

const updateAccessToken = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url: URL
) => {
  const profile = requireProfileUser(req, res, args, store, { sessionOnly: true })
  if (profile == null) return
  const tokenId = pathId(url, '/api/profile/access-tokens')
  if (tokenId == null || tokenId === '') {
    sendJson(res, 400, { error: 'Access token id is required.' }, args.allowOrigin)
    return
  }
  const body = await readRequestBody(req)
  const permissionGrant = accessTokenPermissionGrantFromBody(body, store, profile.user)
  if ('error' in permissionGrant) {
    sendJson(res, 400, { error: permissionGrant.error }, args.allowOrigin)
    return
  }
  const updated = updateRelayAccessToken(store, {
    name: body.name,
    permissionGroupIds: permissionGrant.permissionGroupIds,
    permissionGroupMode: permissionGrant.permissionGroupMode,
    scope: permissionGrant.scope,
    teamId: permissionGrant.teamId,
    tokenId,
    userId: profile.user.id
  })
  if (updated == null) {
    sendJson(res, 404, { error: 'Access token not found.' }, args.allowOrigin)
    return
  }
  await storeRepository.write(store)
  sendJson(res, 200, { token: publicRelayAccessToken(updated) }, args.allowOrigin)
}

const revokeAccessToken = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url: URL
) => {
  const profile = requireProfileUser(req, res, args, store, { sessionOnly: true })
  if (profile == null) return
  const tokenId = pathId(url, '/api/profile/access-tokens')
  if (tokenId == null || tokenId === '') {
    sendJson(res, 400, { error: 'Access token id is required.' }, args.allowOrigin)
    return
  }
  const revoked = revokeRelayAccessToken(store, { tokenId, userId: profile.user.id })
  if (revoked == null) {
    sendJson(res, 404, { error: 'Access token not found.' }, args.allowOrigin)
    return
  }
  await storeRepository.write(store)
  sendJson(res, 200, { revoked: true, token: publicRelayAccessToken(revoked) }, args.allowOrigin)
}

const changePassword = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository
) => {
  const profile = requireProfileUser(req, res, args, store, { sessionOnly: true })
  if (profile == null) return
  const body = await readRequestBody(req)
  const password = typeof body.password === 'string' ? body.password : ''
  if (profile.user.passwordHash != null) {
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
    if (!(await verifyPassword(currentPassword, profile.user.passwordHash))) {
      sendJson(res, 403, { error: 'Current password is invalid.' }, args.allowOrigin)
      return
    }
  }
  try {
    profile.user.passwordHash = await hashPassword(password)
  } catch (error) {
    if (error instanceof PasswordValidationError) {
      sendJson(res, 400, { error: error.message }, args.allowOrigin)
      return
    }
    throw error
  }
  if (profile.user.provider == null) {
    profile.user.provider = 'password'
    profile.user.providerUserId = profile.user.id
  }
  ensureAuthIdentity(store, {
    email: profile.user.email,
    emailVerified: true,
    provider: 'password',
    providerUserId: profile.user.id,
    userId: profile.user.id
  })
  profile.user.updatedAt = now()
  await storeRepository.write(store)
  sendJson(res, 200, { password: { enabled: true } }, args.allowOrigin)
}

const sendPasskeyError = (res: ServerResponse, args: RelayServerArgs, error: unknown) => {
  if (error instanceof RelayPasskeyError) {
    sendJson(res, error.status, {
      code: error.code,
      error: error.message
    }, args.allowOrigin)
    return
  }
  throw error
}

const createPasskeyOptions = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository
) => {
  const profile = requireProfileUser(req, res, args, store, { sessionOnly: true })
  if (profile == null) return
  try {
    const result = await prepareRelayCurrentUserPasskeyRegistration(req, args, store, { user: profile.user })
    await storeRepository.write(store)
    sendJson(res, 200, result, args.allowOrigin)
  } catch (error) {
    sendPasskeyError(res, args, error)
  }
}

const verifyPasskeyRegistration = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository
) => {
  const profile = requireProfileUser(req, res, args, store, { sessionOnly: true })
  if (profile == null) return
  const body = await readRequestBody(req)
  const response = responseFromBody<RegistrationResponseJSON>(body)
  if (response == null) {
    sendJson(res, 400, { code: 'passkey_response_required', error: 'Passkey response required.' }, args.allowOrigin)
    return
  }
  try {
    const result = await verifyRelayCurrentUserPasskeyRegistration(args, store, {
      credentialName: credentialNameFromBody(body),
      response,
      user: profile.user
    })
    await storeRepository.write(store)
    sendJson(res, 200, {
      credential: {
        id: result.credential.id,
        createdAt: result.credential.createdAt,
        lastUsedAt: result.credential.lastUsedAt ?? null,
        name: result.credential.name ?? 'Passkey'
      },
      passkeys: passkeySummary(store, profile.user, args)
    }, args.allowOrigin)
  } catch (error) {
    sendPasskeyError(res, args, error)
  }
}

export const handleProfileRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url: URL
) => {
  if (!url.pathname.startsWith('/api/profile/')) return false

  if (req.method === 'GET' && url.pathname === '/api/profile/security') {
    sendSecuritySummary(req, res, args, store)
    return true
  }
  if (req.method === 'GET' && url.pathname === '/api/profile/openapi-audit') {
    sendOpenApiAuditEvents(req, res, args, store, url)
    return true
  }
  if (req.method === 'POST' && url.pathname === '/api/profile/access-tokens') {
    await createAccessToken(req, res, args, store, storeRepository)
    return true
  }
  if (req.method === 'PATCH' && url.pathname.startsWith('/api/profile/access-tokens/')) {
    await updateAccessToken(req, res, args, store, storeRepository, url)
    return true
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/profile/access-tokens/')) {
    await revokeAccessToken(req, res, args, store, storeRepository, url)
    return true
  }
  if (req.method === 'POST' && url.pathname === '/api/profile/password') {
    await changePassword(req, res, args, store, storeRepository)
    return true
  }
  if (req.method === 'DELETE' && url.pathname === '/api/profile/account') {
    await deleteProfileAccount(req, res, args, store, storeRepository)
    return true
  }
  if (req.method === 'POST' && url.pathname === '/api/profile/passkeys/register/options') {
    await createPasskeyOptions(req, res, args, store, storeRepository)
    return true
  }
  if (req.method === 'POST' && url.pathname === '/api/profile/passkeys/register/verify') {
    await verifyPasskeyRegistration(req, res, args, store, storeRepository)
    return true
  }

  sendJson(res, 404, { error: 'Not found.' }, args.allowOrigin)
  return true
}
