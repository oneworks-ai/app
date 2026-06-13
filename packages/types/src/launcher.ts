export type LauncherWorkspaceServiceStatus = 'ready' | 'starting' | 'stopped' | 'stopping'

export interface LauncherWorkspaceSelectorProject {
  description: string
  isCurrent?: boolean
  name: string
  sourceUrl?: string
  status?: LauncherWorkspaceServiceStatus
  workspaceFolder: string
}

export interface LauncherWorkspaceSelectorState {
  recentProjects: LauncherWorkspaceSelectorProject[]
  runningProjects: LauncherWorkspaceSelectorProject[]
}

export interface LauncherWorkspaceOpenResponse {
  project: LauncherWorkspaceSelectorProject
  serverBaseUrl: string
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
