import type { RelayAdminAccessGroup, RelayAdminAccessGroupScope, RelayAdminRole } from '../../shared/model/adminTypes'
import type { RelayAdminTeamMemberRole } from '../teams/teamTypes'

export const builtinPlatformGroupIdForRole = (role: RelayAdminRole) => `platform:${role}`

export const builtinTeamGroupIdForRole = (role: RelayAdminTeamMemberRole) => `team:${role}`

export const defaultPlatformGroupIds = (role: RelayAdminRole = 'member') => [builtinPlatformGroupIdForRole(role)]

export const defaultTeamGroupIds = (role: RelayAdminTeamMemberRole = 'member') => [builtinTeamGroupIdForRole(role)]

export const accessGroupsForScope = (
  groups: RelayAdminAccessGroup[],
  scope: RelayAdminAccessGroupScope
) => groups.filter(group => group.scope === scope)

export const accessGroupName = (groups: RelayAdminAccessGroup[], groupId: string) =>
  groups.find(group => group.id === groupId)?.name ?? groupId

export const accessGroupOptions = (
  groups: RelayAdminAccessGroup[],
  scope: RelayAdminAccessGroupScope
) =>
  accessGroupsForScope(groups, scope).map(group => ({
    label: `${group.name} · ${group.id}`,
    value: group.id
  }))

export const roleFromPlatformGroupIds = (groupIds: string[], fallback: RelayAdminRole): RelayAdminRole => {
  if (groupIds.includes('platform:owner')) return 'owner'
  if (groupIds.includes('platform:admin')) return 'admin'
  if (groupIds.includes('platform:viewer')) return 'viewer'
  return fallback
}

export const roleFromTeamGroupIds = (
  groupIds: string[],
  fallback: RelayAdminTeamMemberRole
): RelayAdminTeamMemberRole => {
  if (groupIds.includes('team:owner')) return 'owner'
  if (groupIds.includes('team:admin')) return 'admin'
  if (groupIds.includes('team:editor')) return 'editor'
  if (groupIds.includes('team:viewer')) return 'viewer'
  return fallback
}
