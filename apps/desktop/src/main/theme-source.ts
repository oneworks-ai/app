import process from 'node:process'

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

export const resolveDesktopRecordingThemeSource = (
  env: Pick<NodeJS.ProcessEnv, 'ONEWORKS_DESKTOP_RECORDING_THEME_MODE'> = process.env
): DesktopThemeSource | undefined => (
  isDesktopThemeSource(env.ONEWORKS_DESKTOP_RECORDING_THEME_MODE)
    ? env.ONEWORKS_DESKTOP_RECORDING_THEME_MODE
    : undefined
)

export const applyDesktopRecordingThemeSource = () => {
  const themeSource = resolveDesktopRecordingThemeSource()
  if (themeSource == null) return undefined
  return setDesktopThemeSource(themeSource)
}
