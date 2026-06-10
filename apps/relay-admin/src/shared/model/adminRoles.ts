import type { RelayAdminRole } from './adminTypes'

export const relayAdminRoles: RelayAdminRole[] = ['viewer', 'member', 'admin', 'owner']

export const inviteAssignableRoles = relayAdminRoles.filter(role => role !== 'owner')
