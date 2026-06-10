import type { OneWorksIconAppearance, OneWorksIconMode, OneWorksIconTheme } from './types.js'

export const ONEWORKS_ICON_THEMES = ['metal', 'industrial', 'matrix'] as const satisfies readonly OneWorksIconTheme[]
export const ONEWORKS_ICON_MODES = ['light', 'dark'] as const satisfies readonly OneWorksIconMode[]
export const ONEWORKS_ICON_APPEARANCES = [
  'system',
  'light',
  'dark'
] as const satisfies readonly OneWorksIconAppearance[]
export const ONEWORKS_THEME_COLOR_PRESETS = [
  {
    theme: 'industrial',
    primaryColor: '#E23F12'
  },
  {
    theme: 'metal',
    primaryColor: '#3F7E8F'
  },
  {
    theme: 'matrix',
    primaryColor: '#00B454'
  }
] as const satisfies readonly {
  theme: OneWorksIconTheme
  primaryColor: string
}[]

export const DEFAULT_ICON_THEME = 'metal' satisfies OneWorksIconTheme
export const DEFAULT_ICON_MODE = 'dark' satisfies OneWorksIconMode
export const DEFAULT_ICON_APPEARANCE = 'system' satisfies OneWorksIconAppearance
export const DEFAULT_ICON_SEED = 'oneworks'
export const DEFAULT_ICON_SIZE = 300
export const DEFAULT_THEME_PRIMARY_COLOR =
  ONEWORKS_THEME_COLOR_PRESETS.find(preset => preset.theme === DEFAULT_ICON_THEME)?.primaryColor ??
    ONEWORKS_THEME_COLOR_PRESETS[0].primaryColor

export type OneWorksThemePrimaryColor = typeof ONEWORKS_THEME_COLOR_PRESETS[number]['primaryColor']

const LEGACY_THEME_PRIMARY_COLOR_ALIASES: Record<string, OneWorksThemePrimaryColor> = {
  '#8B9493': '#3F7E8F'
}

const isStringIn = <Value extends string>(values: readonly Value[], value: string | null | undefined): value is Value =>
  values.includes(value as Value)

export const normalizeIconTheme = (value: string | null | undefined): OneWorksIconTheme =>
  isStringIn(ONEWORKS_ICON_THEMES, value) ? value : DEFAULT_ICON_THEME

export const normalizeIconMode = (value: string | null | undefined): OneWorksIconMode =>
  isStringIn(ONEWORKS_ICON_MODES, value) ? value : DEFAULT_ICON_MODE

export const normalizeIconAppearance = (value: string | null | undefined): OneWorksIconAppearance =>
  isStringIn(ONEWORKS_ICON_APPEARANCES, value) ? value : DEFAULT_ICON_APPEARANCE

export const normalizeThemePrimaryColor = (
  value: string | null | undefined
): OneWorksThemePrimaryColor | undefined => {
  const normalized = value?.toUpperCase()
  if (normalized != null && normalized in LEGACY_THEME_PRIMARY_COLOR_ALIASES) {
    return LEGACY_THEME_PRIMARY_COLOR_ALIASES[normalized]
  }
  return ONEWORKS_THEME_COLOR_PRESETS.find(preset => preset.primaryColor === normalized)?.primaryColor
}
