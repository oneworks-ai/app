import type { IncomingMessage, ServerResponse } from 'node:http'

import { getBearerToken, sendJson } from '../http.js'
import {
  adminTokenPrincipal,
  hasRelayPermission,
  relayPermissions,
  sessionPrincipalForUser
} from '../permissions/index.js'
import type { RelayPermission, RelayPermissionPrincipal } from '../permissions/index.js'
import type { RelayAccessToken, RelayServerArgs, RelaySession, RelayStore, RelayUser } from '../types.js'
import { resolveRelayAccessToken } from './access-tokens.js'
import { resolveSession } from './sessions.js'

export { isElevatedRole } from '../permissions/index.js'

export type RelayAuthContext =
  | {
    accessToken: RelayAccessToken
    kind: 'access-token'
    principal: RelayPermissionPrincipal
    user: RelayUser
  }
  | {
    kind: 'admin-token'
    principal: RelayPermissionPrincipal
  }
  | {
    kind: 'session'
    principal: RelayPermissionPrincipal
    session: RelaySession
    user: RelayUser
  }

export const resolveAuthContext = (req: IncomingMessage, args: RelayServerArgs, store: RelayStore) => {
  const bearerToken = getBearerToken(req)
  if (args.adminToken === '' || bearerToken === args.adminToken) {
    return {
      kind: 'admin-token' as const,
      principal: adminTokenPrincipal()
    }
  }
  const session = resolveSession(req, store)
  if (session != null) {
    return {
      kind: 'session' as const,
      principal: sessionPrincipalForUser(session.user),
      session: session.session,
      user: session.user
    }
  }
  const accessToken = resolveRelayAccessToken(store, bearerToken)
  if (accessToken == null) return undefined
  return {
    accessToken: accessToken.accessToken,
    kind: 'access-token' as const,
    principal: sessionPrincipalForUser(accessToken.user),
    user: accessToken.user
  }
}

export const authContextHasPermission = (auth: RelayAuthContext, permission: string) => (
  hasRelayPermission(auth.principal, permission)
)

export interface RequireAuthPermissionOptions {
  forbiddenError?: string
  unauthorizedError?: string
}

export const requireAuthPermission = (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  permission: RelayPermission,
  options: RequireAuthPermissionOptions = {}
) => {
  const auth = resolveAuthContext(req, args, store)
  if (auth == null) {
    sendJson(res, 401, { error: options.unauthorizedError ?? 'Authentication required.' }, args.allowOrigin)
    return undefined
  }
  if (!authContextHasPermission(auth, permission)) {
    sendJson(res, 403, { error: options.forbiddenError ?? 'Permission denied.' }, args.allowOrigin)
    return undefined
  }
  return auth
}

export const isAdminAuthorized = (req: IncomingMessage, args: RelayServerArgs, store: RelayStore) => {
  const auth = resolveAuthContext(req, args, store)
  return auth != null && authContextHasPermission(auth, relayPermissions.adminSettingsWrite)
}
