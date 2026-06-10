import type { BrowserWindow } from 'electron'

import { WINDOW_FULLSCREEN_STATE_CHANNEL } from './constants'
import type { WindowRecord } from './types'

export const installWindowRuntimeEvents = ({
  window,
  windowRecord
}: {
  window: BrowserWindow
  windowRecord: WindowRecord
}) => {
  const state = { isInspectingWindow: false }

  window.on('blur', () => {
    if (windowRecord.kind !== 'launcher' || window.isDestroyed() || !window.isVisible()) return
    if (state.isInspectingWindow || window.webContents.isDevToolsOpened()) return
    window.hide()
  })

  window.webContents.on('devtools-opened', () => {
    state.isInspectingWindow = true
  })

  window.webContents.on('devtools-closed', () => {
    state.isInspectingWindow = false
    if (windowRecord.kind === 'launcher' && !window.isDestroyed() && window.isVisible() && !window.isFocused()) {
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
