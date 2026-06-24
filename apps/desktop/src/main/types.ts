import type { ChildProcess } from 'node:child_process'
import type { Server } from 'node:http'

import type { BrowserWindow, WebContents } from 'electron'

import type { DesktopState } from './desktop-settings-types'

export type { DesktopBuildSource, DesktopSettings, DesktopSettingsState, DesktopState } from './desktop-settings-types'

export type WorkspaceSelectorMode = 'dialog' | 'initial'
export type WindowRecordKind = 'launcher' | 'selector' | 'standalone' | 'workspace'
export type WorkspaceServiceStatus = 'ready' | 'starting' | 'stopped' | 'stopping'
export interface DesktopInterfaceLanguageConfig {
  configuredLanguage?: string
  effectiveLanguage?: string
}

export interface LaunchRequest {
  standaloneRoutePath?: string
  routePath?: string
  workspaceFolder?: string
}

export interface WindowRecord {
  currentServerUrl?: string
  kind: WindowRecordKind
  loadFailureScreenPending?: boolean
  loadFailureUrl?: string
  launcherSourceUrl?: string
  launcherSourceWindowId?: number
  selectorMode?: WorkspaceSelectorMode
  standaloneRoutePath?: string
  window: BrowserWindow
  workspaceFolder?: string
  workspaceServerUrl?: string
}

export interface WorkspaceService {
  description: string
  displayName: string
  port?: number
  serverProcess?: ChildProcess
  serverUrl?: string
  startPromise?: Promise<WorkspaceService>
  status: WorkspaceServiceStatus
  stopPromise?: Promise<void>
  stopping: boolean
  workspaceFolder: string
}

export interface LauncherClientService {
  clientPort?: number
  clientProcess?: ChildProcess
  clientServer?: Server
  clientUrl?: string
  startPromise?: Promise<LauncherClientService>
  status: WorkspaceServiceStatus
  stopPromise?: Promise<void>
  stopping: boolean
}

export interface DesktopRuntimeState {
  desktopState: DesktopState
  isQuitting: boolean
  launcherClientService?: LauncherClientService
  pendingLaunchRequests: LaunchRequest[]
  services: Map<string, WorkspaceService>
  windows: Map<number, WindowRecord>
}

export interface WorkspaceSelectorProject {
  description: string
  isCurrent?: boolean
  name: string
  sourceUrl?: string
  status?: WorkspaceServiceStatus
  workspaceFolder: string
}

export interface WorkspaceSelectorState {
  recentProjects: WorkspaceSelectorProject[]
  runningProjects: WorkspaceSelectorProject[]
}

export interface WorkspaceResourceTarget {
  kind: 'directory' | 'file' | 'new-session' | 'new-terminal' | 'new-website' | 'session' | 'terminal' | 'website'
  path?: string
  sessionId?: string
  terminalId?: string
  title?: string
  url?: string
}

export interface LauncherWorkspaceFileResource {
  directory: string
  id: string
  kind: 'file'
  name: string
  path: string
  type?: 'directory' | 'file'
}

export interface LauncherWorkspaceSessionResource {
  createdAt: number
  id: string
  kind: 'session'
  sessionId: string
  subtitle?: string
  title: string
}

export interface LauncherWorkspaceTerminalResource {
  id: string
  kind: 'terminal'
  shellKind?: string
  terminalId: string
  title: string
}

export interface LauncherWorkspaceWebsiteResource {
  faviconUrl?: string
  id: string
  kind: 'website'
  title: string
  updatedAt: number
  url: string
}

export interface LauncherWorkspaceResourceSearchResponse {
  files: LauncherWorkspaceFileResource[]
  sessions: LauncherWorkspaceSessionResource[]
  terminals: LauncherWorkspaceTerminalResource[]
  websites: LauncherWorkspaceWebsiteResource[]
}

export interface LauncherWorkspacePluginSearchResponse {
  results: unknown[]
}

export interface WorkspaceDataPaths {
  dataDir: string
  dbPath: string
  logDir: string
}

export interface WorkspaceSelectorWindowInput {
  errorMessage?: string
  mode?: WorkspaceSelectorMode
}

export interface CreateWindowRecordInput {
  kind?: WindowRecordKind
  parentWindow?: WindowRecord
  selectorMode?: WorkspaceSelectorMode
  showOnReady?: boolean
}

export interface OpenWorkspaceWindowInput {
  targetWindowRecord?: WindowRecord
}

export interface OpenWorkspaceDialogInput {
  reuseTargetWindow?: boolean
  targetWindowRecord?: WindowRecord
}

export type WindowRecordPredicate = (windowRecord: WindowRecord) => boolean

export type WebContentsRecordResolver = (webContents: WebContents) => WindowRecord | undefined
