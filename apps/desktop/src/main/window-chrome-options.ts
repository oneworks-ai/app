import process from 'node:process'

import { app, nativeTheme } from 'electron'
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'

const transparentWindowBackgroundColor = '#00000000'
const workspaceLoadingWindowBackgroundColors = {
  dark: '#202321',
  light: '#f5f7f2'
} as const
const standaloneTrafficLightPosition = { x: 11, y: 12 } as const
const workspaceTrafficLightPosition = { x: 12, y: 12 } as const
const RECORDABLE_LAUNCHER_WINDOW_ENV = 'ONEWORKS_DESKTOP_RECORDABLE_LAUNCHER_WINDOW'

const getWorkspaceLoadingWindowBackgroundColor = () => (
  nativeTheme.shouldUseDarkColors
    ? workspaceLoadingWindowBackgroundColors.dark
    : workspaceLoadingWindowBackgroundColors.light
)

export const setWorkspaceLoadingWindowBackground = (window: BrowserWindow) => {
  if (process.platform !== 'darwin' || window.isDestroyed()) return

  window.setBackgroundColor(getWorkspaceLoadingWindowBackgroundColor())
}

export const restoreWorkspaceReadyWindowBackground = (window: BrowserWindow) => {
  if (process.platform !== 'darwin' || window.isDestroyed()) return

  window.setBackgroundColor(transparentWindowBackgroundColor)
}

export const getWindowChromeOptions = (input: {
  isLauncherWindow: boolean
  isStandaloneWindow: boolean
}): BrowserWindowConstructorOptions => {
  if (process.platform !== 'darwin') return {}

  if (input.isLauncherWindow) {
    const recordableLauncherWindow = process.env[RECORDABLE_LAUNCHER_WINDOW_ENV] === '1'
    const launcherBaseOptions = {
      frame: false,
      fullscreenable: false,
      minimizable: false
    } satisfies BrowserWindowConstructorOptions
    const launcherGlassOptions = {
      backgroundColor: transparentWindowBackgroundColor,
      transparent: true,
      vibrancy: 'popover',
      visualEffectState: 'active'
    } satisfies BrowserWindowConstructorOptions
    if (recordableLauncherWindow) {
      return {
        ...launcherBaseOptions,
        ...launcherGlassOptions
      }
    }

    return {
      ...launcherBaseOptions,
      ...launcherGlassOptions,
      alwaysOnTop: true,
      hiddenInMissionControl: true,
      type: 'panel'
    }
  }

  return {
    backgroundColor: transparentWindowBackgroundColor,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: input.isStandaloneWindow ? standaloneTrafficLightPosition : workspaceTrafficLightPosition,
    transparent: true,
    vibrancy: 'sidebar',
    visualEffectState: 'active'
  }
}

export const getSystemLocaleArgument = () => {
  const systemLocale = app.getPreferredSystemLanguages()[0] ?? app.getLocale()
  return `--oneworks-system-locale=${encodeURIComponent(systemLocale)}`
}
