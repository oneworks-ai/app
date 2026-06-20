/* eslint-disable max-lines -- device routes share permission checks, encrypted metadata, registration, and list responses. */
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { resolveUserPlatformAccess } from '../access-groups.js'
import { authContextHasPermission, resolveAuthContext } from '../auth/permissions.js'
import { publicUser } from '../auth/sessions.js'
import {
  deviceTokenMatches,
  hashDeviceToken,
  normalizeDevicePrivateMetadata,
  storeEncryptedDevicePrivateMetadata,
  visibleDevicePrivateMetadata
} from '../devices/private-metadata.js'
import type { RelayDevicePrivateMetadata } from '../devices/private-metadata.js'
import { deviceStatusFor } from '../devices/status.js'
import { getBearerToken, readRequestBody, sendJson } from '../http.js'
import { devicePrincipalForDevice, hasRelayPermission, relayPermissions } from '../permissions/index.js'
import type { RelayStoreRepository } from '../storage/repository.js'
import type { RelayTelemetry } from '../telemetry/metrics.js'
import { recordRelayTraceEvent, traceContextFromRequest } from '../telemetry/trace.js'
import type { RelayDevice, RelayServerArgs, RelayStore } from '../types.js'
import { createToken, isRecord, now } from '../utils.js'

export const redactDevice = (
  device: RelayDevice,
  args: RelayServerArgs,
  metadata: RelayDevicePrivateMetadata = visibleDevicePrivateMetadata(args, device)
) => ({
  id: device.id,
  name: metadata.name,
  userId: device.userId,
  capabilities: metadata.capabilities,
  workspaceFolder: metadata.workspaceFolder,
  pluginScope: metadata.pluginScope,
  status: args == null ? undefined : deviceStatusFor(device, args),
  createdAt: device.createdAt,
  lastSeenAt: device.lastSeenAt
})

const findUsableInvite = (store: RelayStore, token: string) => {
  if (token === '') return undefined
  const invite = store.invites.find(item => item.code === token)
  if (invite == null) return undefined
  if (invite.revokedAt != null) return undefined
  if (typeof invite.expiresAt === 'string' && invite.expiresAt !== '' && Date.parse(invite.expiresAt) < Date.now()) {
    return undefined
  }
  const maxUses = Number(invite.maxUses ?? 1)
  const used = Number(invite.used ?? 0)
  if (Number.isFinite(maxUses) && used >= maxUses) return undefined
  return invite
}

const consumeInvite = (invite: NonNullable<ReturnType<typeof findUsableInvite>>) => {
  invite.used = Number(invite.used ?? 0) + 1
  invite.updatedAt = now()
}

const isDeviceToken = (store: RelayStore, token: string, deviceId: string) => (
  token !== '' &&
  store.devices.some(device => device.id === deviceId && deviceTokenMatches(device, token))
)

const findDeviceByToken = (store: RelayStore, token: string) => (
  token === '' ? undefined : store.devices.find(device => deviceTokenMatches(device, token))
)

const userDeviceCount = (store: RelayStore, userId: string) =>
  store.devices.filter(device => device.userId === userId).length

const enforceDeviceLimit = (
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  ownerUserId: string | undefined,
  existing: RelayDevice | undefined
) => {
  if (ownerUserId == null) return true
  if (existing != null && existing.userId === ownerUserId) return true
  const user = store.users.find(item => item.id === ownerUserId)
  if (user == null) return true
  const quota = resolveUserPlatformAccess(store, user).quotas.maxDevices
  const maxDevices = user.maxDevices == null
    ? quota
    : quota == null
    ? user.maxDevices
    : Math.min(user.maxDevices, quota)
  if (maxDevices == null) return true
  if (userDeviceCount(store, ownerUserId) < maxDevices) return true
  sendJson(res, 403, { error: 'Device limit reached.' }, args.allowOrigin)
  return false
}

