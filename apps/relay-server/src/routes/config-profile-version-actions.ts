import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { RelayAuthContext } from '../auth/permissions.js'
import {
  hashRelayConfigProfileSource,
  nextConfigProfileVersionNumber,
  normalizeRelayConfigProfileVersion
} from '../config-profiles.js'
import { filterRelayConfigPatch, normalizeRelayConfigSafeFields } from '../config-snapshot-normalize.js'
import { readRequestBody, sendJson } from '../http.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayConfigPatch, RelayConfigProfile, RelayServerArgs, RelayStore } from '../types.js'
import { now } from '../utils.js'
import {
  ensureWritableConfigProfileTeam,
  findConfigProfileVersion,
  profileVersions,
  serializeConfigProfileDetail,
  serializeConfigProfileVersion
} from './config-profile-route-utils.js'
import { authUserId, cleanString } from './team-route-utils.js'

export const createConfigProfileVersion = async (
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
  const allowedFields = normalizeRelayConfigSafeFields(body.allowedFields)
  const configPatch = filterRelayConfigPatch(body.configPatch as RelayConfigPatch | undefined, allowedFields)
  if (configPatch == null) {
    sendJson(res, 400, { error: 'Config profile version requires a safe config patch.' }, args.allowOrigin)
    return
  }
  const version = normalizeRelayConfigProfileVersion({
    id: randomUUID(),
    profileId: profile.id,
    version: nextConfigProfileVersionNumber(store.configProfileVersions, profile.id),
    allowedFields,
    configPatch,
    secretRefs: body.secretRefs,
    sourceHash: hashRelayConfigProfileSource({ allowedFields, configPatch, secretRefs: body.secretRefs }),
    createdByUserId: authUserId(auth) ?? 'system',
    changeNote: body.changeNote,
    createdAt: now()
  })
  if (version == null) {
    sendJson(res, 400, { error: 'Config profile version is invalid.' }, args.allowOrigin)
    return
  }
  store.configProfileVersions.push(version)
  profile.updatedAt = version.createdAt
  profile.updatedByUserId = authUserId(auth)
  await storeRepository.write(store)
  sendJson(res, 200, { version: serializeConfigProfileVersion(version) }, args.allowOrigin)
}

export const publishConfigProfile = async (
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
  const version = findConfigProfileVersion(store, cleanString(body.versionId)) ??
    profileVersions(store, profile.id).at(-1)
  if (version == null || version.profileId !== profile.id) {
    sendJson(res, 400, { error: 'Published version is required.' }, args.allowOrigin)
    return
  }
  profile.activeVersionId = version.id
  profile.status = 'published'
  profile.updatedAt = now()
  profile.updatedByUserId = authUserId(auth)
  await storeRepository.write(store)
  sendJson(res, 200, serializeConfigProfileDetail(profile, store), args.allowOrigin)
}
