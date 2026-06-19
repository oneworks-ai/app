import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { RelayAuthContext } from '../auth/permissions.js'
import { normalizeRelayConfigProfileAssignment } from '../config-profiles.js'
import { readRequestBody, sendJson } from '../http.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayConfigProfile, RelayConfigProfileAssignment, RelayServerArgs, RelayStore } from '../types.js'
import { now } from '../utils.js'
import {
  ensureWritableConfigProfileTeam,
  findConfigProfileVersion,
  profileAssignments,
  serializeConfigProfileAssignment
} from './config-profile-route-utils.js'
import { cleanString, policyLimitExceeded } from './team-route-utils.js'

export const createConfigProfileAssignment = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  auth: RelayAuthContext,
  profile: RelayConfigProfile
) => {
  if (!ensureWritableConfigProfileTeam(res, args, store, auth, profile.teamId)) return
  if (policyLimitExceeded(store.teamPolicy.maxAssignmentsPerProfile, profileAssignments(store, profile.id).length)) {
    sendJson(res, 403, { error: 'Config profile assignment limit reached.' }, args.allowOrigin)
    return
  }
  const body = await readRequestBody(req)
  const versionId = cleanString(body.versionId) || profile.activeVersionId
  if (findConfigProfileVersion(store, versionId)?.profileId !== profile.id) {
    sendJson(res, 400, { error: 'Config assignment version is required.' }, args.allowOrigin)
    return
  }
  const assignment = normalizeRelayConfigProfileAssignment({
    id: randomUUID(),
    profileId: profile.id,
    versionId,
    priority: body.priority,
    target: body.target ?? { teamIds: [profile.teamId] },
    project: body.project,
    mode: body.mode,
    enabled: body.enabled,
    createdAt: now()
  })
  if (assignment == null) {
    sendJson(res, 400, { error: 'Config assignment is invalid.' }, args.allowOrigin)
    return
  }
  store.configProfileAssignments.push(assignment)
  await storeRepository.write(store)
  sendJson(res, 200, { assignment: serializeConfigProfileAssignment(assignment) }, args.allowOrigin)
}

export const updateConfigProfileAssignment = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  auth: RelayAuthContext,
  assignment: RelayConfigProfileAssignment,
  profile: RelayConfigProfile
) => {
  if (!ensureWritableConfigProfileTeam(res, args, store, auth, profile.teamId)) return
  const body = await readRequestBody(req)
  const versionId = Object.prototype.hasOwnProperty.call(body, 'versionId')
    ? cleanString(body.versionId)
    : assignment.versionId
  if (versionId != null && versionId !== '' && findConfigProfileVersion(store, versionId)?.profileId !== profile.id) {
    sendJson(res, 400, { error: 'Config assignment version is invalid.' }, args.allowOrigin)
    return
  }
  const normalized = normalizeRelayConfigProfileAssignment({
    ...assignment,
    ...(Object.prototype.hasOwnProperty.call(body, 'versionId') ? { versionId } : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'priority') ? { priority: body.priority } : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'target') ? { target: body.target } : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'project') ? { project: body.project } : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'mode') ? { mode: body.mode } : {}),
    ...(Object.prototype.hasOwnProperty.call(body, 'enabled') ? { enabled: body.enabled } : {}),
    updatedAt: now()
  })
  if (normalized == null) {
    sendJson(res, 400, { error: 'Config assignment update is invalid.' }, args.allowOrigin)
    return
  }
  Object.assign(assignment, normalized)
  await storeRepository.write(store)
  sendJson(res, 200, { assignment: serializeConfigProfileAssignment(assignment) }, args.allowOrigin)
}
