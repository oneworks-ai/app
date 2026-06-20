import type { LauncherDirectoryList, LauncherWorkspaceSelectorState, LauncherWorkspaceStopResponse } from './launcher'

export type OneWorksDeviceShellKind = 'android' | 'electron' | 'web'

export interface OneWorksDeviceShellWorkspaceSelection {
  description?: string
  name?: string
  sourceUrl?: string
  workspaceId?: string
  workspaceFolder: string
}

export interface OneWorksDeviceShellWorkspaceConnection {
  serverBaseUrl: string
  workspaceFolder?: string
  workspaceId?: string
}

export interface OneWorksDeviceShellApi {
  chooseWorkspace?: () => Promise<string | undefined>
  cloneRepository?: (repositoryUrl: string, destinationDirectory: string) => Promise<string | undefined>
  createWorkspace?: () => Promise<string | undefined>
  createWorkspaceInDirectory?: (parentDirectory: string, projectName: string) => Promise<string | undefined>
  forgetWorkspace?: (workspaceFolder: string) => Promise<void>
  getWorkspaceConnection?: () => Promise<OneWorksDeviceShellWorkspaceConnection | undefined>
  getWorkspaceSelectorState?: () => Promise<LauncherWorkspaceSelectorState>
  hideLauncherWindow?: () => Promise<void>
  listCloneDestinationDirectories?: (directory?: string) => Promise<LauncherDirectoryList>
  onWorkspaceSelectorStateChange?: (listener: (value: unknown) => void) => () => void
  openFilesystemDirectory?: (path: string) => Promise<void>
  openWorkspace?: (workspaceFolder: string) => Promise<void>
  platform?: string
  revealFilesystemPath?: (path: string) => Promise<void>
  shellKind?: OneWorksDeviceShellKind | string
  stopWorkspace?: (
    workspaceFolder: string,
    input?: { forget?: boolean }
  ) => Promise<LauncherWorkspaceStopResponse | undefined>
  supportsWebviewTag?: boolean
  systemLocale?: string
}

export interface OneWorksNativeBridgeRequestApi {
  available?: () => boolean
  request: (method: string, params?: Record<string, unknown>) => Promise<unknown>
}
