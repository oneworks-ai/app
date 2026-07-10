import { relayPermissions } from '../src/permissions/index.js'
import { readRelayStore, writeRelayStore } from '../src/store.js'

const timestamp = '2026-01-01T00:00:00.000Z'
const future = '2999-01-01T00:00:00.000Z'

export const seedConfigProfileFixture = async (
  dataPath: string,
  options: { staleBuiltInMemberCapabilities?: boolean } = {}
) => {
  const store = await readRelayStore(dataPath)
  store.users.push(
    { id: 'owner-1', email: 'owner@example.com', name: 'Owner', role: 'member', createdAt: timestamp },
    { id: 'member-1', email: 'member@example.com', name: 'Member', role: 'member', createdAt: timestamp },
    { id: 'admin-1', email: 'admin@example.com', name: 'Admin', role: 'admin', createdAt: timestamp }
  )
  store.sessions.push(
    { token: 'owner-session', userId: 'owner-1', createdAt: timestamp, expiresAt: future, lastSeenAt: timestamp },
    { token: 'member-session', userId: 'member-1', createdAt: timestamp, expiresAt: future, lastSeenAt: timestamp },
    { token: 'admin-session', userId: 'admin-1', createdAt: timestamp, expiresAt: future, lastSeenAt: timestamp }
  )
  store.devices.push({
    id: 'member-device',
    deviceToken: 'member-device-token',
    userId: 'member-1',
    createdAt: timestamp,
    lastSeenAt: timestamp,
    name: 'Member Device'
  })
  store.teams.push({
    id: 'team-1',
    slug: 'team-1',
    name: 'Team One',
    createdByUserId: 'owner-1',
    createdAt: timestamp,
    accessGroups: options.staleBuiltInMemberCapabilities
      ? [
        {
          id: 'team:member',
          scope: 'team',
          name: '团队成员',
          builtIn: true,
          capabilities: {
            allow: [
              relayPermissions.relayTeamMembersRead,
              relayPermissions.relayTeamsRead,
              relayPermissions.relayTeamConfigProfilesRead,
              relayPermissions.relayTeamConfigProfilesWrite,
              relayPermissions.relayTeamConfigSecretsRead,
              relayPermissions.relayTeamConfigSecretsWrite
            ]
          },
          createdAt: timestamp
        }
      ]
      : undefined
  })
  store.teamMembers.push(
    {
      id: 'owner-member',
      teamId: 'team-1',
      userId: 'owner-1',
      role: 'owner',
      createdByUserId: 'owner-1',
      createdAt: timestamp
    },
    {
      id: 'team-member',
      teamId: 'team-1',
      userId: 'member-1',
      role: 'member',
      createdByUserId: 'owner-1',
      createdAt: timestamp
    }
  )
  await writeRelayStore(dataPath, store)
}
