import type { IncomingMessage, ServerResponse } from 'node:http'

import { authContextHasPermission, resolveAuthContext } from '../auth/permissions.js'
import { sendJson } from '../http.js'
import { relayPermissions } from '../permissions/index.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import { findRelayTeam } from '../teams.js'
import type { RelayAuditLogEntry, RelayServerArgs, RelayStore } from '../types.js'
import { archiveTeam, createTeam, restoreTeam, updateTeam } from './team-actions.js'
import { createTeamInvitation, listTeamInvitations } from './team-invitations.js'
import { createMember, deleteMember, listMembers, updateMember } from './team-members.js'
import {
  authUserId,
  canReadTeam,
  isAdminAuth,
  pathId,
  serializePolicy,
  serializeTeam,
  visibleTeams
} from './team-route-utils.js'

const serializeAuditEvent = (event: RelayAuditLogEntry) => ({
  id: event.id,
  actor: event.actor,
  action: event.action,
  resource: event.resource,
  status: event.status,
  ip: event.ip ?? null,
  userAgent: event.userAgent ?? null,
  requestId: event.requestId ?? null,
  createdAt: event.createdAt
})

const listTeamAuditEvents = (
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  teamId: string
) => {
  const resource = `team:${teamId}`
  const events = store.auditEvents
    .filter(event => event.resource === resource)
    .slice()
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 100)
    .map(serializeAuditEvent)
  sendJson(res, 200, { events }, args.allowOrigin)
}

export const handleTeamsRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url: URL
) => {
  const adminRoute = url.pathname === '/api/admin/teams' || url.pathname.startsWith('/api/admin/teams/')
  const relayRoute = url.pathname === '/api/relay/teams' || url.pathname.startsWith('/api/relay/teams/')
  if (!adminRoute && !relayRoute) return false

  const auth = resolveAuthContext(req, args, store)
  if (auth == null) {
    sendJson(res, 401, { error: adminRoute ? 'Admin token required.' : 'Authentication required.' }, args.allowOrigin)
    return true
  }
  if (adminRoute && !isAdminAuth(auth)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return true
  }
  if (!authContextHasPermission(auth, relayPermissions.relayTeamsRead)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return true
  }

  const prefix = adminRoute ? '/api/admin/teams' : '/api/relay/teams'
  const idOrRest = pathId(url, prefix)
  if (req.method === 'GET' && idOrRest == null) {
    const teams = visibleTeams(store, auth, adminRoute)
      .map(team => serializeTeam(team, store, authUserId(auth)))
    sendJson(res, 200, { policy: serializePolicy(store.teamPolicy), teams }, args.allowOrigin)
    return true
  }
  if (req.method === 'POST' && idOrRest == null) {
    await createTeam(req, res, args, store, storeRepository, auth, adminRoute)
    return true
  }
  if (idOrRest == null) {
    sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
    return true
  }

  const segments = idOrRest.split('/').filter(segment => segment !== '')
  const team = findRelayTeam(store, segments[0])
  if (team == null) {
    sendJson(res, 404, { error: 'Team not found.' }, args.allowOrigin)
    return true
  }
  if (segments.length === 1) {
    if (req.method === 'GET') {
      if (!canReadTeam(store, auth, team.id)) {
        sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
        return true
      }
      sendJson(res, 200, { team: serializeTeam(team, store, authUserId(auth)) }, args.allowOrigin)
      return true
    }
    if (req.method === 'PATCH') {
      await updateTeam(req, res, args, store, storeRepository, auth, team)
      return true
    }
  }
  if (segments.length === 2 && segments[1] === 'archive' && req.method === 'POST') {
    await archiveTeam(res, args, store, storeRepository, auth, team)
    return true
  }
  if (segments.length === 2 && segments[1] === 'restore' && req.method === 'POST') {
    await restoreTeam(res, args, store, storeRepository, auth, team)
    return true
  }
  if (segments.length === 2 && segments[1] === 'audit-events' && req.method === 'GET') {
    if (!canReadTeam(store, auth, team.id)) {
      sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
      return true
    }
    listTeamAuditEvents(res, args, store, team.id)
    return true
  }
  if (segments.length === 2 && segments[1] === 'members') {
    if (req.method === 'GET') {
      listMembers(res, args, store, auth, team)
      return true
    }
    if (req.method === 'POST') {
      await createMember(req, res, args, store, storeRepository, auth, team)
      return true
    }
  }
  if (segments.length === 2 && segments[1] === 'invitations') {
    if (req.method === 'GET') {
      listTeamInvitations(res, args, store, auth, team)
      return true
    }
    if (req.method === 'POST') {
      await createTeamInvitation(req, res, args, store, storeRepository, auth, team)
      return true
    }
  }
  if (segments.length === 3 && segments[1] === 'members') {
    if (req.method === 'PATCH') {
      await updateMember(req, res, args, store, storeRepository, auth, team, segments[2])
      return true
    }
    if (req.method === 'DELETE') {
      await deleteMember(res, args, store, storeRepository, auth, team, segments[2])
      return true
    }
  }

  sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
  return true
}
