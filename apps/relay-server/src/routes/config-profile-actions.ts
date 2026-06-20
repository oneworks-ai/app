import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { RelayAuthContext } from '../auth/permissions.js'
import { readRequestBody, sendJson } from '../http.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayConfigProfile, RelayServerArgs, RelayStore, RelayTeam } from '../types.js'
import { now } from '../utils.js'
import { ensureWritableConfigProfileTeam, serializeConfigProfileDetail } from './config-profile-route-utils.js'
import { authUserId, cleanString, policyLimitExceeded } from './team-route-utils.js'

export const createConfigProfile = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  auth: RelayAuthContext,
  team: RelayTeam
) => {
  if (!ensureWritableConfigProfileTeam(res, args, store, auth, team.id)) return
  const profileCount = store.configProfiles.filter(profile => profile.teamId === team.id).length
  if (policyLimitExceeded(store.teamPolicy.maxProfilesPerTeam, profileCount)) {
    sendJson(res, 403, { error: 'Team profile limit reached.' }, args.allowOrigin)
    return
  }
  const body = await readRequestBody(req)
  const name = cleanString(body.name)
  if (name === '') {
    sendJson(res, 400, { error: 'Config profile name is required.' }, args.allowOrigin)
    return
  }
  const createdAt = now()
  const profile: RelayConfigProfile = {
    id: randomUUID(),
    teamId: team.id,
    name,
    ...(cleanString(body.description) === '' ? {} : { description: cleanString(body.description) }),
    status: 'draft',
    createdByUserId: authUserId(auth) ?? 'system',
    createdAt
  }
  store.configProfiles.push(profile)
  await storeRepository.write(store)
  sendJson(res, 200, serializeConfigProfileDetail(profile, store), args.allowOrigin)
}

export const updateConfigProfile = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  auth: RelayAuthContext,
  profile: RelayConfigProfile
) => {
  if (!ensureWritableConfigProfileTeam(res, args, store, auth, profile.teamId)) return
  const body = await readRequestBody(req)
  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = cleanString(body.name)
    if (name === '') {
      sendJson(res, 400, { error: 'Config profile name is required.' }, args.allowOrigin)
      return
    }
    profile.name = name
  }
  if (Object.prototype.hasOwnProperty.call(body, 'description')) {
    profile.description = cleanString(body.description) === '' ? undefined : cleanString(body.description)
  }
  if (Object.prototype.hasOwnProperty.call(body, 'disabled')) {
    if (typeof body.disabled !== 'boolean') {
      sendJson(res, 400, { error: 'Config profile disabled state must be a boolean.' }, args.allowOrigin)
      return
    }
    profile.status = body.disabled ? 'disabled' : profile.activeVersionId == null ? 'draft' : 'published'
  }
  profile.updatedAt = now()
  profile.updatedByUserId = authUserId(auth)
  await storeRepository.write(store)
  sendJson(res, 200, serializeConfigProfileDetail(profile, store), args.allowOrigin)
}
