export type DemoVideoColorScheme = 'dark' | 'light' | 'system'
export type DemoVideoCaptureSource = 'cdp' | 'system-display' | 'system-window'
export type DemoVideoPageBackground = 'app' | 'macos-wallpaper'
export type DemoVideoSystemWindowCaptureBackend = 'frames' | 'video'

export interface DemoVideoViewport {
  height: number
  width: number
}

export interface DemoVideoCropRect extends DemoVideoViewport {
  x: number
  y: number
}

export interface DemoVideoSystemCursorWindowBounds {
  launcher?: DemoVideoCropRect
  workspace?: DemoVideoCropRect
}

export interface DemoVideoRecordOptions {
  captureSource?: DemoVideoCaptureSource
  chromePath?: string
  colorScheme?: DemoVideoColorScheme
  cdpWebSocketDebuggerUrl?: string
  durationMs?: number
  ffmpegPath?: string
  followCdpTargets?: boolean
  fps?: number
  height?: number
  headless?: boolean
  json?: boolean
  keepFrames?: boolean
  language?: string
  name?: string
  outDir?: string
  pageBackground?: DemoVideoPageBackground
  pageBackgroundImage?: string
  preserveTargetEnvironment?: boolean
  scenarioId: string
  systemDisplayCrop?: DemoVideoCropRect
  systemCursorWindowBounds?: DemoVideoSystemCursorWindowBounds
  systemDisplayId?: number
  systemWindowCaptureBackend?: DemoVideoSystemWindowCaptureBackend
  systemWindowId?: number
  systemWindowOwnerPid?: number
  url?: string
  videoBackgroundColor?: string
  videoBackgroundImage?: string
  waitForText?: string
  waitForTextAbsent?: string
  waitForTextAbsentTimeoutMs?: number
  waitForTextTimeoutMs?: number
  workspace?: string
  width?: number
}

export interface DemoVideoRecordResult {
  colorScheme: DemoVideoColorScheme
  durationMs: number
  fps: number
  frameCount: number
  framesDir: string
  height: number
  keptFrames: boolean
  language?: string
  posterPath: string
  scenarioId: string
  scenarioTitle: string
  stillFramePaths: string[]
  stills: DemoVideoStillFrame[]
  stillsDir: string
  stillsManifestPath: string
  videoPath: string
  width: number
}

export interface DemoVideoBatchVariantResult {
  colorScheme: DemoVideoColorScheme
  language: string
  result: DemoVideoRecordResult
  variantId: string
}

export interface DemoVideoBatchOptions extends Omit<DemoVideoRecordOptions, 'colorScheme' | 'language'> {
  colorSchemes?: DemoVideoColorScheme[]
  languages?: string[]
}

export interface DemoVideoBatchResult {
  scenarioId: string
  variants: DemoVideoBatchVariantResult[]
}

export interface DemoVideoStillFrame {
  imagePath: string
  index: number
  timestampMs: number
}

export interface DemoVideoListOptions {
  json?: boolean
}

export interface DemoVideoScenarioInfo {
  defaultDurationMs: number
  defaultFps: number
  defaultViewport: DemoVideoViewport
  description: string
  id: string
  requiresUrl: boolean
  title: string
}

export interface DemoVideoScenarioContext {
  readonly durationMs: number
  readonly workspace: string | undefined
  readonly url: string | undefined
  clickSelector: (selector: string, options?: DemoVideoClickOptions) => Promise<void>
  clickText: (text: string, options?: DemoVideoClickOptions) => Promise<void>
  focusSelector: (selector: string, options?: DemoVideoTextOptions) => Promise<void>
  navigate: (url: string) => Promise<void>
  openDesktopWorkspace: (workspaceFolder: string) => Promise<void>
  pressKey: (key: string, options?: DemoVideoKeyOptions) => Promise<void>
  recordDuring: (durationMs: number, action: () => Promise<void>) => Promise<void>
  recordFor: (durationMs: number) => Promise<void>
  recordUntilSelector: (selector: string, options?: DemoVideoTextOptions) => Promise<void>
  recordUntilSelectorAbsent: (selector: string, options?: DemoVideoTextOptions) => Promise<void>
  recordUntilText: (text: string, options?: DemoVideoTextOptions) => Promise<void>
  requireWorkspace: () => string
  requireUrl: () => string
  resolveUrl: (path: string) => string
  typeText: (text: string, options?: DemoVideoTypeOptions) => Promise<void>
  waitForText: (text: string, options?: DemoVideoTextOptions) => Promise<void>
}

export interface DemoVideoTextOptions {
  exact?: boolean
  timeoutMs?: number
}

export interface DemoVideoClickOptions extends DemoVideoTextOptions {
  settleMs?: number
}

export interface DemoVideoKeyOptions {
  settleMs?: number
}

export interface DemoVideoTypeOptions {
  settleMs?: number
}

export interface DemoVideoScenario {
  defaultDurationMs: number
  defaultFps: number
  defaultViewport: DemoVideoViewport
  description: string
  id: string
  requiresUrl: boolean
  title: string
  run: (ctx: DemoVideoScenarioContext) => Promise<void>
}
