import type { RelayAdminAccessGroup, RelayAdminUser } from '../../shared/model/adminTypes'
import { accessGroupName } from '../access-groups/accessGroupModel'

export type UserTableGroupFilter = 'all' | `group:${string}`
export type UserTableTeamFilter = 'all' | `team:${string}`

export interface UserTableFilters {
  groupFilter: UserTableGroupFilter
  searchValue: string
  sourceFilter: string
  statusFilter: 'active' | 'all' | 'disabled'
  teamFilter: UserTableTeamFilter
}

export const teamFilterValue = (teamId: string): UserTableTeamFilter => `team:${teamId}`

export const groupFilterValue = (groupId: string): UserTableGroupFilter => `group:${groupId}`

const teamIdFromFilter = (value: UserTableTeamFilter) => (
  value === 'all' ? undefined : value.slice('team:'.length)
)

const groupIdFromFilter = (value: UserTableGroupFilter) => (
  value === 'all' ? undefined : value.slice('group:'.length)
)

export const createUserTeamFilterOptions = (users: RelayAdminUser[]) => {
  const options = new Map<string, string>()
  for (const user of users) {
    for (const team of user.teams) {
      if (!options.has(team.id)) options.set(team.id, team.name || team.slug || team.id)
    }
  }
  return [...options.entries()]
    .sort(([, left], [, right]) => left.localeCompare(right))
    .map(([id, label]) => ({ label, value: teamFilterValue(id) }))
}

export const createUserGroupFilterOptions = (groups: RelayAdminAccessGroup[]) =>
  groups
    .filter(group => group.scope === 'platform')
    .map(group => ({ label: group.name, value: groupFilterValue(group.id) }))

export const filterRelayAdminUsers = (
  users: RelayAdminUser[],
  groups: RelayAdminAccessGroup[],
  filters: UserTableFilters
) => {
  const normalizedSearch = filters.searchValue.trim().toLowerCase()
  const selectedGroupId = groupIdFromFilter(filters.groupFilter)
  const selectedTeamId = teamIdFromFilter(filters.teamFilter)
  return users.filter(user => {
    const source = user.provider ?? 'local'
    const status = user.disabled ? 'disabled' : 'active'
    const searchableValues = [
      user.email,
      user.id,
      user.loginId ?? '',
      user.name,
      `${user.deviceCount}`,
      user.maxDevices == null ? 'unlimited' : `${user.maxDevices}`,
      user.role,
      ...user.groupIds.flatMap(groupId => [groupId, accessGroupName(groups, groupId)]),
      source,
      status,
      ...user.teams.flatMap(team => [
        team.id,
        team.name,
        team.role,
        team.slug,
        team.configEnabled ? 'config on' : 'config off'
      ])
    ]
    return (
      (normalizedSearch === '' || searchableValues.some(value => value.toLowerCase().includes(normalizedSearch))) &&
      (selectedGroupId == null || user.groupIds.includes(selectedGroupId)) &&
      (filters.sourceFilter === 'all' || source === filters.sourceFilter) &&
      (filters.statusFilter === 'all' || status === filters.statusFilter) &&
      (selectedTeamId == null || user.teams.some(team => team.id === selectedTeamId))
    )
  })
}
