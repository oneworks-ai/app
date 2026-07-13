import { ApiError } from '#~/api/base'
import { getLauncherManagerServerBaseUrl, getLauncherWorkspaceConnection } from '#~/api/launcher'
import { getLauncherRelayWorkspaceConnection, openLauncherRelayWorkspace } from '#~/api/launcher-relay'
import * as WorkspaceConnectionState from '#~/workspace-connection-state'

type WorkspaceConnection = WorkspaceConnectionState.WorkspaceConnection
type WorkspaceConnectionMetadata = WorkspaceConnectionState.WorkspaceConnectionMetadata
type WorkspaceConnectionTransport = WorkspaceConnectionState.WorkspaceConnectionTransport

const { readRememberedWorkspaceConnectionMetadata } = WorkspaceConnectionState

export interface RestorableWorkspaceConnection {
  connection: WorkspaceConnection
  transport: WorkspaceConnectionTransport
}

const inFlightRestores = new Map<string, Promise<RestorableWorkspaceConnection>>()

const canReopenRememberedRelayConnection = (connection: WorkspaceConnectionMetadata | undefined) => (
  connection?.relay?.deviceId != null &&
  connection.relay.serverId != null &&
  connection.relay.workspaceFolder != null
)

const isRemoteWorkspaceUnavailableError = (error: unknown) => (
  error instanceof ApiError &&
  (error.status === 401 || error.status === 403 || error.status === 503)
)

const restoreRememberedRelayConnection = async (
  connection: WorkspaceConnectionMetadata,
  managerServerBaseUrl: string
) => {
  if (!canReopenRememberedRelayConnection(connection)) return undefined
  const relay = connection.relay
  if (relay == null || relay.deviceId == null || relay.serverId == null || relay.workspaceFolder == null) {
    return undefined
  }
  return await openLauncherRelayWorkspace({
    deviceId: relay.deviceId,
    ...(relay.deviceName == null ? {} : { deviceName: relay.deviceName }),
    managerServerBaseUrl,
    serverId: relay.serverId,
    ...(relay.serverName == null ? {} : { serverName: relay.serverName }),
    workspaceFolder: relay.workspaceFolder
  })
}

const resolveRestorableWorkspaceConnection = async (workspaceId: string) => {
  const rememberedRelayConnection = readRememberedWorkspaceConnectionMetadata(workspaceId, 'relay')
  const relayManagerServerBaseUrl = getLauncherManagerServerBaseUrl(rememberedRelayConnection?.managerServerBaseUrl)
  let relayError: unknown
  if (rememberedRelayConnection != null) {
    const relayConnection = await getLauncherRelayWorkspaceConnection(workspaceId, {
      managerServerBaseUrl: relayManagerServerBaseUrl
    })
      .catch((error) => {
        relayError = error
        return undefined
      })
    if (relayConnection != null) {
      return {
        connection: {
          ...relayConnection,
          managerServerBaseUrl: relayManagerServerBaseUrl
        },
        transport: 'relay'
      } satisfies RestorableWorkspaceConnection
    }
    if (isRemoteWorkspaceUnavailableError(relayError)) {
      throw relayError
    }
    const reopenedConnection = await restoreRememberedRelayConnection(
      rememberedRelayConnection,
      relayManagerServerBaseUrl
    ).catch((error) => {
      relayError = error
      return undefined
    })
    if (reopenedConnection != null) {
      return {
        connection: {
          ...reopenedConnection,
          managerServerBaseUrl: relayManagerServerBaseUrl
        },
        transport: 'relay'
      } satisfies RestorableWorkspaceConnection
    }
    if (relayError != null) throw relayError
    throw new Error('Failed to reopen remembered relay workspace connection.')
  }

  const rememberedLocalConnection = readRememberedWorkspaceConnectionMetadata(workspaceId, 'local')
  const localConnection = await getLauncherWorkspaceConnection(workspaceId, {
    managerServerBaseUrl: rememberedLocalConnection?.managerServerBaseUrl
  })
  return {
    connection: {
      ...localConnection,
      ...(rememberedLocalConnection?.managerServerBaseUrl == null
        ? {}
        : { managerServerBaseUrl: rememberedLocalConnection.managerServerBaseUrl })
    },
    transport: 'local'
  } satisfies RestorableWorkspaceConnection
}

export const getRestorableWorkspaceConnection = async (workspaceId: string) => {
  const existing = inFlightRestores.get(workspaceId)
  if (existing != null) return await existing

  const restorePromise = resolveRestorableWorkspaceConnection(workspaceId)
  inFlightRestores.set(workspaceId, restorePromise)
  try {
    return await restorePromise
  } finally {
    if (inFlightRestores.get(workspaceId) === restorePromise) {
      inFlightRestores.delete(workspaceId)
    }
  }
}
