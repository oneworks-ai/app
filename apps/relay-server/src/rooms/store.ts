import type { RelayRoomAclGrant, RelayRoomPermission, RelaySharedRoom } from './types.js'

const permissions = new Set<RelayRoomPermission>([
  'approve',
  'manage_share',
  'open_run',
  'send',
  'target_member',
  'view'
])

const text = (value: unknown, maximum = 256) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, maximum) : undefined
)

const grants = (value: unknown): RelayRoomAclGrant[] => (
  Array.isArray(value)
    ? value.flatMap(item => {
      if (item == null || typeof item !== 'object' || Array.isArray(item)) return []
      const record = item as Record<string, unknown>
      const principalId = text(record.principalId)
      const principalType = record.principalType === 'team' || record.principalType === 'user'
        ? record.principalType
        : undefined
      const allowed = Array.isArray(record.permissions)
        ? [
          ...new Set(record.permissions.filter((permission): permission is RelayRoomPermission => (
            typeof permission === 'string' && permissions.has(permission as RelayRoomPermission)
          )))
        ]
        : []
      return principalId == null || principalType == null || allowed.length === 0
        ? []
        : [{ permissions: allowed, principalId, principalType }]
    })
    : []
)

export const normalizeRelaySharedRoom = (value: unknown): RelaySharedRoom | undefined => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const shareId = text(record.shareId)
  const ownerDeviceId = text(record.ownerDeviceId)
  const ownerNodeId = text(record.ownerNodeId)
  const ownerUserId = text(record.ownerUserId)
  const title = text(record.title, 160)
  if (
    shareId == null || ownerDeviceId == null || ownerNodeId == null || ownerUserId == null || title == null
  ) {
    return undefined
  }
  const createdAt = text(record.createdAt, 64) ?? new Date().toISOString()
  return {
    acls: grants(record.acls),
    createdAt,
    ...(text(record.icon, 128) == null ? {} : { icon: text(record.icon, 128) }),
    ownerDeviceId,
    ownerNodeId,
    ownerUserId,
    shareId,
    status: record.status === 'revoked' ? 'revoked' : 'active',
    title,
    updatedAt: text(record.updatedAt, 64) ?? createdAt
  }
}

export const normalizeRelaySharedRooms = (value: unknown) => (
  Array.isArray(value)
    ? value.map(normalizeRelaySharedRoom).filter((room): room is RelaySharedRoom => room != null)
    : []
)
