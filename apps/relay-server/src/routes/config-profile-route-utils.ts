import type { ServerResponse } from 'node:http'

import { authContextHasPermission } from '../auth/permissions.js'
import type { RelayAuthContext } from '../auth/permissions.js'
import { sendJson } from '../http.js'
import { relayPermissions } from '../permissions/index.js'
import { canWriteRelayTeamConfigs, findRelayTeam, findRelayTeamMember } from '../teams.js'
import type {
  RelayConfigProfile,
  RelayConfigProfileAssignment,
  RelayConfigProfileVersion,
  RelayServerArgs,
  RelayStore
} from '../types.js'
import { authUserId, isAdminAuth } from './team-route-utils.js'

export const canReadConfigProfileTeam = (store: RelayStore, auth: RelayAuthContext, teamId: string) => (
  isAdminAuth(auth) || (() => {
    const userId = authUserId(auth)
    return authContextHasPermission(auth, relayPermissions.relayTeamsRead) &&
      userId != null &&
      findRelayTeamMember(store, teamId, userId) != null
  })()
)

export const canWriteConfigProfileTeam = (store: RelayStore, auth: RelayAuthContext, teamId: string) => (
  isAdminAuth(auth) || (() => {
    const userId = authUserId(auth)
    return canWriteRelayTeamConfigs(userId == null ? undefined : findRelayTeamMember(store, teamId, userId))
  })()
)

export const ensureWritableConfigProfileTeam = (
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  auth: RelayAuthContext,
  teamId: string
) => {
  if (!canWriteConfigProfileTeam(store, auth, teamId)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return false
  }
  if (!store.teamPolicy.teamsEnabled) {
    sendJson(res, 403, { error: 'Team sharing is disabled by tenant policy.' }, args.allowOrigin)
    return false
  }
  return true
}

export const findConfigProfile = (store: RelayStore, profileId: string) =>
  store.configProfiles.find(profile => profile.id === profileId)

export const findConfigProfileVersion = (store: RelayStore, versionId: string | undefined) =>
  versionId == null ? undefined : store.configProfileVersions.find(version => version.id === versionId)

export const profileVersions = (store: RelayStore, profileId: string) =>
  store.configProfileVersions
    .filter(version => version.profileId === profileId)
    .sort((left, right) => left.version - right.version)

export const profileAssignments = (store: RelayStore, profileId: string) =>
  store.configProfileAssignments
    .filter(assignment => assignment.profileId === profileId)
    .sort((left, right) =>
      left.priority - right.priority ||
      (left.updatedAt ?? left.createdAt).localeCompare(right.updatedAt ?? right.createdAt) ||
      left.id.localeCompare(right.id)
    )

export const serializeConfigProfile = (profile: RelayConfigProfile, store: RelayStore) => {
  const team = findRelayTeam(store, profile.teamId)
  return {
    id: profile.id,
    teamId: profile.teamId,
    teamName: team?.name ?? null,
    name: profile.name,
    description: profile.description ?? null,
    status: profile.status,
    activeVersionId: profile.activeVersionId ?? null,
    versionCount: profileVersions(store, profile.id).length,
    assignmentCount: profileAssignments(store, profile.id).length,
    createdByUserId: profile.createdByUserId,
    updatedByUserId: profile.updatedByUserId ?? null,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt ?? null
  }
}

export const serializeConfigProfileVersion = (version: RelayConfigProfileVersion) => ({
  id: version.id,
  profileId: version.profileId,
  version: version.version,
  allowedFields: version.allowedFields,
  configPatch: version.configPatch,
  secretRefs: version.secretRefs ?? {},
  sourceHash: version.sourceHash,
  createdByUserId: version.createdByUserId,
  changeNote: version.changeNote ?? null,
  createdAt: version.createdAt
})

export const serializeConfigProfileAssignment = (assignment: RelayConfigProfileAssignment) => ({
  id: assignment.id,
  profileId: assignment.profileId,
  versionId: assignment.versionId ?? null,
  priority: assignment.priority,
  target: assignment.target ?? null,
  project: assignment.project ?? null,
  mode: assignment.mode,
  enabled: assignment.enabled,
  createdAt: assignment.createdAt,
  updatedAt: assignment.updatedAt ?? null
})

export const serializeConfigProfileDetail = (profile: RelayConfigProfile, store: RelayStore) => ({
  profile: serializeConfigProfile(profile, store),
  versions: profileVersions(store, profile.id).map(serializeConfigProfileVersion),
  assignments: profileAssignments(store, profile.id).map(serializeConfigProfileAssignment)
})
