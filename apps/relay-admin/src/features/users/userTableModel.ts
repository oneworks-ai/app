import type { RelayAdminRole, RelayAdminUser } from '../../shared/model/adminTypes'

export type UserTableTeamFilter = 'all' | `team:${string}`

export interface UserTableFilters {
  roleFilter: RelayAdminRole | 'all'
  searchValue: string
  sourceFilter: string
  statusFilter: 'active' | 'all' | 'disabled'
  teamFilter: UserTableTeamFilter
}

export const teamFilterValue = (teamId: string): UserTableTeamFilter => `team:${teamId}`

const teamIdFromFilter = (value: UserTableTeamFilter) => (
  value === 'all' ? undefined : value.slice('team:'.length)
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

export const filterRelayAdminUsers = (users: RelayAdminUser[], filters: UserTableFilters) => {
  const normalizedSearch = filters.searchValue.trim().toLowerCase()
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
      (filters.roleFilter === 'all' || user.role === filters.roleFilter) &&
      (filters.sourceFilter === 'all' || source === filters.sourceFilter) &&
      (filters.statusFilter === 'all' || status === filters.statusFilter) &&
      (selectedTeamId == null || user.teams.some(team => team.id === selectedTeamId))
    )
  })
}
