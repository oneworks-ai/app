import type {
  LauncherRelayDeviceProject,
  LauncherRelayDeviceProjectGroup,
  LauncherRelayDirectoryTarget
} from './launcher-relay-project-types'

export type {
  LauncherRelayDeviceProject,
  LauncherRelayDeviceProjectGroup,
  LauncherRelayDirectoryTarget
} from './launcher-relay-project-types'

interface RelayStatusDevice {
  alias?: string
  capabilities?: Record<string, unknown>
  id: string
  name: string
  status?: string
  workspaceFolder?: string
}

interface RelayStatusServer {
  active: boolean
  connected: boolean
  devices: RelayStatusDevice[]
  id: string
  name?: string
  sessionAuthenticated?: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const readText = (value: unknown) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
)

const getDirectoryDisplayName = (directory: string) => {
  const normalizedDirectory = directory.replace(/[\\/]+$/u, '')
  const name = normalizedDirectory.split(/[\\/]/u).filter(Boolean).at(-1)
  return name == null || name === '' ? directory : name
}

const getDeviceDisplayName = (device: { alias?: string; id: string; name?: string }) => (
  readText(device.alias) ?? readText(device.name) ?? device.id
)

const normalizeRelayStatusDevice = (value: unknown): RelayStatusDevice | undefined => {
  if (!isRecord(value)) return undefined
  const id = readText(value.id)
  if (id == null) return undefined
  return {
    alias: readText(value.alias),
    capabilities: isRecord(value.capabilities) ? value.capabilities : undefined,
    id,
    name: readText(value.name) ?? id,
    status: readText(value.status),
    workspaceFolder: readText(value.workspaceFolder)
  }
}

const normalizeRelayStatusServer = (value: unknown): RelayStatusServer | undefined => {
  if (!isRecord(value)) return undefined
  const id = readText(value.id)
  if (id == null) return undefined
  return {
    active: value.active === true,
    connected: value.connected === true,
    devices: Array.isArray(value.devices)
      ? value.devices.map(normalizeRelayStatusDevice).filter((device): device is RelayStatusDevice => {
        return device != null
      })
      : [],
    id,
    name: readText(value.name),
    sessionAuthenticated: value.sessionAuthenticated === true
  }
}

const hasSessionCapability = (device: RelayStatusDevice) => device.capabilities?.sessions === true
const hasWorkspaceLauncherCapability = (device: RelayStatusDevice) => device.capabilities?.workspaceLauncher === true

const canCommunicateWithDevice = (device: RelayStatusDevice) => (
  device.status === 'online' &&
  hasSessionCapability(device)
)

const canBrowseWorkspaceDirectories = (device: RelayStatusDevice) => (
  canCommunicateWithDevice(device) &&
  hasWorkspaceLauncherCapability(device)
)

const compareProjects = (left: LauncherRelayDeviceProject, right: LauncherRelayDeviceProject) => {
  const nameDelta = left.name.localeCompare(right.name, undefined, { numeric: true })
  if (nameDelta !== 0) return nameDelta
  return left.workspaceFolder.localeCompare(right.workspaceFolder, undefined, { numeric: true })
}

const encodeKeyPart = (value: string) => encodeURIComponent(value)

const readCommunicableRelayServers = (status: unknown): {
  currentDeviceId?: string
  servers: RelayStatusServer[]
} => {
  if (!isRecord(status)) {
    return {
      currentDeviceId: undefined,
      servers: []
    }
  }
  const currentDeviceId = isRecord(status.device) ? readText(status.device.id) : undefined
  const servers = Array.isArray(status.servers)
    ? status.servers.map(normalizeRelayStatusServer).filter((server): server is RelayStatusServer => {
      return server != null &&
        (server.connected || server.active || server.sessionAuthenticated === true || server.devices.length > 0)
    })
    : []

  return {
    currentDeviceId,
    servers
  }
}

export const normalizeLauncherRelayDirectoryTargets = (status: unknown): LauncherRelayDirectoryTarget[] => {
  const relay = readCommunicableRelayServers(status)
  const targets = new Map<string, LauncherRelayDirectoryTarget>()

  for (const server of relay.servers) {
    for (const device of server.devices) {
      if (device.id === relay.currentDeviceId || !canBrowseWorkspaceDirectories(device)) continue
      const id = `relay:${server.id}:${device.id}`
      if (targets.has(id)) continue
      const deviceName = getDeviceDisplayName(device)
      targets.set(id, {
        deviceId: device.id,
        deviceName,
        id,
        ...(device.workspaceFolder == null ? {} : { initialDirectory: device.workspaceFolder }),
        serverId: server.id,
        serverName: server.name ?? server.id
      })
    }
  }

  return Array.from(targets.values())
    .sort((left, right) => left.deviceName.localeCompare(right.deviceName, undefined, { numeric: true }))
}

export const normalizeLauncherRelayProjectGroups = (status: unknown): LauncherRelayDeviceProjectGroup[] => {
  const relay = readCommunicableRelayServers(status)
  const groups = new Map<string, LauncherRelayDeviceProjectGroup>()
  const seenProjectKeys = new Set<string>()

  for (const server of relay.servers) {
    for (const device of server.devices) {
      if (
        device.id === relay.currentDeviceId ||
        !canCommunicateWithDevice(device) ||
        !hasWorkspaceLauncherCapability(device) ||
        device.workspaceFolder == null
      ) {
        continue
      }
      const projectKey = `${device.id}:${device.workspaceFolder}`
      if (seenProjectKeys.has(projectKey)) continue
      seenProjectKeys.add(projectKey)

      const deviceName = getDeviceDisplayName(device)
      const group = groups.get(device.id) ?? {
        deviceId: device.id,
        deviceName,
        id: `relay-device:${encodeKeyPart(device.id)}`,
        projects: []
      }
      group.projects.push({
        deviceId: device.id,
        deviceName,
        id: `relay-project:${encodeKeyPart(server.id)}:${encodeKeyPart(device.id)}:${
          encodeKeyPart(device.workspaceFolder)
        }`,
        name: getDirectoryDisplayName(device.workspaceFolder),
        serverId: server.id,
        serverName: server.name ?? server.id,
        workspaceFolder: device.workspaceFolder
      })
      groups.set(device.id, group)
    }
  }

  return Array.from(groups.values())
    .map(group => ({
      ...group,
      projects: [...group.projects].sort(compareProjects)
    }))
    .filter(group => group.projects.length > 0)
    .sort((left, right) => left.deviceName.localeCompare(right.deviceName, undefined, { numeric: true }))
}
