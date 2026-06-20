import type {
  RelayAdminAccessGroup,
  RelayAdminDevice,
  RelayAdminInvite,
  RelayAdminSsoProvider,
  RelayAdminUser
} from '../../shared/model/adminTypes'
import { fetchRelayAdminAccessGroups } from '../access-groups/accessGroupsApi'
import { fetchRelayAdminDevices } from '../devices/devicesApi'
import { fetchRelayAdminInvites } from '../invites/invitesApi'
import { fetchRelayAdminSsoProviders } from '../sso/ssoProvidersApi'
import type { RelayAdminTeam, RelayAdminTeamPolicy } from '../teams/teamTypes'
import { fetchRelayAdminTeams } from '../teams/teamsApi'
import { fetchRelayAdminUsers } from '../users/usersApi'

export interface RelayAdminSnapshot {
  accessGroups: RelayAdminAccessGroup[]
  devices: RelayAdminDevice[]
  invites: RelayAdminInvite[]
  ssoProviders: RelayAdminSsoProvider[]
  teamPolicy?: RelayAdminTeamPolicy
  teams: RelayAdminTeam[]
  users: RelayAdminUser[]
}

export interface RelayAdminSnapshotOptions {
  includeAdminResources: boolean
}

export const fetchRelayAdminSnapshot = async (
  token: string,
  options: RelayAdminSnapshotOptions
): Promise<RelayAdminSnapshot> => {
  const devicesBody = await fetchRelayAdminDevices(token)

  if (!options.includeAdminResources) {
    return {
      devices: devicesBody.devices,
      accessGroups: [],
      invites: [],
      ssoProviders: [],
      teams: [],
      users: []
    }
  }

  const [usersBody, invitesBody, ssoProvidersBody, teamsBody, accessGroupsBody] = await Promise.all([
    fetchRelayAdminUsers(token),
    fetchRelayAdminInvites(token),
    fetchRelayAdminSsoProviders(token),
    fetchRelayAdminTeams(token),
    fetchRelayAdminAccessGroups(token)
  ])

  return {
    accessGroups: accessGroupsBody.groups,
    devices: devicesBody.devices,
    invites: invitesBody.invites,
    ssoProviders: ssoProvidersBody.providers,
    teamPolicy: teamsBody.policy,
    teams: teamsBody.teams,
    users: usersBody.users
  }
}
