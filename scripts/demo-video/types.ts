export type DemoVideoColorScheme = 'dark' | 'light' | 'system'

export interface DemoVideoViewport {
  height: number
  width: number
}

export interface DemoVideoRecordOptions {
  chromePath?: string
  colorScheme?: DemoVideoColorScheme
  durationMs?: number
  ffmpegPath?: string
  fps?: number
  height?: number
  json?: boolean
  keepFrames?: boolean
  name?: string
  outDir?: string
  scenarioId: string
  url?: string
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
  posterPath: string
  scenarioId: string
  scenarioTitle: string
  videoPath: string
  width: number
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
  readonly url: string | undefined
  clickSelector: (selector: string, options?: DemoVideoClickOptions) => Promise<void>
  clickText: (text: string, options?: DemoVideoClickOptions) => Promise<void>
  navigate: (url: string) => Promise<void>
  pressKey: (key: string, options?: DemoVideoKeyOptions) => Promise<void>
  recordFor: (durationMs: number) => Promise<void>
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
