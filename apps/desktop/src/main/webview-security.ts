import { shell } from 'electron'
import type { BrowserWindow } from 'electron'

import { installWebviewContextMenu } from './webview-context-menu'

export const installWebviewSecurityHandlers = (window: BrowserWindow) => {
  window.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload
    delete (webPreferences as Record<string, unknown>).preloadURL
    webPreferences.contextIsolation = true
    webPreferences.nodeIntegration = false
    webPreferences.sandbox = true

    const sourceUrl = typeof params.src === 'string' ? params.src : ''
    if (!/^https?:\/\//i.test(sourceUrl)) {
      event.preventDefault()
    }
  })

  window.webContents.on('did-attach-webview', (_event, webContents) => {
    installWebviewContextMenu(window, webContents)

    webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })
  })
}
