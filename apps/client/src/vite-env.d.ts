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

type DesktopWorkspaceSelectorProject = import('@oneworks/types').LauncherWorkspaceSelectorProject
type DesktopWorkspaceSelectorState = import('@oneworks/types').LauncherWorkspaceSelectorState
type DesktopWorkspaceStopResponse = import('@oneworks/types').LauncherWorkspaceStopResponse
type DesktopCloneDestinationDirectory = import('@oneworks/types').LauncherDirectoryEntry
type DesktopCloneDestinationDirectoryList = import('@oneworks/types').LauncherDirectoryList
type OneWorksDeviceShellApi = import('@oneworks/types').OneWorksDeviceShellApi
type OneWorksNativeBridgeRequestApi = import('@oneworks/types').OneWorksNativeBridgeRequestApi

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

type DesktopContextCaptureOverlayPlacement = 'auto' | 'above' | 'below'

interface DesktopContextCaptureSettings {
  allowApplications: string[]
  denyApplications: string[]
  enabled: boolean
  overlayPlacement: DesktopContextCaptureOverlayPlacement
}

interface DesktopContextCapturePoint {
  x: number
  y: number
}

interface DesktopContextCaptureScreenRect extends DesktopContextCapturePoint {
  height: number
  width: number
}

interface DesktopContextCaptureOverlayInput {
  placement?: DesktopContextCaptureOverlayPlacement
  snapshot: {
    capturedAt?: string
    cursorPoint?: DesktopContextCapturePoint
    selectionRect?: DesktopContextCaptureScreenRect
    sourceApplication?: {
      bundleId?: string
      name?: string
      path?: string
    }
    text: string
  }
}

