export const relayPermissions = {
  adminInvitesRead: 'admin.invites.read',
  adminInvitesWrite: 'admin.invites.write',
  adminSettingsRead: 'admin.settings.read',
  adminSettingsWrite: 'admin.settings.write',
  adminSsoRead: 'admin.sso.read',
  adminSsoWrite: 'admin.sso.write',
  adminUsersRead: 'admin.users.read',
  adminUsersWrite: 'admin.users.write',
  relayDevicesHeartbeat: 'relay.devices.heartbeat',
  relayDevicesRead: 'relay.devices.read',
  relayDevicesReadAny: 'relay.devices.read.any',
  relayDevicesRegister: 'relay.devices.register',
  relayJobsRead: 'relay.jobs.read',
  relayJobsReadAny: 'relay.jobs.read.any',
  relayJobsResultRead: 'relay.jobs.result.read',
  relayJobsResultReadAny: 'relay.jobs.result.read.any',
  relayJobsStatusWrite: 'relay.jobs.status.write',
  relayJobsStatusWriteAny: 'relay.jobs.status.write.any',
  relaySessionsRead: 'relay.sessions.read',
  relaySessionsReadAny: 'relay.sessions.read.any',
  relaySessionsSnapshotWrite: 'relay.sessions.snapshot.write',
  relaySessionsSnapshotWriteAny: 'relay.sessions.snapshot.write.any',
  relaySessionsSubmit: 'relay.sessions.submit',
  relaySessionsSubmitAny: 'relay.sessions.submit.any'
} as const

export type RelayPermission = (typeof relayPermissions)[keyof typeof relayPermissions]

export const relayPermissionList = Object.freeze(Object.values(relayPermissions)) as readonly RelayPermission[]

const relayPermissionSet = new Set<string>(relayPermissionList)

export const isRelayPermission = (value: string): value is RelayPermission => relayPermissionSet.has(value)
