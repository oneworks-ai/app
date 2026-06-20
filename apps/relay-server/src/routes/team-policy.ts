import type { IncomingMessage, ServerResponse } from 'node:http'

import { authContextHasPermission, requireAuthPermission, resolveAuthContext } from '../auth/permissions.js'
import { readRequestBody, sendJson } from '../http.js'
import { relayPermissions } from '../permissions/index.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import { patchRelayTeamPolicy } from '../teams.js'
import type { RelayServerArgs, RelayStore } from '../types.js'
import { authUserId, serializePolicy } from './team-route-utils.js'

export const handleRelayTeamPolicyRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url: URL
) => {
  if (url.pathname === '/api/relay/team-policy') {
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
      return true
    }
    const auth = resolveAuthContext(req, args, store)
    if (auth == null || !authContextHasPermission(auth, relayPermissions.relayTeamsRead)) {
      sendJson(res, auth == null ? 401 : 403, {
        error: auth == null ? 'Authentication required.' : 'Permission denied.'
      }, args.allowOrigin)
      return true
    }
    sendJson(res, 200, { policy: serializePolicy(store.teamPolicy) }, args.allowOrigin)
    return true
  }
  if (url.pathname !== '/api/admin/team-policy') return false

  const permission = req.method === 'GET' ? relayPermissions.adminSettingsRead : relayPermissions.adminSettingsWrite
  const auth = requireAuthPermission(req, res, args, store, permission, {
    unauthorizedError: 'Admin token required.'
  })
  if (auth == null) return true
  if (req.method === 'GET') {
    sendJson(res, 200, { policy: serializePolicy(store.teamPolicy) }, args.allowOrigin)
    return true
  }
  if (req.method !== 'PATCH') {
    sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
    return true
  }
  const body = await readRequestBody(req)
  store.teamPolicy = patchRelayTeamPolicy(store.teamPolicy, body, authUserId(auth))
  await storeRepository.write(store)
  sendJson(res, 200, { policy: serializePolicy(store.teamPolicy) }, args.allowOrigin)
  return true
}
