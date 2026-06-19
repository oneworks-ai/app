import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { RelayAuthContext } from '../auth/permissions.js'
import { readRequestBody, sendJson } from '../http.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import { userTeamCount } from '../teams.js'
import type { RelayServerArgs, RelayStore, RelayTeam, RelayTeamMember } from '../types.js'
import { now } from '../utils.js'
import {
  authUserId,
  canWriteTeam,
  cleanAvatarUrl,
  cleanSlug,
  cleanString,
  ensureTeamsWritable,
  firstCleanString,
  isAdminAuth,
  policyLimitExceeded,
  serializeTeam
} from './team-route-utils.js'

export const createTeam = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  auth: RelayAuthContext,
  adminRoute: boolean
) => {
  if (!ensureTeamsWritable(res, args, store.teamPolicy)) return
  if (!adminRoute && !isAdminAuth(auth) && !store.teamPolicy.selfServiceTeamCreation) {
    sendJson(res, 403, { error: 'Self-service team creation is disabled by tenant policy.' }, args.allowOrigin)
    return
  }
  if (policyLimitExceeded(store.teamPolicy.maxTeamsPerTenant, store.teams.length)) {
    sendJson(res, 403, { error: 'Tenant team limit reached.' }, args.allowOrigin)
    return
  }

  const body = await readRequestBody(req)
  const name = cleanString(body.name)
  if (name === '') {
    sendJson(res, 400, { error: 'Team name is required.' }, args.allowOrigin)
    return
  }
  const ownerUserId = authUserId(auth) ?? firstCleanString(body.ownerUserId, body.createdByUserId)
  const owner = store.users.find(user => user.id === ownerUserId)
  if (owner == null) {
    sendJson(res, 400, { error: 'Team owner user is required.' }, args.allowOrigin)
    return
  }
  if (policyLimitExceeded(store.teamPolicy.maxTeamsPerUser, userTeamCount(store, owner.id))) {
    sendJson(res, 403, { error: 'User team limit reached.' }, args.allowOrigin)
    return
  }

  const slug = cleanSlug(body.slug, name)
  if (store.teams.some(team => team.slug === slug)) {
    sendJson(res, 409, { error: 'Team slug already exists.' }, args.allowOrigin)
    return
  }
  const avatarUrl = cleanAvatarUrl(body.avatarUrl)
  if (!avatarUrl.ok) {
    sendJson(res, 400, { error: avatarUrl.error }, args.allowOrigin)
    return
  }
  const team: RelayTeam = {
    id: randomUUID(),
    slug,
    name,
    ...(cleanString(body.description) === '' ? {} : { description: cleanString(body.description) }),
    ...(avatarUrl.value == null ? {} : { avatarUrl: avatarUrl.value }),
    createdByUserId: owner.id,
    createdAt: now()
  }
  const member: RelayTeamMember = {
    id: randomUUID(),
    teamId: team.id,
    userId: owner.id,
    role: 'owner',
    configEnabled: true,
    defaultForPublishing: true,
    createdByUserId: owner.id,
    createdAt: team.createdAt
  }
  store.teams.push(team)
  store.teamMembers.push(member)
  await storeRepository.write(store)
  sendJson(res, 200, { team: serializeTeam(team, store, owner.id) }, args.allowOrigin)
}

export const updateTeam = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  auth: RelayAuthContext,
  team: RelayTeam
) => {
  if (!canWriteTeam(store, auth, team.id)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return
  }
  const body = await readRequestBody(req)
  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = cleanString(body.name)
    if (name === '') {
      sendJson(res, 400, { error: 'Team name is required.' }, args.allowOrigin)
      return
    }
    team.name = name
  }
  if (Object.prototype.hasOwnProperty.call(body, 'slug')) {
    const slug = cleanSlug(body.slug, team.name)
    if (store.teams.some(item => item.id !== team.id && item.slug === slug)) {
      sendJson(res, 409, { error: 'Team slug already exists.' }, args.allowOrigin)
      return
    }
    team.slug = slug
  }
  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    team.description = cleanString(body.description) === '' ? undefined : cleanString(body.description)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'avatarUrl')) {
    const avatarUrl = cleanAvatarUrl(body.avatarUrl)
    if (!avatarUrl.ok) {
      sendJson(res, 400, { error: avatarUrl.error }, args.allowOrigin)
      return
    }
    team.avatarUrl = avatarUrl.value
  }
  if (Object.prototype.hasOwnProperty.call(body, 'proxyModeEnabled')) {
    if (!isAdminAuth(auth)) {
      sendJson(res, 403, { error: 'Team proxy mode can only be managed by tenant admins.' }, args.allowOrigin)
      return
    }
    if (typeof body.proxyModeEnabled !== 'boolean') {
      sendJson(res, 400, { error: 'Team proxy mode state must be a boolean.' }, args.allowOrigin)
      return
    }
    team.proxyModeEnabled = body.proxyModeEnabled
  }
  team.updatedAt = now()
  await storeRepository.write(store)
  sendJson(res, 200, { team: serializeTeam(team, store, authUserId(auth)) }, args.allowOrigin)
}

export const archiveTeam = async (
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  auth: RelayAuthContext,
  team: RelayTeam
) => {
  if (!canWriteTeam(store, auth, team.id)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return
  }
  team.archivedAt = now()
  team.updatedAt = team.archivedAt
  await storeRepository.write(store)
  sendJson(res, 200, { team: serializeTeam(team, store, authUserId(auth)) }, args.allowOrigin)
}

export const restoreTeam = async (
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  auth: RelayAuthContext,
  team: RelayTeam
) => {
  if (!canWriteTeam(store, auth, team.id)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return
  }
  team.archivedAt = undefined
  team.updatedAt = now()
  await storeRepository.write(store)
  sendJson(res, 200, { team: serializeTeam(team, store, authUserId(auth)) }, args.allowOrigin)
}
