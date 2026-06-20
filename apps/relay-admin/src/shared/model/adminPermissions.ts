import type { RelayAdminRole } from './adminTypes'

export type RelayAdminSectionAccessId = 'devices' | 'invites' | 'message-pushes' | 'openapi' | 'sso' | 'teams' | 'users'

export const relayAdminRoles = ['owner', 'admin', 'member', 'viewer'] as const satisfies readonly RelayAdminRole[]

export const isRelayAdminRole = (value: unknown): value is RelayAdminRole => (
  typeof value === 'string' && relayAdminRoles.includes(value as RelayAdminRole)
)

export const canManageRelayAdmin = (role: RelayAdminRole | undefined) => (
  role === 'owner' || role === 'admin'
)

export const isRelayAdminTeamManagerRole = (role: string | null | undefined) => (
  role === 'owner' || role === 'admin'
)

export const canManageRelayMessages = (
  role: RelayAdminRole | undefined,
  teams: Array<{ membership?: { role?: string | null } | null }>
) => (
  canManageRelayAdmin(role) ||
  teams.some(team => isRelayAdminTeamManagerRole(team.membership?.role))
)

export const canAccessRelayAdminSection = (
  role: RelayAdminRole | undefined,
  sectionId: RelayAdminSectionAccessId
) => (
  sectionId === 'devices' ||
  sectionId === 'openapi' ||
  (sectionId !== 'message-pushes' && canManageRelayAdmin(role))
)
