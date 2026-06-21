import type { DesktopContextCaptureSettings } from './desktop-settings-types'

export const desktopContextCaptureOverlayPlacements = ['auto', 'above', 'below'] as const

export const DEFAULT_DESKTOP_CONTEXT_CAPTURE_SETTINGS: DesktopContextCaptureSettings = {
  allowApplications: [],
  denyApplications: [],
  enabled: false,
  overlayPlacement: 'auto'
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeOverlayPlacement = (value: unknown): DesktopContextCaptureSettings['overlayPlacement'] => (
  value === 'above' || value === 'below' || value === 'auto'
    ? value
    : DEFAULT_DESKTOP_CONTEXT_CAPTURE_SETTINGS.overlayPlacement
)

const normalizeApplicationList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []

  return [...new Set(
    value
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(item => item !== '')
  )]
}

export const normalizeDesktopContextCaptureSettings = (
  value: unknown
): DesktopContextCaptureSettings => {
  const source = isRecord(value) ? value : {}
  return {
    allowApplications: normalizeApplicationList(source.allowApplications),
    denyApplications: normalizeApplicationList(source.denyApplications),
    enabled: typeof source.enabled === 'boolean'
      ? source.enabled
      : DEFAULT_DESKTOP_CONTEXT_CAPTURE_SETTINGS.enabled,
    overlayPlacement: normalizeOverlayPlacement(source.overlayPlacement)
  }
}

export const normalizeDesktopContextCaptureSettingsPatch = (
  value: unknown,
  currentSettings = DEFAULT_DESKTOP_CONTEXT_CAPTURE_SETTINGS
): Partial<Pick<{ contextCapture: DesktopContextCaptureSettings }, 'contextCapture'>> => {
  if (!isRecord(value) || !isRecord(value.contextCapture)) return {}

  return {
    contextCapture: normalizeDesktopContextCaptureSettings({
      ...currentSettings,
      ...value.contextCapture
    })
  }
}

export const isDesktopContextCaptureAllowedForApplication = (
  settings: DesktopContextCaptureSettings,
  application: { bundleId?: string; name?: string } = {}
) => {
  if (!settings.enabled) return false

  const applicationKeys = new Set(
    [application.bundleId, application.name]
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim().toLowerCase())
      .filter(item => item !== '')
  )
  const matchesApplication = (configuredApplication: string) => (
    applicationKeys.has(configuredApplication.trim().toLowerCase())
  )

  if (settings.denyApplications.some(matchesApplication)) return false
  if (settings.allowApplications.length === 0) return true
  return settings.allowApplications.some(matchesApplication)
}