export const handleDeviceRegister = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  telemetry?: RelayTelemetry
) => {
  const body = await readRequestBody(req)
  const token = getBearerToken(req)
  const deviceId = typeof body.deviceId === 'string' && body.deviceId.trim() !== ''
    ? body.deviceId.trim()
    : randomUUID()
  const existing = store.devices.find(device => device.id === deviceId)
  const invite = findUsableInvite(store, token)
  const auth = resolveAuthContext(req, args, store)
  const authorizedByExistingToken = isDeviceToken(store, token, deviceId)
  const authorized = (auth != null && authContextHasPermission(auth, relayPermissions.relayDevicesRegister)) ||
    invite != null ||
    authorizedByExistingToken

  if (!authorized) {
    sendJson(res, 401, { error: 'Invalid pairing token.' }, args.allowOrigin)
    return
  }
  const ownerUserId = invite?.userId ?? auth?.user?.id ?? existing?.userId
  if (
    existing?.userId != null &&
    ownerUserId != null &&
    existing.userId !== ownerUserId &&
    !authorizedByExistingToken
  ) {
    sendJson(res, 409, { error: 'Device id already belongs to another user.' }, args.allowOrigin)
    return
  }
  if (!enforceDeviceLimit(res, args, store, ownerUserId, existing)) return

  if (invite != null) consumeInvite(invite)
  const deviceToken = authorizedByExistingToken ? token : createToken()
  const nextDevice: RelayDevice = {
    id: deviceId,
    userId: ownerUserId,
    deviceTokenHash: hashDeviceToken(deviceToken),
    createdAt: existing?.createdAt ?? now(),
    lastSeenAt: now()
  }
  const metadata = normalizeDevicePrivateMetadata({
    capabilities: isRecord(body.capabilities) ? body.capabilities : {},
    name: typeof body.deviceName === 'string' ? body.deviceName : undefined,
    pluginScope: typeof body.pluginScope === 'string' ? body.pluginScope : undefined,
    workspaceFolder: typeof body.workspaceFolder === 'string' ? body.workspaceFolder : undefined
  }, deviceId)
  storeEncryptedDevicePrivateMetadata(args, nextDevice, metadata)

  if (existing == null) {
    store.devices.push(nextDevice)
  } else {
    Object.assign(existing, nextDevice)
    delete existing.deviceToken
  }
  await storeRepository.write(store)
  recordRelayTraceEvent(telemetry, 'info', 'relay.device.registered', {
    ...traceContextFromRequest(req),
    capabilityKeys: Object.keys(metadata.capabilities),
    deviceId: nextDevice.id,
    pluginScope: metadata.pluginScope,
    userId: nextDevice.userId
  })
  const user = nextDevice.userId == null
    ? undefined
    : store.users.find(item => item.id === nextDevice.userId)
  sendJson(res, 200, {
    device: redactDevice(nextDevice, args, metadata),
    deviceToken,
    ...(user == null ? {} : { user: publicUser(user) })
  }, args.allowOrigin)
}

export const handleDeviceList = (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore
) => {
  const tokenDevice = findDeviceByToken(store, getBearerToken(req))
  if (tokenDevice != null) {
    const principal = devicePrincipalForDevice(tokenDevice)
    if (!hasRelayPermission(principal, relayPermissions.relayDevicesRead)) {
      sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
      return
    }

    const devices = store.devices.filter(item =>
      item.id === tokenDevice.id ||
      (tokenDevice.userId != null && tokenDevice.userId !== '' && item.userId === tokenDevice.userId)
    )
    sendJson(res, 200, { devices: devices.map(device => redactDevice(device, args)) }, args.allowOrigin)
    return
  }

  const auth = resolveAuthContext(req, args, store)
  if (auth != null) {
    if (!authContextHasPermission(auth, relayPermissions.relayDevicesRead)) {
      sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
      return
    }
    const devices = auth.kind === 'session'
      ? store.devices.filter(device => device.userId === auth.user.id)
      : []
    sendJson(res, 200, { devices: devices.map(device => redactDevice(device, args)) }, args.allowOrigin)
    return
  }

  sendJson(res, 401, { error: 'Authentication required.' }, args.allowOrigin)
}

export const handleDeviceHeartbeat = async (
  req: IncomingMessage,
  res: ServerResponse,
  args: RelayServerArgs,
  store: RelayStore,
  storeRepository: RelayStoreRepository,
  telemetry?: RelayTelemetry
) => {
  const body = await readRequestBody(req)
  const token = getBearerToken(req)
  const deviceId = typeof body.deviceId === 'string' && body.deviceId.trim() !== ''
    ? body.deviceId.trim()
    : undefined
  const device = findDeviceByToken(store, token)
  if (device == null || (deviceId != null && device.id !== deviceId)) {
    sendJson(res, 401, { error: 'Invalid device token.' }, args.allowOrigin)
    return
  }
  if (!hasRelayPermission(devicePrincipalForDevice(device), relayPermissions.relayDevicesHeartbeat)) {
    sendJson(res, 403, { error: 'Permission denied.' }, args.allowOrigin)
    return
  }
  device.lastSeenAt = now()
  const metadata = visibleDevicePrivateMetadata(args, device)
  if (typeof body.deviceName === 'string' && body.deviceName.trim() !== '') {
    metadata.name = body.deviceName.trim()
  }
  if (isRecord(body.capabilities)) {
    metadata.capabilities = body.capabilities
  }
  if (typeof body.workspaceFolder === 'string') {
    metadata.workspaceFolder = body.workspaceFolder
  }
  if (typeof body.pluginScope === 'string') {
    metadata.pluginScope = body.pluginScope
  }
  storeEncryptedDevicePrivateMetadata(args, device, metadata)
  device.deviceTokenHash = hashDeviceToken(token)
  delete device.deviceToken
  await storeRepository.write(store)
  const status = deviceStatusFor(device, args)
  telemetry?.metrics.recordHeartbeat({
    deviceId: device.id,
    status,
    userId: device.userId
  })
  recordRelayTraceEvent(telemetry, 'debug', 'relay.device.heartbeat', {
    ...traceContextFromRequest(req),
    capabilityKeys: Object.keys(metadata.capabilities),
    deviceId: device.id,
    pluginScope: metadata.pluginScope,
    status,
    userId: device.userId
  })
  sendJson(res, 200, { device: redactDevice(device, args, metadata), ok: true }, args.allowOrigin)
}
