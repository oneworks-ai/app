export type DesktopIconAppearance = NonNullable<DesktopSettings['iconAppearance']>
export type DesktopIconBackground = NonNullable<DesktopSettings['iconBackground']>
export type DesktopIconSync = NonNullable<DesktopSettings['syncAppIcon']>
export type DesktopIconTheme = NonNullable<DesktopSettings['iconTheme']>
export type DesktopIconPreviewSources = Partial<Record<DesktopIconTheme, string>>

export interface NormalizedDesktopIconSettings {
  iconAppearance: DesktopIconAppearance
  iconBackground: DesktopIconBackground
  syncAppIcon: DesktopIconSync
  iconTheme: DesktopIconTheme
}

export const iconThemes = ['industrial', 'metal', 'matrix'] as const satisfies readonly DesktopIconTheme[]
export const iconAppearances = ['system', 'light', 'dark'] as const satisfies readonly DesktopIconAppearance[]
export const iconBackgrounds = [
  'transparent',
  'solid',
  'textured'
] as const satisfies readonly DesktopIconBackground[]

const defaultIconTheme = 'metal' satisfies DesktopIconTheme
const defaultIconAppearance = 'system' satisfies DesktopIconAppearance
const defaultIconBackground = 'solid' satisfies DesktopIconBackground
const defaultIconSync = true satisfies DesktopIconSync

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const isDesktopIconTheme = (value: unknown): value is DesktopIconTheme => (
  typeof value === 'string' && iconThemes.includes(value as DesktopIconTheme)
)

const isDesktopIconAppearance = (value: unknown): value is DesktopIconAppearance => (
  typeof value === 'string' && iconAppearances.includes(value as DesktopIconAppearance)
)

const isDesktopIconSync = (value: unknown): value is DesktopIconSync => typeof value === 'boolean'

export const normalizeDesktopIconBackground = (value: unknown): DesktopIconBackground => {
  if (value === false) return 'transparent'
  if (value === true) return defaultIconBackground
  return typeof value === 'string' && iconBackgrounds.includes(value as DesktopIconBackground)
    ? value as DesktopIconBackground
    : defaultIconBackground
}

export const normalizeDesktopIconSettings = (value: unknown): NormalizedDesktopIconSettings => {
  if (!isRecord(value)) {
    return {
      iconAppearance: defaultIconAppearance,
      iconBackground: defaultIconBackground,
      syncAppIcon: defaultIconSync,
      iconTheme: defaultIconTheme
    }
  }

  return {
    iconAppearance: isDesktopIconAppearance(value.iconAppearance)
      ? value.iconAppearance
      : defaultIconAppearance,
    iconBackground: normalizeDesktopIconBackground(value.iconBackground),
    syncAppIcon: isDesktopIconSync(value.syncAppIcon)
      ? value.syncAppIcon
      : defaultIconSync,
    iconTheme: isDesktopIconTheme(value.iconTheme)
      ? value.iconTheme
      : defaultIconTheme
  }
}
