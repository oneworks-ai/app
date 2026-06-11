import type { IncomingMessage, ServerResponse } from 'node:http'

import { isAdminAuthorized } from '../auth/permissions.js'
import { readRequestBody, sendJson } from '../http.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayServerArgs, RelayStore } from '../types.js'
import { recordRequestAuditEvent, resolveAuditActor } from './audit.js'
import { revokeRelayToken, rotateRelayToken } from './tokens.js'

const publicTokenResult = (result: ReturnType<typeof rotateRelayToken> | ReturnType<typeof revokeRelayToken>) => {
  if (!result.ok) {
    return {
      error: result.error,
      kind: result.kind ?? null
    }
  }
  return result
}

export const handleAdminSecurityTokens = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url: URL
) => {
  if (!isAdminAuthorized(req, args, store)) {
    sendJson(res, 401, { error: 'Admin token required.' }, args.allowOrigin)
    return true
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
    return true
  }

  const body = await readRequestBody(req)
  const result = url.pathname === '/api/admin/security/tokens/rotate'
    ? rotateRelayToken(store, body, args.sessionTtlMs)
    : url.pathname === '/api/admin/security/tokens/revoke'
    ? revokeRelayToken(store, body)
    : undefined

  if (result == null) {
    sendJson(res, 404, { error: 'Not found.' }, args.allowOrigin)
    return true
  }

  if (result.ok) {
    await storeRepository.write(store)
  }
  recordRequestAuditEvent(req, {
    actor: resolveAuditActor(req, args, store),
    action: `admin.security.tokens.${result.ok ? result.operation : 'rejected'}`,
    resource: result.kind ?? 'token',
    status: result.ok ? 'success' : 'failure'
  })
  sendJson(res, result.ok ? 200 : result.status, publicTokenResult(result), args.allowOrigin)
  return true
}
