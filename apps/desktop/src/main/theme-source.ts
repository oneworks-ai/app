import { nativeTheme } from 'electron'

export type DesktopThemeSource = 'system' | 'light' | 'dark'

const desktopThemeSources = new Set<DesktopThemeSource>(['system', 'light', 'dark'])

const isDesktopThemeSource = (value: unknown): value is DesktopThemeSource => (
  typeof value === 'string' && desktopThemeSources.has(value as DesktopThemeSource)
)

export const setDesktopThemeSource = (value: unknown) => {
  if (isDesktopThemeSource(value)) {
    nativeTheme.themeSource = value
  }

  return nativeTheme.themeSource
}
