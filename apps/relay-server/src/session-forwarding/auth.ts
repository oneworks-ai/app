import type { IncomingMessage } from 'node:http'

import { resolveAuthContext } from '../auth/permissions.js'
import { deviceTokenMatches } from '../devices/private-metadata.js'
import { getBearerToken } from '../http.js'
import { devicePrincipalForDevice, hasRelayPermission, relayPermissions } from '../permissions/index.js'
import type { RelayPermissionPrincipal } from '../permissions/index.js'
import type {
  RelayDevice,
  RelayDeviceSession,
  RelayForwardingJob,
  RelayServerArgs,
  RelayStore,
  RelayUser
} from '../types.js'

export type RelaySessionForwardingActor =
  | {
    kind: 'admin-token'
    principal: RelayPermissionPrincipal
  }
  | {
    kind: 'session'
    principal: RelayPermissionPrincipal
    user: RelayUser
  }
  | {
    kind: 'device'
    principal: RelayPermissionPrincipal
    device: RelayDevice
  }

export const resolveSessionForwardingActor = (
  req: IncomingMessage,
  args: RelayServerArgs,
  store: RelayStore,
  deviceId?: string
): RelaySessionForwardingActor | undefined => {
  const auth = resolveAuthContext(req, args, store)
  if (auth?.kind === 'admin-token') {
    return {
      kind: 'admin-token',
      principal: auth.principal
    }
  }
  if (auth?.kind === 'session' && auth.user != null) {
    return {
      kind: 'session',
      principal: auth.principal,
      user: auth.user
    }
  }
  if (deviceId == null) return undefined
  const token = getBearerToken(req)
  if (token === '') return undefined
  const device = store.devices.find(item => item.id === deviceId && deviceTokenMatches(item, token))
  if (device == null) return undefined
  return {
    kind: 'device',
    principal: devicePrincipalForDevice(device),
    device
  }
}

export const actorHasPermission = (actor: RelaySessionForwardingActor, permission: string) => (
  hasRelayPermission(actor.principal, permission)
)

const ownsDevice = (actor: RelaySessionForwardingActor, device: RelayDevice) => (
  (actor.kind === 'device' && actor.device.id === device.id) ||
  (actor.kind === 'session' && device.userId === actor.user.id)
)

export const canAccessDevice = (
  actor: RelaySessionForwardingActor,
  device: RelayDevice
) => (
  actorHasPermission(actor, relayPermissions.relayDevicesReadAny) ||
  (actorHasPermission(actor, relayPermissions.relayDevicesRead) && ownsDevice(actor, device))
)

export const canUpdateDeviceSnapshot = (
  actor: RelaySessionForwardingActor,
  device: RelayDevice
) => (
  actorHasPermission(actor, relayPermissions.relaySessionsSnapshotWriteAny) ||
  (
    actorHasPermission(actor, relayPermissions.relaySessionsSnapshotWrite) &&
    actor.kind === 'device' &&
    actor.device.id === device.id
  )
)

export const canAccessForwardingSession = (
  actor: RelaySessionForwardingActor,
  device: RelayDevice,
  session: RelayDeviceSession
) => {
  if (actorHasPermission(actor, relayPermissions.relaySessionsReadAny)) return true
  if (!actorHasPermission(actor, relayPermissions.relaySessionsRead)) return false
  if (!ownsDevice(actor, device)) return false
  if (actor.kind === 'device') return true
  if (actor.kind !== 'session') return false
  return session.userId == null || session.userId === '' || session.userId === actor.user.id
}

export const canSubmitForwardingSession = (
  actor: RelaySessionForwardingActor,
  device: RelayDevice,
  session: RelayDeviceSession
) => {
  if (actorHasPermission(actor, relayPermissions.relaySessionsSubmitAny)) return true
  if (!actorHasPermission(actor, relayPermissions.relaySessionsSubmit)) return false
  if (!ownsDevice(actor, device)) return false
  if (actor.kind === 'device') return true
  if (actor.kind !== 'session') return false
  return session.userId == null || session.userId === '' || session.userId === actor.user.id
}

export const canAccessForwardingJob = (
  actor: RelaySessionForwardingActor,
  device: RelayDevice,
  job: RelayForwardingJob,
  session?: RelayDeviceSession
) => {
  if (actorHasPermission(actor, relayPermissions.relayJobsReadAny)) return true
  if (!actorHasPermission(actor, relayPermissions.relayJobsRead)) return false
  if (!ownsDevice(actor, device)) return false
  if (actor.kind === 'device') return true
  if (actor.kind !== 'session') return false
  if (job.userId != null && job.userId !== actor.user.id) return false
  if (session != null && session.userId != null && session.userId !== '' && session.userId !== actor.user.id) {
    return false
  }
  return true
}

export const canReadForwardingJobResult = (
  actor: RelaySessionForwardingActor,
  device: RelayDevice,
  job: RelayForwardingJob,
  session?: RelayDeviceSession
) => {
  if (actorHasPermission(actor, relayPermissions.relayJobsResultReadAny)) return true
  if (!actorHasPermission(actor, relayPermissions.relayJobsResultRead)) return false
  return canAccessForwardingJob(actor, device, job, session)
}

export const canUpdateForwardingJob = (
  actor: RelaySessionForwardingActor,
  job: RelayForwardingJob
) => (
  actorHasPermission(actor, relayPermissions.relayJobsStatusWriteAny) ||
  (
    actorHasPermission(actor, relayPermissions.relayJobsStatusWrite) &&
    actor.kind === 'device' &&
    actor.device.id === job.deviceId
  )
)
