import type { RelayAdminRole } from './adminTypes'

export type RelayAdminSectionAccessId = 'devices' | 'invites' | 'sso' | 'users'

export const relayAdminRoles = ['owner', 'admin', 'member', 'viewer'] as const satisfies readonly RelayAdminRole[]

export const isRelayAdminRole = (value: unknown): value is RelayAdminRole => (
  typeof value === 'string' && relayAdminRoles.includes(value as RelayAdminRole)
)

export const canManageRelayAdmin = (role: RelayAdminRole | undefined) => (
  role === 'owner' || role === 'admin'
)

export const canAccessRelayAdminSection = (
  role: RelayAdminRole | undefined,
  sectionId: RelayAdminSectionAccessId
) => (
  sectionId === 'devices' || canManageRelayAdmin(role)
)
