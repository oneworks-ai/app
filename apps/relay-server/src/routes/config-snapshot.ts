import type { IncomingMessage, ServerResponse } from 'node:http'

import { resolveSession } from '../auth/sessions.js'
import { createRelayConfigSnapshotForUser } from '../config-snapshot.js'
import { deviceTokenMatches, visibleDevicePrivateMetadata } from '../devices/private-metadata.js'
import { getBearerToken, sendJson } from '../http.js'
import {
  devicePrincipalForDevice,
  hasRelayPermission,
  relayPermissions,
  sessionPrincipalForUser
} from '../permissions/index.js'
import type { RelayConfigProjectContext, RelayDevice, RelayServerArgs, RelayStore, RelayUser } from '../types.js'

const queryText = (url: URL, key: string) => {
  const value = url.searchParams.get(key)
  return value == null || value.trim() === '' ? undefined : value.trim()
}

const findDeviceByToken = (store: RelayStore, token: string) => (
  token === '' ? undefined : store.devices.find(device => deviceTokenMatches(device, token))
)

const findActiveUser = (store: RelayStore, userId: string | undefined): RelayUser | undefined => {
  if (userId == null || userId === '') return undefined
  const user = store.users.find(item => item.id === userId)
  return user == null || user.disabledAt != null ? undefined : user
}

const resolveConfigSnapshotDeviceUser = (
  req: IncomingMessage,
  store: RelayStore
) => {
  const device = findDeviceByToken(store, getBearerToken(req))
  if (device == null) return undefined
  const principal = devicePrincipalForDevice(device)
  if (!hasRelayPermission(principal, relayPermissions.relayConfigSnapshotRead)) {
    return { denied: true as const, device }
  }
  return {
    device,
    user: findActiveUser(store, device.userId)
  }
}

const resolveConfigSnapshotSessionUser = (
  req: IncomingMessage,
  store: RelayStore
) => {
  const session = resolveSession(req, store)
  if (session == null) return undefined
  const principal = sessionPrincipalForUser(session.user)
  if (!hasRelayPermission(principal, relayPermissions.relayConfigSnapshotRead)) {
    return { denied: true as const }
  }
  return {
    user: session.user
  }
}

const projectContextFromRequest = (
  url: URL,
  args: RelayServerArgs,
  device: RelayDevice | undefined
): RelayConfigProjectContext => {
  const metadata = device == null ? undefined : visibleDevicePrivateMetadata(args, device)
  return {
    cwd: queryText(url, 'cwd'),
    projectId: queryText(url, 'projectId') ?? queryText(url, 'project'),
    projectName: queryText(url, 'projectName'),
    workspaceFolder: queryText(url, 'workspaceFolder') ?? metadata?.workspaceFolder
  }
}

export const handleRelayConfigSnapshot = (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  url: URL
) => {
  const deviceResult = resolveConfigSnapshotDeviceUser(req, store)
  if (deviceResult?.denied === true) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return
  }
  if (deviceResult != null) {
    if (deviceResult.user == null) {
      sendJson(res, 403, { error: 'User context required.' }, args.allowOrigin)
      return
    }
    sendJson(
      res,
      200,
      createRelayConfigSnapshotForUser(store, deviceResult.user, {
        projectContext: projectContextFromRequest(url, args, deviceResult.device),
        sourceServerId: args.publicBaseUrl
      }),
      args.allowOrigin
    )
    return
  }

  const sessionResult = resolveConfigSnapshotSessionUser(req, store)
  if (sessionResult?.denied === true) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return
  }
  if (sessionResult == null) {
    sendJson(res, 401, { error: 'Authentication required.' }, args.allowOrigin)
    return
  }

  sendJson(
    res,
    200,
    createRelayConfigSnapshotForUser(store, sessionResult.user, {
      projectContext: projectContextFromRequest(url, args, undefined),
      sourceServerId: args.publicBaseUrl
    }),
    args.allowOrigin
  )
}
