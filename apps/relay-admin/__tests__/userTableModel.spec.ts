import { describe, expect, it } from 'vitest'

import {
  createUserTeamFilterOptions,
  filterRelayAdminUsers,
  teamFilterValue
} from '../src/features/users/userTableModel'
import { createUser } from './helpers'

describe('relay admin user table model', () => {
  it('builds team filter options and filters users by team membership', () => {
    const users = [
      createUser({
        email: 'one@example.com',
        id: 'user-1',
        teams: [{
          archivedAt: null,
          configEnabled: true,
          defaultForPublishing: false,
          id: 'team-1',
          name: 'Team One',
          role: 'member',
          slug: 'team-one'
        }]
      }),
      createUser({
        email: 'two@example.com',
        id: 'user-2',
        teams: [{
          archivedAt: null,
          configEnabled: false,
          defaultForPublishing: true,
          id: 'team-2',
          name: 'Team Two',
          role: 'editor',
          slug: 'team-two'
        }]
      })
    ]

    expect(createUserTeamFilterOptions(users)).toEqual([
      { label: 'Team One', value: 'team:team-1' },
      { label: 'Team Two', value: 'team:team-2' }
    ])
    expect(
      filterRelayAdminUsers(users, [], {
        groupFilter: 'all',
        searchValue: '',
        sourceFilter: 'all',
        statusFilter: 'all',
        teamFilter: teamFilterValue('team-2')
      }).map(user => user.id)
    ).toEqual(['user-2'])
    expect(
      filterRelayAdminUsers(users, [], {
        groupFilter: 'all',
        searchValue: 'team one',
        sourceFilter: 'all',
        statusFilter: 'all',
        teamFilter: 'all'
      }).map(user => user.id)
    ).toEqual(['user-1'])
  })
})
