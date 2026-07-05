export interface LauncherRelayDeviceProject {
  deviceId: string
  deviceName: string
  id: string
  name: string
  serverId: string
  serverName: string
  workspaceFolder: string
}

export interface LauncherRelayDeviceProjectGroup {
  deviceId: string
  deviceName: string
  id: string
  projects: LauncherRelayDeviceProject[]
}

export interface LauncherRelayDirectoryTarget {
  deviceId: string
  deviceName: string
  id: string
  initialDirectory?: string
  serverId: string
  serverName: string
}
