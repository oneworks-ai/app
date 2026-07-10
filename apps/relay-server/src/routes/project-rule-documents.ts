import type { IncomingMessage, ServerResponse } from 'node:http'

import type { RelayAuthContext } from '../auth/permissions.js'
import { authContextHasPermission, resolveAuthContext } from '../auth/permissions.js'
import { readRequestBody, sendJson } from '../http.js'
import { relayPermissions } from '../permissions/index.js'
import { normalizeRelayPersonalDocumentSnapshot } from '../personal-config.js'
import { upsertRelayProjectRuleDocumentSnapshot } from '../project-rule-documents.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayProjectRuleDocumentSnapshot, RelayServerArgs, RelayStore } from '../types.js'
import { canReadConfigProfileTeam, canWriteConfigProfileTeam, findConfigProfile } from './config-profile-route-utils.js'
import { isAdminAuth, pathId } from './team-route-utils.js'

const serializeSnapshot = (snapshot: RelayProjectRuleDocumentSnapshot | undefined) => (
  snapshot == null
    ? null
    : {
      assignmentId: snapshot.assignmentId,
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
  if (typeof body.projectRuleDocumentSnapshot === 'object' && body.projectRuleDocumentSnapshot != null) {
    return body.projectRuleDocumentSnapshot
  }
  return undefined
}

const requireAuth = (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  adminRoute: boolean
): RelayAuthContext | undefined => {
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

export const handleProjectRuleDocumentsRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url: URL
) => {
  const adminRoute = url.pathname.startsWith('/api/admin/config-assignments/')
  const relayRoute = url.pathname.startsWith('/api/relay/config-assignments/')
  if (!adminRoute && !relayRoute) return false
  const prefix = adminRoute ? '/api/admin/config-assignments' : '/api/relay/config-assignments'
  const segments = pathId(url, prefix)?.split('/').filter(Boolean) ?? []
  if (segments.length !== 2 || segments[1] !== 'documents') return false

  const auth = requireAuth(req, res, args, store, adminRoute)
  if (auth == null) return true
  const assignment = store.configProfileAssignments.find(item => item.id === segments[0])
  const profile = assignment == null ? undefined : findConfigProfile(store, assignment.profileId)
  if (assignment == null || profile == null) {
    sendJson(res, 404, { error: 'Config assignment not found.' }, args.allowOrigin)
    return true
  }
  if (!canReadConfigProfileTeam(store, auth, profile.teamId)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return true
  }

  const existing = store.projectRuleDocumentSnapshots?.find(item => item.assignmentId === assignment.id)
  if (req.method === 'GET') {
    sendJson(res, 200, { projectRuleDocumentSnapshot: serializeSnapshot(existing) }, args.allowOrigin)
    return true
  }
  if (req.method !== 'PUT' && req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
    return true
  }
  if (!canWriteConfigProfileTeam(store, auth, profile.teamId)) {
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
      error: 'Relay project rule document snapshot has changed on the server.',
      projectRuleDocumentSnapshot: serializeSnapshot(existing)
    }, args.allowOrigin)
    return true
  }

  const documents = normalizeRelayPersonalDocumentSnapshot(pickDocumentsPayload(body))
  if (documents == null) {
    sendJson(res, 400, { error: 'A valid encrypted document snapshot is required.' }, args.allowOrigin)
    return true
  }
  const snapshot = upsertRelayProjectRuleDocumentSnapshot(store, {
    assignmentId: assignment.id,
    documents,
    teamId: profile.teamId,
    updatedByUserId: auth.kind === 'admin-token' ? undefined : auth.user.id
  })
  await storeRepository.write(store)
  sendJson(res, 200, { projectRuleDocumentSnapshot: serializeSnapshot(snapshot) }, args.allowOrigin)
  return true
}
