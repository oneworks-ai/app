import type { RelayDevice, RelayUser } from '../types.js'
import { isRelayPermission, relayPermissionList, relayPermissions } from './capabilities.js'
import type { RelayPermission } from './capabilities.js'
import { permissionsForRole } from './roles.js'

export type RelayPermissionPrincipalKind = 'admin-token' | 'device' | 'session'

export interface RelayPermissionPrincipal {
  deviceId?: string
  kind: RelayPermissionPrincipalKind
  permissions: readonly RelayPermission[]
  role?: string
  userId?: string
}

export const deviceTokenPermissions = Object.freeze([
  relayPermissions.relayDevicesHeartbeat,
  relayPermissions.relayDevicesRead,
  relayPermissions.relayDevicesRegister,
  relayPermissions.relayJobsRead,
  relayPermissions.relayJobsStatusWrite,
  relayPermissions.relaySessionsRead,
  relayPermissions.relaySessionsSnapshotWrite
]) as readonly RelayPermission[]

export const adminTokenPrincipal = (): RelayPermissionPrincipal => ({
  kind: 'admin-token',
  permissions: relayPermissionList
})

export const sessionPrincipalForUser = (user: RelayUser): RelayPermissionPrincipal => ({
  kind: 'session',
  permissions: permissionsForRole(user.role),
  role: user.role,
  userId: user.id
})

export const devicePrincipalForDevice = (device: RelayDevice): RelayPermissionPrincipal => ({
  deviceId: device.id,
  kind: 'device',
  permissions: deviceTokenPermissions
})

export const hasRelayPermission = (
  principal: RelayPermissionPrincipal,
  permission: string
) => (
  isRelayPermission(permission) && principal.permissions.includes(permission)
)

export const permissionLogMetadata = (
  principal: RelayPermissionPrincipal,
  permission: string
) => ({
  deviceId: principal.deviceId,
  permission,
  principalKind: principal.kind,
  role: principal.role,
  userId: principal.userId
})
