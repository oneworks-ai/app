import type {
  RelayAdminDevice,
  RelayAdminInvite,
  RelayAdminSsoProvider,
  RelayAdminUser
} from '../../shared/model/adminTypes'
import { fetchRelayAdminDevices } from '../devices/devicesApi'
import { fetchRelayAdminInvites } from '../invites/invitesApi'
import { fetchRelayAdminSsoProviders } from '../sso/ssoProvidersApi'
import { fetchRelayAdminUsers } from '../users/usersApi'

export interface RelayAdminSnapshot {
  devices: RelayAdminDevice[]
  invites: RelayAdminInvite[]
  ssoProviders: RelayAdminSsoProvider[]
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
      invites: [],
      ssoProviders: [],
      users: []
    }
  }

  const [usersBody, invitesBody, ssoProvidersBody] = await Promise.all([
    fetchRelayAdminUsers(token),
    fetchRelayAdminInvites(token),
    fetchRelayAdminSsoProviders(token)
  ])

  return {
    devices: devicesBody.devices,
    invites: invitesBody.invites,
    ssoProviders: ssoProvidersBody.providers,
    users: usersBody.users
  }
}
