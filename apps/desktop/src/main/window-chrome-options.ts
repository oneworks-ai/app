import process from 'node:process'

import { app, nativeTheme } from 'electron'
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'

const transparentWindowBackgroundColor = '#00000000'
const workspaceLoadingWindowBackgroundColors = {
  dark: '#202321',
  light: '#f5f7f2'
} as const

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
    return {
      alwaysOnTop: true,
      backgroundColor: transparentWindowBackgroundColor,
      frame: false,
      fullscreenable: false,
      hiddenInMissionControl: true,
      minimizable: false,
      transparent: true,
      type: 'panel',
      vibrancy: 'popover',
      visualEffectState: 'active'
    }
  }

  return {
    backgroundColor: transparentWindowBackgroundColor,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: input.isStandaloneWindow ? { x: 11, y: 12 } : { x: 12, y: 12 },
    transparent: true,
    vibrancy: 'sidebar',
    visualEffectState: 'active'
  }
}

export const getSystemLocaleArgument = () => {
  const systemLocale = app.getPreferredSystemLanguages()[0] ?? app.getLocale()
  return `--oneworks-system-locale=${encodeURIComponent(systemLocale)}`
}
