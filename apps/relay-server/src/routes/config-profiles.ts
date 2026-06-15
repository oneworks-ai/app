import type { IncomingMessage, ServerResponse } from 'node:http'

import { authContextHasPermission, resolveAuthContext } from '../auth/permissions.js'
import { sendJson } from '../http.js'
import { relayPermissions } from '../permissions/index.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import { findRelayTeam } from '../teams.js'
import type { RelayServerArgs, RelayStore } from '../types.js'
import { createConfigProfile, updateConfigProfile } from './config-profile-actions.js'
import { createConfigProfileAssignment, updateConfigProfileAssignment } from './config-profile-assignment-actions.js'
import {
  canReadConfigProfileTeam,
  findConfigProfile,
  serializeConfigProfile,
  serializeConfigProfileDetail
} from './config-profile-route-utils.js'
import { createConfigProfileVersion, publishConfigProfile } from './config-profile-version-actions.js'
import { isAdminAuth, pathId } from './team-route-utils.js'

const routeKind = (url: URL, leaf: string) => (
  url.pathname === `/api/admin/${leaf}` || url.pathname.startsWith(`/api/admin/${leaf}/`)
    ? 'admin'
    : url.pathname === `/api/relay/${leaf}` || url.pathname.startsWith(`/api/relay/${leaf}/`)
    ? 'relay'
    : undefined
)

const requireProfileAuth = (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  adminRoute: boolean
) => {
  const auth = resolveAuthContext(req, args, store)
  if (auth == null) {
    sendJson(res, 401, { error: adminRoute ? 'Admin token required.' : 'Authentication required.' }, args.allowOrigin)
    return undefined
  }
  if (adminRoute && !isAdminAuth(auth)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return undefined
  }
  if (!authContextHasPermission(auth, relayPermissions.relayTeamsRead)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return undefined
  }
  return auth
}

export const handleTeamConfigProfilesRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url: URL
) => {
  const adminRoute = url.pathname.startsWith('/api/admin/teams/')
  const relayRoute = url.pathname.startsWith('/api/relay/teams/')
  if (!adminRoute && !relayRoute) return false
  const prefix = adminRoute ? '/api/admin/teams' : '/api/relay/teams'
  const segments = pathId(url, prefix)?.split('/').filter(Boolean) ?? []
  if (segments.length !== 2 || segments[1] !== 'config-profiles') return false

  const auth = requireProfileAuth(req, res, args, store, adminRoute)
  if (auth == null) return true
  const team = findRelayTeam(store, segments[0])
  if (team == null) {
    sendJson(res, 404, { error: 'Team not found.' }, args.allowOrigin)
    return true
  }
  if (!canReadConfigProfileTeam(store, auth, team.id)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return true
  }
  if (req.method === 'GET') {
    const profiles = store.configProfiles
      .filter(profile => profile.teamId === team.id)
      .map(profile => serializeConfigProfile(profile, store))
    sendJson(res, 200, { profiles }, args.allowOrigin)
    return true
  }
  if (req.method === 'POST') {
    await createConfigProfile(req, res, args, store, storeRepository, auth, team)
    return true
  }
  sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
  return true
}

export const handleConfigProfilesRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url: URL
) => {
  const kind = routeKind(url, 'config-profiles')
  if (kind == null) return false
  const idOrRest = pathId(url, `/api/${kind}/config-profiles`)
  if (idOrRest == null) return false
  const auth = requireProfileAuth(req, res, args, store, kind === 'admin')
  if (auth == null) return true
  const segments = idOrRest.split('/').filter(Boolean)
  const profile = findConfigProfile(store, segments[0])
  if (profile == null) {
    sendJson(res, 404, { error: 'Config profile not found.' }, args.allowOrigin)
    return true
  }
  if (!canReadConfigProfileTeam(store, auth, profile.teamId)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return true
  }
  if (segments.length === 1) {
    if (req.method === 'GET') sendJson(res, 200, serializeConfigProfileDetail(profile, store), args.allowOrigin)
    else if (req.method === 'PATCH') await updateConfigProfile(req, res, args, store, storeRepository, auth, profile)
    else sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
    return true
  }
  if (segments.length === 2 && segments[1] === 'versions' && req.method === 'POST') {
    await createConfigProfileVersion(req, res, args, store, storeRepository, auth, profile)
    return true
  }
  if (segments.length === 2 && segments[1] === 'publish' && req.method === 'POST') {
    await publishConfigProfile(req, res, args, store, storeRepository, auth, profile)
    return true
  }
  if (segments.length === 2 && segments[1] === 'assignments' && req.method === 'POST') {
    await createConfigProfileAssignment(req, res, args, store, storeRepository, auth, profile)
    return true
  }
  sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
  return true
}

export const handleConfigProfileAssignmentsRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url: URL
) => {
  const kind = routeKind(url, 'config-assignments')
  if (kind == null) return false
  const assignmentId = pathId(url, `/api/${kind}/config-assignments`)
  if (assignmentId == null) return false
  const auth = requireProfileAuth(req, res, args, store, kind === 'admin')
  if (auth == null) return true
  const assignment = store.configProfileAssignments.find(item => item.id === assignmentId)
  const profile = assignment == null ? undefined : findConfigProfile(store, assignment.profileId)
  if (assignment == null || profile == null) {
    sendJson(res, 404, { error: 'Config assignment not found.' }, args.allowOrigin)
    return true
  }
  if (req.method === 'PATCH') {
    await updateConfigProfileAssignment(req, res, args, store, storeRepository, auth, assignment, profile)
    return true
  }
  sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
  return true
}