interface DesktopSettings {
  contextCapture: DesktopContextCaptureSettings
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
  savedPasswordsAutoSignIn: boolean
  savedPasswordsOfferToSave: boolean
  savedPasswordsRequireAuth: boolean
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

interface DesktopMobileDeviceScreenshotResponse {
  capturedAt: number
  deviceId: string
  height?: number
  imageDataUrl: string
  width?: number
}

interface DesktopMobileDeviceLogsResponse {
  capturedAt: number
  deviceId: string
  lineLimit: number
  lines: string[]
  source: 'logcat'
}

interface DesktopMobileDeviceVideoStreamStartResponse {
  codec: number
  codecName: string
  deviceId: string
  height?: number
  source: 'scrcpy'
  startedAt: number
  streamId: string
  width?: number
}

interface DesktopMobileDeviceVideoFrameEvent {
  data: Uint8Array
  deviceId: string
  height?: number
  keyframe?: boolean
  receivedAt: number
  streamId: string
  type: 'configuration' | 'data'
  width?: number
}

interface DesktopMobileDeviceVideoStreamStatusEvent {
  deviceId: string
  message?: string
  status: 'closed' | 'error'
  streamId: string
}

interface DesktopMobileElementBounds {
  height: number
  width: number
  x: number
  y: number
}

interface DesktopMobileElementNode {
  attributes: Record<string, string | number | boolean | null>
  bounds?: DesktopMobileElementBounds
  children: DesktopMobileElementNode[]
  id: string
  label?: string
  source: 'uiautomator'
  type: string
}

interface DesktopMobileElementTreeResponse {
  capturedAt: number
  deviceId: string
  nodeCount: number
  root?: DesktopMobileElementNode
  source: 'uiautomator'
}

interface DesktopMobileDeviceInputEvent {
  action?: 'collapse-panels' | 'notifications' | 'quick-settings' | 'rotate'
  durationMs?: number
  endX?: number
  endY?: number
  key?: 'app-switch' | 'back' | 'delete' | 'enter' | 'home' | 'power' | 'volume-down' | 'volume-up'
  kind: 'action' | 'key' | 'scroll' | 'swipe' | 'tap' | 'text' | 'touch'
  physicalEndX?: number
  physicalEndY?: number
  physicalX?: number
  physicalY?: number
  scrollX?: number
  scrollY?: number
  text?: string
  touchPhase?: 'down' | 'move' | 'up'
  x?: number
  y?: number
}

type DesktopMobileDeviceBatteryHealth = 'cold' | 'dead' | 'failure' | 'good' | 'overheat' | 'overvoltage' | 'unknown'
type DesktopMobileDeviceBatteryStatus = 'charging' | 'discharging' | 'full' | 'not-charging' | 'unknown'
type DesktopMobileDeviceCellularRegistration =
  | 'denied'
  | 'home'
  | 'off'
  | 'on'
  | 'roaming'
  | 'searching'
  | 'unregistered'
type DesktopMobileDeviceChargerConnection = 'ac' | 'none' | 'usb' | 'wireless'
type DesktopMobileDeviceMeterStatus = 'metered' | 'unmetered'
type DesktopMobileDeviceNetworkDelay = 'edge' | 'gprs' | 'none' | 'umts'
type DesktopMobileDeviceNetworkSpeed = 'edge' | 'full' | 'gprs' | 'gsm' | 'hscsd' | 'hsdpa' | 'lte' | 'umts'
type DesktopMobileDeviceSignalProfile = 'great' | 'good' | 'moderate' | 'none' | 'poor'

type DesktopMobileDeviceEnvironmentAction =
  | {
    charger?: DesktopMobileDeviceChargerConnection
    health?: DesktopMobileDeviceBatteryHealth
    kind: 'battery'
    level?: number
    reset?: boolean
    status?: DesktopMobileDeviceBatteryStatus
  }
  | {
    dataStatus?: DesktopMobileDeviceCellularRegistration
    delay?: DesktopMobileDeviceNetworkDelay
    kind: 'cellular'
    meterStatus?: DesktopMobileDeviceMeterStatus
    signalProfile?: DesktopMobileDeviceSignalProfile
    speed?: DesktopMobileDeviceNetworkSpeed
    voiceStatus?: DesktopMobileDeviceCellularRegistration
  }
  | {
    altitude?: number
    kind: 'location'
    latitude: number
    longitude: number
  }
  | {
    action: 'accept' | 'call' | 'cancel' | 'hold'
    kind: 'phone'
    phoneNumber: string
  }
  | {
    kind: 'sms'
    message: string
    phoneNumber: string
  }
  | {
    fingerId: number
    kind: 'fingerprint'
  }

interface DesktopMobileDeviceEnvironmentActionResponse {
  appliedAt: number
  deviceId: string
  emulatorOnly: boolean
  kind: DesktopMobileDeviceEnvironmentAction['kind']
}

interface DesktopBrowserDataSyncState {
  authenticator: {
    total: number
    updatedAt?: string
  }
  savedPasswords: {
    total: number
    updatedAt?: string
  }
}

interface DesktopAuthenticatorImportResult {
  canceled: boolean
  fileName?: string
  imported: number
  skipped: number
  total: number
  updated: number
}

type DesktopBrowserPasswordImportSourceId =
  | 'arc'
  | 'brave'
  | 'chromium'
  | 'google-chrome'
  | 'microsoft-edge'
  | 'vivaldi'
type DesktopPasswordImportSourceId = DesktopBrowserPasswordImportSourceId | 'csv'

type DesktopBrowserPasswordSourceName =
  | 'Arc'
  | 'Brave'
  | 'Chromium'
  | 'Google Chrome'
  | 'Microsoft Edge'
  | 'Vivaldi'
type DesktopPasswordSourceName = DesktopBrowserPasswordSourceName | 'CSV File'

interface DesktopBrowserPasswordImportSource {
  icon: string
  id: DesktopBrowserPasswordImportSourceId
  name: DesktopBrowserPasswordSourceName
  profiles: number
}

interface DesktopBrowserPasswordImportResult {
  canceled: boolean
  duplicates: number
  failed: number
  imported: number
  profiles: number
  sourceId: DesktopPasswordImportSourceId
  sourceName: DesktopPasswordSourceName
  skipped: number
  total: number
  updated: number
}

interface DesktopPasswordCsvImportResult extends DesktopBrowserPasswordImportResult {
  fileName?: string
  sourceId: 'csv'
  sourceName: 'CSV File'
}

interface DesktopSavedPasswordRecord {
  actionUrl?: string
  dateCreated?: number
  id: string
  importedAt: string
  note?: string
  originUrl: string
  signonRealm?: string
  sourceBrowser: DesktopPasswordSourceName
  sourceProfile: string
  updatedAt?: string
  username: string
}

interface DesktopSavedPasswordAccessAuthenticationResult {
  authenticated: boolean
  expiresAt: string
  method: 'cached' | 'touch-id'
}

interface DesktopSavedPasswordUpdateInput {
  note?: string
  originUrl?: string
  password?: string
  username?: string
}

type DesktopBrowserActivityScopeFilter = 'all' | 'project' | 'session'

interface DesktopBrowserActivityListOptions {
  query?: string
  scope?: DesktopBrowserActivityScopeFilter
}

interface DesktopBrowserActivityScope {
  projectKey?: string
  sessionKey?: string
}

interface DesktopBrowserHistoryRecord extends DesktopBrowserActivityScope {
  faviconUrl?: string
  firstVisitedAt: string
  id: string
  lastVisitedAt: string
  title?: string
  url: string
  visitCount: number
}

interface DesktopBrowserHistoryRecordInput extends DesktopBrowserActivityScope {
  faviconUrl?: string
  incrementVisit?: boolean
  title?: string
  url: string
}

interface DesktopBrowserDownloadRecord extends DesktopBrowserActivityScope {
  completedAt?: string
  fileName: string
  filePath?: string
  id: string
  mimeType?: string
  receivedBytes: number
  startedAt: string
  state: 'cancelled' | 'completed' | 'interrupted' | 'progressing'
  totalBytes: number
  updatedAt: string
  url: string
}

interface DesktopInteractionPanelWebviewScopeInput extends DesktopBrowserActivityScope {
  webContentsId: number
}

interface DesktopInteractionPanelWebviewElementCommentRequest {
  frameUrl?: string
  pageUrl?: string
  webContentsId: number
  x: number
  y: number
}

interface Window {
  oneworksAndroidBridge?: OneWorksNativeBridgeRequestApi
  oneworksDesktop?: OneWorksDeviceShellApi & {
    chooseWorkspace?: () => Promise<string | undefined>
    checkForUpdates?: (input?: { interactive?: boolean }) => Promise<DesktopUpdateStatus>
    cloneRepository?: (repositoryUrl: string, destinationDirectory: string) => Promise<string | undefined>
    clearInteractionPanelWebviewData?: (dataType: 'cache' | 'cookies') => Promise<void>
    createWorkspace?: () => Promise<string | undefined>
    createWorkspaceInDirectory?: (parentDirectory: string, projectName: string) => Promise<string | undefined>
    forgetWorkspace?: (workspaceFolder: string) => Promise<void>
    stopWorkspace?: (
      workspaceFolder: string,
      input?: { forget?: boolean }
    ) => Promise<DesktopWorkspaceStopResponse | undefined>
    getDesktopIconPreview?: (
      settings: Pick<DesktopSettings, 'iconAppearance' | 'iconBackground' | 'iconTheme'>
    ) => Promise<string | undefined>
    getCurrentWindowPresentationState?: () => Promise<{
      alwaysOnTop: boolean
      opacity: number
    }>
    setCurrentWindowAspectRatio?: (input: {
      aspectRatio: number
      extraSize?: { height: number; width: number }
    }) => Promise<void>
    setCurrentWindowContentSize?: (size: { height: number; width: number }) => Promise<
      { height: number; width: number } | undefined
    >
    getDesktopSettings?: () => Promise<DesktopSettings>
    getBrowserDataSyncState?: () => Promise<DesktopBrowserDataSyncState>
    listBrowserHistory?: (input?: DesktopBrowserActivityListOptions) => Promise<DesktopBrowserHistoryRecord[]>
    recordBrowserHistory?: (input: DesktopBrowserHistoryRecordInput) => Promise<DesktopBrowserHistoryRecord | undefined>
    registerInteractionPanelWebviewScope?: (input: DesktopInteractionPanelWebviewScopeInput) => Promise<void>
    listBrowserDownloads?: (input?: DesktopBrowserActivityListOptions) => Promise<DesktopBrowserDownloadRecord[]>
    openBrowserDownload?: (id: string) => Promise<void>
    revealBrowserDownload?: (id: string) => Promise<void>
    getUpdateStatus?: () => Promise<DesktopUpdateStatus>
    getGlobalInterfaceLanguageConfig?: () => Promise<DesktopInterfaceLanguageConfig>
    getWindowFullscreenState?: () => Promise<boolean>
    getWorkspaceConnection?: () => Promise<DesktopWorkspaceConnection | undefined>
    getWorkspaceSelectorState?: () => Promise<DesktopWorkspaceSelectorState>
    hideDesktopContextCaptureOverlay?: () => Promise<void>
    hideLauncherWindow?: () => Promise<void>
    importAuthenticatorBackup?: () => Promise<DesktopAuthenticatorImportResult>
    importBrowserPasswords?: (
      input?: {
        duplicateResolution?: 'overwrite' | 'skip'
        sourceId?: DesktopBrowserPasswordImportSourceId
      }
    ) => Promise<DesktopBrowserPasswordImportResult>
    importChromePasswords?: (input?: { duplicateResolution?: 'overwrite' | 'skip' }) => Promise<
      DesktopBrowserPasswordImportResult
    >
    importPasswordCsv?: (input?: { duplicateResolution?: 'overwrite' | 'skip' }) => Promise<
      DesktopPasswordCsvImportResult
    >
    listBrowserPasswordImportSources?: () => Promise<DesktopBrowserPasswordImportSource[]>
    listSavedPasswords?: (query?: string) => Promise<DesktopSavedPasswordRecord[]>
    authenticateSavedPasswordsAccess?: (reason?: string) => Promise<DesktopSavedPasswordAccessAuthenticationResult>
    revealSavedPassword?: (id: string) => Promise<string>
    copySavedPasswordField?: (id: string, field: 'username' | 'password') => Promise<void>
    updateSavedPassword?: (id: string, input: DesktopSavedPasswordUpdateInput) => Promise<DesktopSavedPasswordRecord>
    deleteSavedPassword?: (id: string) => Promise<void>
    isGitAvailable?: () => Promise<boolean>
    listCloneDestinationDirectories?: (directory?: string) => Promise<DesktopCloneDestinationDirectoryList>
    listCurrentWorkspaceFileOpeners?: () => Promise<DesktopWorkspaceFileOpenersResponse>
    listWorkspaceFileOpeners?: (workspaceFolder: string) => Promise<DesktopWorkspaceFileOpenersResponse>
    listMobileDebugTargets?: (config?: DesktopMobileDebugConfig) => Promise<DesktopMobileDebugTargetsResponse>
    captureMobileDeviceScreenshot?: (deviceId: string) => Promise<DesktopMobileDeviceScreenshotResponse>
    startMobileDeviceVideoStream?: (deviceId: string) => Promise<DesktopMobileDeviceVideoStreamStartResponse>
    stopMobileDeviceVideoStream?: (streamId: string) => Promise<{ stoppedAt: number; streamId: string }>
    dumpMobileElementTree?: (deviceId: string) => Promise<DesktopMobileElementTreeResponse>
    sendMobileDeviceInput?: (
      deviceId: string,
      input: DesktopMobileDeviceInputEvent
    ) => Promise<{ deviceId: string; sentAt: number }>
    onMobileDeviceVideoFrame?: (listener: (value: DesktopMobileDeviceVideoFrameEvent) => void) => () => void
    onMobileDeviceVideoStreamStatus?: (
      listener: (value: DesktopMobileDeviceVideoStreamStatusEvent) => void
    ) => () => void
    markWorkspaceStartupReady?: () => void
    onDesktopSettingsChange?: (listener: (value: unknown) => void) => () => void
    onUpdateStatusChange?: (listener: (value: unknown) => void) => () => void
    onGlobalInterfaceLanguageConfigChange?: (listener: (value: unknown) => void) => () => void
    onInteractionPanelWebviewElementCommentRequest?: (
      listener: (value: DesktopInteractionPanelWebviewElementCommentRequest) => void
    ) => () => void
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
    setCurrentWindowAlwaysOnTop?: (value: boolean) => Promise<{
      alwaysOnTop: boolean
      opacity: number
    }>
    setCurrentWindowOpacity?: (value: number) => Promise<{
      alwaysOnTop: boolean
      opacity: number
    }>
    setThemeSource?: (themeSource: 'system' | 'light' | 'dark') => Promise<'system' | 'light' | 'dark'>
    showDesktopContextCaptureOverlay?: (input: DesktopContextCaptureOverlayInput) => Promise<unknown>
    supportsWebviewTag?: boolean
    systemLocale?: string
    updateDesktopSettings?: (settings: Partial<DesktopSettings>) => Promise<DesktopSettings>
    updateGlobalAppearanceConfig?: (
      appearance: Partial<Pick<DesktopSettings, 'primaryColor' | 'themeMode'>>
    ) => Promise<DesktopSettings>
    updateGlobalInterfaceLanguageConfig?: (language: string) => Promise<DesktopInterfaceLanguageConfig>
    writeImageDataUrlToClipboard?: (dataUrl: string) => Promise<void>
  }
  oneworksDeviceShell?: OneWorksDeviceShellApi
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
