export const DESKTOP_ICON_THEMES = ['industrial', 'metal', 'matrix'] as const
export const DESKTOP_ICON_APPEARANCES = ['system', 'light', 'dark'] as const
export const DESKTOP_ICON_BACKGROUNDS = ['transparent', 'solid', 'textured'] as const

export type DesktopIconTheme = typeof DESKTOP_ICON_THEMES[number]
export type DesktopIconAppearance = typeof DESKTOP_ICON_APPEARANCES[number]
export type DesktopIconBackground = typeof DESKTOP_ICON_BACKGROUNDS[number]
export type DesktopIconSync = boolean
export type DesktopIconMode = Exclude<DesktopIconAppearance, 'system'>

export interface DesktopIconSettings {
  iconAppearance: DesktopIconAppearance
  iconBackground: DesktopIconBackground
  syncAppIcon: DesktopIconSync
  iconTheme: DesktopIconTheme
}

export const DEFAULT_DESKTOP_ICON_THEME: DesktopIconTheme = 'metal'
export const DEFAULT_DESKTOP_ICON_APPEARANCE: DesktopIconAppearance = 'system'
export const DEFAULT_DESKTOP_ICON_BACKGROUND: DesktopIconBackground = 'solid'
export const DEFAULT_DESKTOP_ICON_SYNC: DesktopIconSync = true

const desktopIconThemeSet: ReadonlySet<string> = new Set(DESKTOP_ICON_THEMES)
const desktopIconAppearanceSet: ReadonlySet<string> = new Set(DESKTOP_ICON_APPEARANCES)
const desktopIconBackgroundSet: ReadonlySet<string> = new Set(DESKTOP_ICON_BACKGROUNDS)

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

export const normalizeDesktopIconTheme = (value: unknown): DesktopIconTheme => (
  typeof value === 'string' && desktopIconThemeSet.has(value)
    ? value as DesktopIconTheme
    : DEFAULT_DESKTOP_ICON_THEME
)

export const normalizeDesktopIconAppearance = (value: unknown): DesktopIconAppearance => (
  typeof value === 'string' && desktopIconAppearanceSet.has(value)
    ? value as DesktopIconAppearance
    : DEFAULT_DESKTOP_ICON_APPEARANCE
)

export const normalizeDesktopIconBackground = (value: unknown): DesktopIconBackground => {
  if (value === false) return 'transparent'
  if (value === true) return DEFAULT_DESKTOP_ICON_BACKGROUND
  return typeof value === 'string' && desktopIconBackgroundSet.has(value)
    ? value as DesktopIconBackground
    : DEFAULT_DESKTOP_ICON_BACKGROUND
}

export const normalizeDesktopIconSync = (value: unknown): DesktopIconSync => (
  typeof value === 'boolean' ? value : DEFAULT_DESKTOP_ICON_SYNC
)

export const normalizeDesktopIconSettings = (value: unknown): DesktopIconSettings => {
  const source = isRecord(value) ? value : {}
  return {
    iconAppearance: normalizeDesktopIconAppearance(source.iconAppearance),
    iconBackground: normalizeDesktopIconBackground(source.iconBackground),
    syncAppIcon: normalizeDesktopIconSync(source.syncAppIcon),
    iconTheme: normalizeDesktopIconTheme(source.iconTheme)
  }
}

export const normalizeDesktopIconSettingsPatch = (value: unknown): Partial<DesktopIconSettings> => {
  if (!isRecord(value)) return {}

  return {
    ...('iconAppearance' in value
      ? { iconAppearance: normalizeDesktopIconAppearance(value.iconAppearance) }
      : {}),
    ...('iconBackground' in value
      ? { iconBackground: normalizeDesktopIconBackground(value.iconBackground) }
      : {}),
    ...('syncAppIcon' in value
      ? { syncAppIcon: normalizeDesktopIconSync(value.syncAppIcon) }
      : {}),
    ...('iconTheme' in value
      ? { iconTheme: normalizeDesktopIconTheme(value.iconTheme) }
      : {})
  }
}

export const resolveDesktopIconMode = (
  iconAppearance: DesktopIconAppearance,
  shouldUseDarkColors = true
): DesktopIconMode => {
  if (iconAppearance === 'light' || iconAppearance === 'dark') return iconAppearance
  return shouldUseDarkColors ? 'dark' : 'light'
}
