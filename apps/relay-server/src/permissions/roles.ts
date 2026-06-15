import type { RelayRole } from '../types.js'
import { isRelayPermission, relayPermissionList, relayPermissions } from './capabilities.js'
import type { RelayPermission } from './capabilities.js'

export const relayRoles = ['owner', 'admin', 'member', 'viewer'] as const satisfies readonly RelayRole[]

const relayRoleSet = new Set<string>(relayRoles)

export const isRelayRole = (value: unknown): value is RelayRole => (
  typeof value === 'string' && relayRoleSet.has(value)
)

export const rolePermissionMatrix = {
  owner: relayPermissionList,
  admin: relayPermissionList,
  member: [
    relayPermissions.relayConfigSnapshotRead,
    relayPermissions.relayDevicesRead,
    relayPermissions.relayDevicesRegister,
    relayPermissions.relayJobsRead,
    relayPermissions.relayJobsResultRead,
    relayPermissions.relaySessionsRead,
    relayPermissions.relaySessionsSubmit
  ],
  viewer: [
    relayPermissions.relayConfigSnapshotRead,
    relayPermissions.relayDevicesRead,
    relayPermissions.relayJobsRead,
    relayPermissions.relayJobsResultRead,
    relayPermissions.relaySessionsRead
  ]
} as const satisfies Record<RelayRole, readonly RelayPermission[]>

export const permissionsForRole = (role: string | undefined): readonly RelayPermission[] => (
  isRelayRole(role) ? rolePermissionMatrix[role] : []
)

export const hasRolePermission = (role: string | undefined, permission: string) => (
  isRelayPermission(permission) && permissionsForRole(role).includes(permission)
)

export const isElevatedRole = (role: string | undefined) => (
  hasRolePermission(role, relayPermissions.adminSettingsWrite)
)
