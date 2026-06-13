/// <reference types="vite/client" />

declare const __ONEWORKS_PROJECT_HOMEPAGE_PREVIEW__: boolean

interface ImportMetaEnv {
  readonly __ONEWORKS_PROJECT_SERVER_BASE_URL__: string
  readonly __ONEWORKS_PROJECT_SERVER_HOST__: string
  readonly __ONEWORKS_PROJECT_SERVER_PORT__: string
  readonly __ONEWORKS_PROJECT_SERVER_ROLE__: string
  readonly __ONEWORKS_PROJECT_SERVER_WS_PATH__: string
  readonly __ONEWORKS_PROJECT_CLIENT_HOST__: string
  readonly __ONEWORKS_PROJECT_CLIENT_MODE__: string
  readonly __ONEWORKS_PROJECT_CLIENT_DEPLOY_MODE__: string
  readonly __ONEWORKS_PROJECT_CLIENT_PORT__: string
  readonly __ONEWORKS_PROJECT_CLIENT_BASE__: string
  readonly __ONEWORKS_PROJECT_CLIENT_DEV_SERVER__: string
  readonly __ONEWORKS_PROJECT_CLIENT_VERSION__: string
  readonly __ONEWORKS_PROJECT_CLIENT_COMMIT_HASH__: string
  readonly __ONEWORKS_PROJECT_WORKSPACE_ID__: string
  readonly __ONEWORKS_PROJECT_DEV_GIT_REF__: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface DesktopWorkspaceSelectorProject {
  description: string
  isCurrent?: boolean
  name: string
  sourceUrl?: string
  status?: 'ready' | 'starting' | 'stopped' | 'stopping'
  workspaceId?: string
  workspaceFolder: string
}

interface DesktopWorkspaceSelectorState {
  recentProjects: DesktopWorkspaceSelectorProject[]
  runningProjects: DesktopWorkspaceSelectorProject[]
}

interface DesktopWorkspaceConnection {
  serverBaseUrl: string
  workspaceId?: string
  workspaceFolder?: string
}

interface DesktopWorkspaceFileSearchResult {
  directory: string
  name: string
  path: string
  type?: 'directory' | 'file'
}

interface DesktopWorkspaceFileOpenerInfo {
  available: boolean
  id: string
  source?: string
  title?: string
}

interface DesktopWorkspaceFileOpenersResponse {
  defaultOpener?: string
  openers: DesktopWorkspaceFileOpenerInfo[]
}

interface DesktopWorkspaceResourceSearchResult {
  createdAt?: number
  directory?: string
  faviconUrl?: string
  id: string
  kind: 'file' | 'session' | 'terminal' | 'website'
  name?: string
  path?: string
  sessionId?: string
  shellKind?: string
  subtitle?: string
  terminalId?: string
  title: string
  updatedAt?: number
  url?: string
}

interface DesktopWorkspaceResourceSearchResponse {
  files: DesktopWorkspaceResourceSearchResult[]
  sessions: DesktopWorkspaceResourceSearchResult[]
  terminals: DesktopWorkspaceResourceSearchResult[]
  websites: DesktopWorkspaceResourceSearchResult[]
}

interface DesktopCloneDestinationDirectory {
  name: string
  path: string
}

interface DesktopCloneDestinationDirectoryList {
  currentDirectory: string
  directories: DesktopCloneDestinationDirectory[]
  parentDirectory?: string
}

interface DesktopPluginLauncherSearchResult {
  badge?: string
  description?: string
  icon?: string
  id: string
  keywords?: string[]
  subtitle?: string
  title: string
}

interface DesktopPluginLauncherSearchResponse {
  results: DesktopPluginLauncherSearchResult[]
}

interface DesktopWorkspaceResourceTarget {
  kind: 'directory' | 'file' | 'new-session' | 'new-terminal' | 'new-website' | 'session' | 'terminal' | 'website'
  path?: string
  sessionId?: string
  terminalId?: string
  title?: string
  url?: string
}

interface DesktopBuildSource {
  branch: string
  buildTime: string
  gitHash: string
}

interface DesktopSettings {
  iconAppearance?: 'system' | 'light' | 'dark'
  iconBackground?: 'transparent' | 'solid' | 'textured'
  syncAppIcon?: boolean
  iconTheme?: 'industrial' | 'metal' | 'matrix'
  primaryColor?: '#E23F12' | '#3F7E8F' | '#00B454' | '#8B9493'
  themeMode?: 'system' | 'light' | 'dark'
  buildSource?: DesktopBuildSource
  launcherShortcut: string
  launcherShortcutError?: string
  launcherShortcutRegistered: boolean
  autoUpdate: boolean
  openLastWorkspaceOnStartup: boolean
  updateChannel: 'stable' | 'rc' | 'beta' | 'alpha'
}

interface DesktopUpdateStatus {
  autoUpdate: boolean
  autoDownload: boolean
  currentVersion: string
  enabled: boolean
  errorMessage?: string
  lastCheckedAt?: string
  progress?: number
  reason?: 'disabled' | 'missing-config' | 'not-packaged'
  status: 'available' | 'checking' | 'downloaded' | 'downloading' | 'error' | 'idle' | 'unavailable'
  updateChannel: DesktopSettings['updateChannel']
  updateTag?: string
  updateVersion?: string
}

interface DesktopInterfaceLanguageConfig {
  configuredLanguage?: string
  effectiveLanguage?: string
}

interface DesktopMobileDebugDevice {
  detail: string
  id: string
  label: string
  state: string
}

interface DesktopMobileDebugNetworkTargetConfig {
  address: string
  enabled?: boolean
  id?: string
}

interface DesktopMobileDebugPortForwardRuleConfig {
  deviceId?: string
  devicePort: number
  enabled?: boolean
  id?: string
  localAddress: string
}

interface DesktopMobileDebugConfig {
  discoverNetworkTargets?: boolean
  discoverUsbDevices?: boolean
  networkTargets?: DesktopMobileDebugNetworkTargetConfig[]
  portForwardingRules?: DesktopMobileDebugPortForwardRuleConfig[]
  selectedDeviceId?: string
}

interface DesktopMobileDebugPortForwardStatus {
  deviceId: string
  deviceLabel: string
  devicePort: number
  localAddress: string
  message?: string
  ruleId: string
  status: 'active' | 'error' | 'removed' | 'skipped'
}

interface DesktopMobileDebugTarget {
  appName?: string
  description?: string
  deviceId: string
  deviceLabel: string
  devtoolsFrontendUrl?: string
  faviconUrl?: string
  id: string
  inspectUrl: string
  localPort: number
  networkAddress?: string
  socketName: string
  socketType: 'chrome' | 'other' | 'webview'
  source: 'network' | 'usb'
  title: string
  type: string
  url: string
  webSocketDebuggerUrl?: string
}

interface DesktopMobileDebugTargetsResponse {
  adbMissing?: boolean
  adbPath?: string
  devices: DesktopMobileDebugDevice[]
  errors: string[]
  portForwarding: DesktopMobileDebugPortForwardStatus[]
  scannedAt: number
  targets: DesktopMobileDebugTarget[]
}

interface Window {
  oneworksDesktop?: {
    chooseWorkspace?: () => Promise<string | undefined>
    checkForUpdates?: (input?: { interactive?: boolean }) => Promise<DesktopUpdateStatus>
    cloneRepository?: (repositoryUrl: string, destinationDirectory: string) => Promise<string | undefined>
    clearInteractionPanelWebviewData?: (dataType: 'cache' | 'cookies') => Promise<void>
    createWorkspace?: () => Promise<string | undefined>
    createWorkspaceInDirectory?: (parentDirectory: string, projectName: string) => Promise<string | undefined>
    forgetWorkspace?: (workspaceFolder: string) => Promise<void>
    getDesktopIconPreview?: (
      settings: Pick<DesktopSettings, 'iconAppearance' | 'iconBackground' | 'iconTheme'>
    ) => Promise<string | undefined>
    getDesktopSettings?: () => Promise<DesktopSettings>
    getUpdateStatus?: () => Promise<DesktopUpdateStatus>
    getGlobalInterfaceLanguageConfig?: () => Promise<DesktopInterfaceLanguageConfig>
    getWindowFullscreenState?: () => Promise<boolean>
    getWorkspaceConnection?: () => Promise<DesktopWorkspaceConnection | undefined>
    getWorkspaceSelectorState?: () => Promise<DesktopWorkspaceSelectorState>
    hideLauncherWindow?: () => Promise<void>
    isGitAvailable?: () => Promise<boolean>
    listCloneDestinationDirectories?: (directory?: string) => Promise<DesktopCloneDestinationDirectoryList>
    listCurrentWorkspaceFileOpeners?: () => Promise<DesktopWorkspaceFileOpenersResponse>
    listWorkspaceFileOpeners?: (workspaceFolder: string) => Promise<DesktopWorkspaceFileOpenersResponse>
    listMobileDebugTargets?: (config?: DesktopMobileDebugConfig) => Promise<DesktopMobileDebugTargetsResponse>
    markWorkspaceStartupReady?: () => void
    onDesktopSettingsChange?: (listener: (value: unknown) => void) => () => void
    onUpdateStatusChange?: (listener: (value: unknown) => void) => () => void
    onGlobalInterfaceLanguageConfigChange?: (listener: (value: unknown) => void) => () => void
    onWorkspaceSelectorStateChange?: (listener: (value: unknown) => void) => () => void
    onToggleSidebarShortcut?: (listener: () => void) => () => void
    onViewShortcut?: (listener: (action: string) => void) => () => void
    onWindowFullscreenChange?: (listener: (isFullscreen: boolean) => void) => () => void
    onWorkspaceResourceRequest?: (listener: (target: unknown) => void) => () => void
    openCurrentWorkspaceWindow?: (url: string) => Promise<void>
    openCurrentWorkspaceFileInExternalOpener?: (path: string, opener?: string) => Promise<void>
    openWorkspaceFileInExternalOpener?: (workspaceFolder: string, path: string, opener?: string) => Promise<void>
    openFilesystemFileInExternalOpener?: (path: string, opener?: string) => Promise<void>
    openFilesystemDirectory?: (path: string) => Promise<void>
    revealFilesystemPath?: (path: string) => Promise<void>
    openExternalUrl?: (url: string) => Promise<void>
    openCurrentWorkspaceFile?: (path: string) => Promise<void>
    openCurrentWorkspaceResource?: (target: unknown) => Promise<void>
    openKeyboardShortcutsSettings?: () => Promise<void>
    openWorkspace?: (workspaceFolder: string) => Promise<void>
    openWorkspacePath?: (workspaceFolder: string, path: string) => Promise<void>
    platform?: string
    plugins?: {
      invokeCurrentWorkspaceResult?: (resultId: string) => Promise<unknown>
      searchCurrentWorkspace?: (query: string) => Promise<DesktopPluginLauncherSearchResponse>
    }
    retryLauncherShortcutRegistration?: () => Promise<DesktopSettings>
    resetGlobalInterfaceLanguageConfig?: () => Promise<DesktopInterfaceLanguageConfig>
    searchCurrentWorkspaceFiles?: (
      query: string,
      options?: { includeDirectories?: boolean }
    ) => Promise<{ files: DesktopWorkspaceFileSearchResult[] }>
    searchWorkspaceFiles?: (
      workspaceFolder: string,
      query: string,
      options?: { includeDirectories?: boolean }
    ) => Promise<{ files: DesktopWorkspaceFileSearchResult[] }>
    searchFilesystemFiles?: (
      query: string,
      options?: { includeDirectories?: boolean }
    ) => Promise<{ files: DesktopWorkspaceFileSearchResult[] }>
    searchCurrentWorkspaceResources?: (query: string) => Promise<DesktopWorkspaceResourceSearchResponse>
    setThemeSource?: (themeSource: 'system' | 'light' | 'dark') => Promise<'system' | 'light' | 'dark'>
    supportsWebviewTag?: boolean
    systemLocale?: string
    updateDesktopSettings?: (settings: Partial<DesktopSettings>) => Promise<DesktopSettings>
    updateGlobalAppearanceConfig?: (
      appearance: Partial<Pick<DesktopSettings, 'primaryColor' | 'themeMode'>>
    ) => Promise<DesktopSettings>
    updateGlobalInterfaceLanguageConfig?: (language: string) => Promise<DesktopInterfaceLanguageConfig>
    writeImageDataUrlToClipboard?: (dataUrl: string) => Promise<void>
  }
  __ONEWORKS_PROJECT_RUNTIME_ENV__?: Partial<{
    __ONEWORKS_PROJECT_SERVER_BASE_URL__: string
    __ONEWORKS_PROJECT_SERVER_HOST__: string
    __ONEWORKS_PROJECT_SERVER_PORT__: string
    __ONEWORKS_PROJECT_SERVER_ROLE__: string
    __ONEWORKS_PROJECT_SERVER_WS_PATH__: string
    __ONEWORKS_PROJECT_CLIENT_MODE__: string
    __ONEWORKS_PROJECT_CLIENT_BASE__: string
    __ONEWORKS_PROJECT_CLIENT_DEV_SERVER__: string
    __ONEWORKS_PROJECT_CLIENT_VERSION__: string
    __ONEWORKS_PROJECT_CLIENT_COMMIT_HASH__: string
    __ONEWORKS_PROJECT_WORKSPACE_FOLDER__: string
  }>
}

declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        partition?: string
        src?: string
      },
      HTMLElement
    >
  }
}
