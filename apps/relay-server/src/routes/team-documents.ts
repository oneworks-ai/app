import type { IncomingMessage, ServerResponse } from 'node:http'

import { authContextHasPermission, resolveAuthContext } from '../auth/permissions.js'
import { readRequestBody, sendJson } from '../http.js'
import { relayPermissions } from '../permissions/index.js'
import { normalizeRelayPersonalDocumentSnapshot } from '../personal-config.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import { upsertRelayTeamDocumentSnapshot } from '../team-documents.js'
import { findRelayTeam } from '../teams.js'
import type { RelayServerArgs, RelayStore, RelayTeamDocumentSnapshot } from '../types.js'
import { canReadConfigProfileTeam, canWriteConfigProfileTeam } from './config-profile-route-utils.js'
import { isAdminAuth, pathId } from './team-route-utils.js'

const serializeTeamDocumentSnapshot = (snapshot: RelayTeamDocumentSnapshot | undefined) => (
  snapshot == null
    ? null
    : {
      countsByKind: snapshot.countsByKind,
      documentCount: snapshot.documentCount,
      encryptedPayload: snapshot.encryptedPayload,
      hash: snapshot.hash,
      teamId: snapshot.teamId,
      totalSizeBytes: snapshot.totalSizeBytes,
      updatedAt: snapshot.updatedAt,
      updatedByUserId: snapshot.updatedByUserId ?? null,
      version: snapshot.version
    }
)

const pickDocumentsPayload = (body: Record<string, unknown>) => {
  if (typeof body.documents === 'object' && body.documents != null) return body.documents
  if (typeof body.documentSnapshot === 'object' && body.documentSnapshot != null) return body.documentSnapshot
  if (typeof body.teamDocumentSnapshot === 'object' && body.teamDocumentSnapshot != null) {
    return body.teamDocumentSnapshot
  }
  return undefined
}

const requireTeamDocumentAuth = (
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

export const handleTeamDocumentsRoute = async (
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
  if (segments.length !== 2 || segments[1] !== 'documents') return false

  const auth = requireTeamDocumentAuth(req, res, args, store, adminRoute)
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

  const existing = store.teamDocumentSnapshots?.find(item => item.teamId === team.id)
  if (req.method === 'GET') {
    sendJson(res, 200, { teamDocumentSnapshot: serializeTeamDocumentSnapshot(existing) }, args.allowOrigin)
    return true
  }
  if (req.method !== 'PUT' && req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
    return true
  }
  if (!canWriteConfigProfileTeam(store, auth, team.id)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return true
  }
  if (!store.teamPolicy.teamsEnabled) {
    sendJson(res, 403, { error: 'Team sharing is disabled by tenant policy.' }, args.allowOrigin)
    return true
  }

  const body = await readRequestBody(req)
  const baseHash = typeof body.baseHash === 'string' && body.baseHash.trim() !== '' ? body.baseHash.trim() : undefined
  if (existing != null && baseHash != null && baseHash !== existing.hash && body.force !== true) {
    sendJson(res, 409, {
      error: 'Relay team document snapshot has changed on the server.',
      teamDocumentSnapshot: serializeTeamDocumentSnapshot(existing)
    }, args.allowOrigin)
    return true
  }

  const documents = normalizeRelayPersonalDocumentSnapshot(pickDocumentsPayload(body))
  if (documents == null) {
    sendJson(res, 400, { error: 'A valid encrypted document snapshot is required.' }, args.allowOrigin)
    return true
  }
  const snapshot = upsertRelayTeamDocumentSnapshot(store, {
    documents,
    teamId: team.id,
    updatedByUserId: auth.kind === 'admin-token' ? undefined : auth.user.id
  })
  await storeRepository.write(store)
  sendJson(res, 200, { teamDocumentSnapshot: serializeTeamDocumentSnapshot(snapshot) }, args.allowOrigin)
  return true
}
