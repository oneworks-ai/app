export const APP_BUILD_VERSION_FALLBACK: '0.0.0'

export type AppBuildTimeSource = 'build' | 'commit' | 'unavailable'

export interface AppBuildInfo {
  buildTime: string | null
  buildTimeSource: AppBuildTimeSource
  commit: string | null
  version: string
}

/** Decode and normalize untrusted raw build metadata JSON without inspecting objects. */
export function parseAppBuildInfoJson(value: string | Uint8Array | undefined, fallbackVersion?: string): AppBuildInfo
