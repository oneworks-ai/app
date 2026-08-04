import process from 'node:process'

import type { BrowserWindow } from 'electron'

import { WINDOW_FULLSCREEN_STATE_CHANNEL } from './constants'
import type { WindowRecord } from './types'

export const shouldHideLauncherWindowOnBlur = (
  kind: WindowRecord['kind'],
  env: NodeJS.ProcessEnv = process.env
) => (
  kind === 'launcher' &&
  env.ONEWORKS_DESKTOP_RECORDABLE_WINDOWS !== '1' &&
  env.ONEWORKS_DESKTOP_RECORDABLE_LAUNCHER_WINDOW !== '1'
)

export const installWindowRuntimeEvents = ({
  window,
  windowRecord
}: {
  window: BrowserWindow
  windowRecord: WindowRecord
}) => {
  const state = { isInspectingWindow: false }

  window.on('blur', () => {
    if (!shouldHideLauncherWindowOnBlur(windowRecord.kind) || window.isDestroyed() || !window.isVisible()) return
    if (state.isInspectingWindow || window.webContents.isDevToolsOpened()) return
    window.hide()
  })

  window.webContents.on('devtools-opened', () => {
    state.isInspectingWindow = true
  })

  window.webContents.on('devtools-closed', () => {
    state.isInspectingWindow = false
    if (
      shouldHideLauncherWindowOnBlur(windowRecord.kind) &&
      !window.isDestroyed() &&
      window.isVisible() &&
      !window.isFocused()
    ) {
      window.hide()
    }
  })

  const sendFullscreenState = () => {
    if (window.isDestroyed()) return
    window.webContents.send(WINDOW_FULLSCREEN_STATE_CHANNEL, window.isFullScreen())
  }

  window.on('enter-full-screen', sendFullscreenState)
  window.on('leave-full-screen', sendFullscreenState)

  return {
    markInspectingWindow: () => {
      state.isInspectingWindow = true
    }
  }
}
