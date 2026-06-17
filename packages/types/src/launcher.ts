export type LauncherWorkspaceServiceStatus = 'ready' | 'starting' | 'stopped' | 'stopping'

export interface LauncherWorkspaceSelectorProject {
  description: string
  isCurrent?: boolean
  name: string
  sourceUrl?: string
  status?: LauncherWorkspaceServiceStatus
  workspaceId: string
  workspaceFolder: string
}

export interface LauncherWorkspaceSelectorState {
  recentProjects: LauncherWorkspaceSelectorProject[]
  runningProjects: LauncherWorkspaceSelectorProject[]
}

export interface LauncherWorkspaceOpenResponse {
  project: LauncherWorkspaceSelectorProject
  serverBaseUrl: string
  workspaceId: string
  workspaceFolder: string
}

export interface LauncherWorkspaceVersionIdentity {
  implementationId?: string
  launchConfigHash?: string
  packageDir?: string
  repoRoot?: string
  sourceVersionId?: string
}

export interface LauncherWorkspaceVersionInstance extends LauncherWorkspaceVersionIdentity {
  pid?: number
  serverBaseUrl?: string
  startedAt?: string
  workspaceFolder?: string
}

export interface LauncherWorkspaceVersionConflictDetails {
  existing: LauncherWorkspaceVersionInstance
  reason: 'implementation' | 'launch-config' | 'workspace'
  requested: LauncherWorkspaceVersionIdentity & {
    workspaceFolder: string
  }
  restartable: boolean
  workspaceFolder: string
}

export interface LauncherWorkspaceStopResponse {
  ok: true
  removed: boolean
  stopped: boolean
  workspaceFolder: string
}

export interface LauncherDirectoryEntry {
  name: string
  path: string
}

export interface LauncherDirectoryList {
  currentDirectory: string
  directories: LauncherDirectoryEntry[]
  parentDirectory?: string
}
