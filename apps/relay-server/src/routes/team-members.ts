/* eslint-disable max-lines -- Team member route handlers keep member mutation policy together. */

import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { defaultTeamAccessGroupIds, resolveUserPlatformAccess, teamAccessGroupsForTeam } from '../access-groups.js'
import type { RelayAuthContext } from '../auth/permissions.js'
import { readRequestBody, sendJson } from '../http.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import { findRelayTeamMember, isRelayTeamRole, teamMemberCount, userTeamCount } from '../teams.js'
import type { RelayServerArgs, RelayStore, RelayTeam, RelayTeamMember } from '../types.js'
import { now } from '../utils.js'
import {
  authUserId,
  canReadTeam,
  canWriteTeamMembers,
  findUserByInput,
  isLastTeamOwner,
  policyLimitExceeded,
  serializeTeamMember
} from './team-route-utils.js'

const readGroupIds = (value: unknown) => (
  Array.isArray(value)
    ? [
      ...new Set(
        value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map(item => item.trim())
      )
    ]
    : undefined
)

const validateTeamGroupIds = (team: RelayTeam, groupIds: string[]) => (
  groupIds.every(groupId => teamAccessGroupsForTeam(team).some(group => group.id === groupId && group.scope === 'team'))
)

const userJoinedTeamQuotaExceeded = (store: RelayStore, userId: string) => {
  const user = store.users.find(item => item.id === userId)
  if (user == null) return false
  const limit = resolveUserPlatformAccess(store, user).quotas.maxTeamsJoined
  return limit != null && userTeamCount(store, user.id) >= limit
}

export const listMembers = (
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  auth: RelayAuthContext,
  team: RelayTeam
) => {
  if (!canReadTeam(store, auth, team.id)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return
  }
  const members = store.teamMembers
    .filter(member => member.teamId === team.id)
    .map(member => serializeTeamMember(member, store, store.users.find(user => user.id === member.userId)))
  sendJson(res, 200, { members }, args.allowOrigin)
}

export const createMember = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  auth: RelayAuthContext,
  team: RelayTeam
) => {
  if (!canWriteTeamMembers(store, auth, team.id)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return
  }
  if (policyLimitExceeded(store.teamPolicy.maxMembersPerTeam, teamMemberCount(store, team.id))) {
    sendJson(res, 403, { error: 'Team member limit reached.' }, args.allowOrigin)
    return
  }
  const body = await readRequestBody(req)
  const user = findUserByInput(store, body)
  if (user == null) {
    sendJson(res, 404, { error: 'User not found.' }, args.allowOrigin)
    return
  }
  if (findRelayTeamMember(store, team.id, user.id) != null) {
    sendJson(res, 409, { error: 'Team member already exists.' }, args.allowOrigin)
    return
  }
  if (userJoinedTeamQuotaExceeded(store, user.id)) {
    sendJson(res, 403, { error: 'User joined team quota reached.' }, args.allowOrigin)
    return
  }
  const role = isRelayTeamRole(body.role) ? body.role : 'member'
  const groupIds = readGroupIds(body.groupIds) ?? defaultTeamAccessGroupIds(role)
  if (!validateTeamGroupIds(team, groupIds)) {
    sendJson(res, 400, { error: 'Invalid team access group.' }, args.allowOrigin)
    return
  }
  const member: RelayTeamMember = {
    id: randomUUID(),
    teamId: team.id,
    userId: user.id,
    role,
    groupIds,
    configEnabled: body.configEnabled !== false,
    defaultForPublishing: body.defaultForPublishing === true,
    createdByUserId: authUserId(auth) ?? 'system',
    createdAt: now()
  }
  store.teamMembers.push(member)
  await storeRepository.write(store)
  sendJson(res, 200, { member: serializeTeamMember(member, store, user) }, args.allowOrigin)
}

export const updateMember = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  auth: RelayAuthContext,
  team: RelayTeam,
  userId: string
) => {
  if (!canWriteTeamMembers(store, auth, team.id)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return
  }
  const member = findRelayTeamMember(store, team.id, userId)
  if (member == null) {
    sendJson(res, 404, { error: 'Team member not found.' }, args.allowOrigin)
    return
  }
  const body = await readRequestBody(req)
  if (Object.prototype.hasOwnProperty.call(body, 'role')) {
    if (!isRelayTeamRole(body.role)) {
      sendJson(res, 400, { error: 'Invalid team role.' }, args.allowOrigin)
      return
    }
    if (member.role === 'owner' && body.role !== 'owner' && isLastTeamOwner(store, member)) {
      sendJson(res, 400, { error: 'Team must keep at least one owner.' }, args.allowOrigin)
      return
    }
    member.role = body.role
    if (!Object.prototype.hasOwnProperty.call(body, 'groupIds')) member.groupIds = defaultTeamAccessGroupIds(body.role)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'groupIds')) {
    const groupIds = readGroupIds(body.groupIds)
    if (groupIds == null) {
      sendJson(res, 400, { error: 'Team group IDs must be an array.' }, args.allowOrigin)
      return
    }
    if (!validateTeamGroupIds(team, groupIds)) {
      sendJson(res, 400, { error: 'Invalid team access group.' }, args.allowOrigin)
      return
    }
    member.groupIds = groupIds.length === 0 ? defaultTeamAccessGroupIds(member.role) : groupIds
  }
  if (Object.prototype.hasOwnProperty.call(body, 'configEnabled')) {
    if (typeof body.configEnabled !== 'boolean') {
      sendJson(res, 400, { error: 'Member config enabled state must be a boolean.' }, args.allowOrigin)
      return
    }
    member.configEnabled = body.configEnabled
  }
  if (Object.prototype.hasOwnProperty.call(body, 'defaultForPublishing')) {
    if (typeof body.defaultForPublishing !== 'boolean') {
      sendJson(res, 400, { error: 'Default publishing state must be a boolean.' }, args.allowOrigin)
      return
    }
    member.defaultForPublishing = body.defaultForPublishing
  }
  member.updatedAt = now()
  await storeRepository.write(store)
  sendJson(res, 200, {
    member: serializeTeamMember(member, store, store.users.find(user => user.id === member.userId))
  }, args.allowOrigin)
}

export const deleteMember = async (
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  auth: RelayAuthContext,
  team: RelayTeam,
  userId: string
) => {
  if (!canWriteTeamMembers(store, auth, team.id)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return
  }
  const index = store.teamMembers.findIndex(member => member.teamId === team.id && member.userId === userId)
  if (index === -1) {
    sendJson(res, 404, { error: 'Team member not found.' }, args.allowOrigin)
    return
  }
  if (isLastTeamOwner(store, store.teamMembers[index])) {
    sendJson(res, 400, { error: 'Team must keep at least one owner.' }, args.allowOrigin)
    return
  }
  const [member] = store.teamMembers.splice(index, 1)
  await storeRepository.write(store)
  sendJson(res, 200, { deleted: true, member: serializeTeamMember(member, store, undefined) }, args.allowOrigin)
}
