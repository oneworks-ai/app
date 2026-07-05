/* eslint-disable max-lines -- Config secret routes keep create, rotate, revoke, and redacted list handling together. */
import type { IncomingMessage, ServerResponse } from 'node:http'

import { authContextHasPermission, resolveAuthContext } from '../auth/permissions.js'
import type { RelayAuthContext } from '../auth/permissions.js'
import {
  createRelayConfigSecret,
  revokeRelayConfigSecret,
  rotateRelayConfigSecret,
  serializeRelayConfigSecret
} from '../config-secrets.js'
import { readRequestBody, sendJson } from '../http.js'
import { relayPermissions } from '../permissions/index.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import { findRelayTeam } from '../teams.js'
import type { RelayConfigSecret, RelayServerArgs, RelayStore } from '../types.js'
import { canReadConfigSecretTeam, ensureWritableConfigProfileTeam } from './config-profile-route-utils.js'
import { authUserId, cleanString, isAdminAuth, pathId } from './team-route-utils.js'

const routeKind = (url: URL, leaf: string) => (
  url.pathname === `/api/admin/${leaf}` || url.pathname.startsWith(`/api/admin/${leaf}/`)
    ? 'admin'
    : url.pathname === `/api/relay/${leaf}` || url.pathname.startsWith(`/api/relay/${leaf}/`)
    ? 'relay'
    : undefined
)

const requireSecretAuth = (
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

const validateSecretWrite = (
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  auth: RelayAuthContext,
  teamId: string
) => {
  if (!ensureWritableConfigProfileTeam(res, args, store, auth, teamId)) return false
  if (!store.teamPolicy.allowedSecretModes.includes('device_encrypted')) {
    sendJson(res, 403, { error: 'Device encrypted secrets are disabled by tenant policy.' }, args.allowOrigin)
    return false
  }
  return true
}

const validateSecretRead = (
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  auth: RelayAuthContext,
  teamId: string
) => {
  if (!canReadConfigSecretTeam(store, auth, teamId)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return false
  }
  return true
}

const createSecret = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  auth: RelayAuthContext,
  teamId: string
) => {
  if (!validateSecretWrite(res, args, store, auth, teamId)) return
  const body = await readRequestBody(req)
  const name = cleanString(body.name)
  const value = cleanString(body.value)
  if (name === '' || value === '') {
    sendJson(res, 400, { error: 'Config secret name and value are required.' }, args.allowOrigin)
    return
  }
  const secret = createRelayConfigSecret(args, {
    createdByUserId: authUserId(auth) ?? 'system',
    name,
    teamId,
    value
  })
  store.configSecrets.push(secret)
  await storeRepository.write(store)
  sendJson(res, 200, { secret: serializeRelayConfigSecret(secret) }, args.allowOrigin)
}

const listSecrets = (
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  teamId: string
) => {
  sendJson(res, 200, {
    secrets: store.configSecrets
      .filter(secret => secret.teamId === teamId)
      .map(serializeRelayConfigSecret)
  }, args.allowOrigin)
}

const rotateSecret = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  auth: RelayAuthContext,
  secret: RelayConfigSecret
) => {
  if (!validateSecretWrite(res, args, store, auth, secret.teamId)) return
  const body = await readRequestBody(req)
  const value = cleanString(body.value)
  if (value === '') {
    sendJson(res, 400, { error: 'Config secret value is required.' }, args.allowOrigin)
    return
  }
  rotateRelayConfigSecret(args, secret, value)
  await storeRepository.write(store)
  sendJson(res, 200, { secret: serializeRelayConfigSecret(secret) }, args.allowOrigin)
}

const revokeSecret = async (
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  auth: RelayAuthContext,
  secret: RelayConfigSecret
) => {
  if (!validateSecretWrite(res, args, store, auth, secret.teamId)) return
  revokeRelayConfigSecret(secret)
  await storeRepository.write(store)
  sendJson(res, 200, { secret: serializeRelayConfigSecret(secret) }, args.allowOrigin)
}

export const handleTeamConfigSecretsRoute = async (
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
  if (segments.length !== 2 || segments[1] !== 'config-secrets') return false

  const auth = requireSecretAuth(req, res, args, store, adminRoute)
  if (auth == null) return true
  const team = findRelayTeam(store, segments[0])
  if (team == null) {
    sendJson(res, 404, { error: 'Team not found.' }, args.allowOrigin)
    return true
  }
  if (req.method === 'GET') {
    if (!validateSecretRead(res, args, store, auth, team.id)) return true
    listSecrets(res, args, store, team.id)
    return true
  }
  if (req.method === 'POST') {
    await createSecret(req, res, args, store, storeRepository, auth, team.id)
    return true
  }
  sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
  return true
}

export const handleConfigSecretsRoute = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  url: URL
) => {
  const kind = routeKind(url, 'config-secrets')
  if (kind == null) return false
  const idOrRest = pathId(url, `/api/${kind}/config-secrets`)
  if (idOrRest == null) return false
  const segments = idOrRest.split('/').filter(Boolean)
  const secret = store.configSecrets.find(item => item.id === segments[0])
  const auth = requireSecretAuth(req, res, args, store, kind === 'admin')
  if (auth == null) return true
  if (secret == null) {
    sendJson(res, 404, { error: 'Config secret not found.' }, args.allowOrigin)
    return true
  }
  if (segments.length === 1 && req.method === 'GET') {
    if (!validateSecretRead(res, args, store, auth, secret.teamId)) return true
    sendJson(res, 200, { secret: serializeRelayConfigSecret(secret) }, args.allowOrigin)
    return true
  }
  if (segments.length === 2 && segments[1] === 'rotate' && req.method === 'POST') {
    await rotateSecret(req, res, args, store, storeRepository, auth, secret)
    return true
  }
  if (segments.length === 2 && segments[1] === 'revoke' && req.method === 'POST') {
    await revokeSecret(res, args, store, storeRepository, auth, secret)
    return true
  }
  sendJson(res, 405, { error: 'Method not allowed.' }, args.allowOrigin)
  return true
}
