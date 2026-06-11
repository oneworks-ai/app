import { BrowserWindow, shell } from 'electron'

import { applyDesktopIconToWindow } from './desktop-app-icon'
import { preloadPath } from './paths'
import {
  getViewShortcutInputAction,
  isDevToolsShortcutInput,
  isReloadWindowShortcutInput,
  openOneWorksDevTools,
  reloadOneWorksWindow,
  sendViewShortcut
} from './shortcuts'
import type { CreateWindowRecordInput, DesktopRuntimeState, WindowRecord, WorkspaceService } from './types'
import { installWebviewSecurityHandlers } from './webview-security'
import {
  getSystemLocaleArgument,
  getWindowChromeOptions,
  setWorkspaceLoadingWindowBackground
} from './window-chrome-options'
import { installWindowCloseLifecycle } from './window-close-lifecycle'
import { installWindowLoadFailureHandlers } from './window-load-failure'
import { installWindowRuntimeEvents } from './window-runtime-events'
import { buildLauncherWindowTitle, buildWorkspaceSelectorWindowTitle } from './window-titles'

interface BrowserWindowFactoryInput {
  broadcastWorkspaceSelectorState: () => void
  getWindowRecords: () => WindowRecord[]
  refreshAppMenu: () => void
  runtimeState: DesktopRuntimeState
  stopWorkspaceService: (service: WorkspaceService) => Promise<void>
}

export const createBrowserWindowFactory = ({
  broadcastWorkspaceSelectorState,
  getWindowRecords,
  refreshAppMenu,
  runtimeState,
  stopWorkspaceService
}: BrowserWindowFactoryInput) => {
  const createWindowRecord = (input: CreateWindowRecordInput = {}): WindowRecord => {
    const selectorMode = input.selectorMode ?? 'dialog'
    const isLauncherWindow = input.kind === 'launcher'
    const isSelectorWindow = input.kind === 'selector'
    const isInitialSelectorWindow = isSelectorWindow && selectorMode === 'initial'
    const window = new BrowserWindow({
      height: isLauncherWindow ? 560 : isInitialSelectorWindow ? 760 : isSelectorWindow ? 700 : 900,
      minHeight: isLauncherWindow ? 360 : isSelectorWindow ? 620 : 720,
      minWidth: 300,
      parent: input.parentWindow?.window,
      resizable: !isLauncherWindow,
      show: false,
      skipTaskbar: isLauncherWindow,
      title: isLauncherWindow
        ? buildLauncherWindowTitle()
        : isSelectorWindow
        ? buildWorkspaceSelectorWindowTitle()
        : 'One Works',
      width: isLauncherWindow ? 760 : isInitialSelectorWindow ? 920 : isSelectorWindow ? 720 : 1280,
      ...getWindowChromeOptions({ isLauncherWindow }),
      webPreferences: {
        additionalArguments: [getSystemLocaleArgument()],
        contextIsolation: true,
        nodeIntegration: false,
        preload: preloadPath,
        sandbox: true,
        webviewTag: true
      }
    })
    applyDesktopIconToWindow(window, runtimeState.desktopState)

    const windowRecord: WindowRecord = {
      currentServerUrl: undefined,
      kind: input.kind ?? 'workspace',
      selectorMode,
      window,
      workspaceFolder: undefined
    }

    runtimeState.windows.set(window.id, windowRecord)

    const shouldShowOnReady = input.showOnReady !== false

    window.once('ready-to-show', () => {
      if (shouldShowOnReady && !window.isDestroyed()) {
        window.show()
      }
    })

    const { markInspectingWindow } = installWindowRuntimeEvents({ window, windowRecord })

    installWindowCloseLifecycle({
      broadcastWorkspaceSelectorState,
      getWindowRecords,
      refreshAppMenu,
      runtimeState,
      stopWorkspaceService,
      windowRecord
    })

    window.webContents.setWindowOpenHandler(({ url }) => {
      if (windowRecord.currentServerUrl != null && url.startsWith(windowRecord.currentServerUrl)) {
        const childWindowRecord = createWindowRecord({ kind: 'workspace' })
        childWindowRecord.kind = 'workspace'
        childWindowRecord.selectorMode = undefined
        childWindowRecord.workspaceFolder = windowRecord.workspaceFolder
        childWindowRecord.currentServerUrl = windowRecord.currentServerUrl
        childWindowRecord.workspaceServerUrl = windowRecord.workspaceServerUrl
        childWindowRecord.window.setTitle(windowRecord.window.getTitle())
        setWorkspaceLoadingWindowBackground(childWindowRecord.window)

        void childWindowRecord.window.loadURL(url).then(() => {
          if (childWindowRecord.window.isDestroyed()) {
            return
          }
          childWindowRecord.window.show()
          childWindowRecord.window.focus()
        }).catch((error) => {
          console.error('[oneworks-desktop] failed to open workspace window', error)
          if (!childWindowRecord.window.isDestroyed()) {
            childWindowRecord.window.close()
          }
        })
        return { action: 'deny' }
      }
      void shell.openExternal(url)
      return { action: 'deny' }
    })

    installWebviewSecurityHandlers(window)
    installWindowLoadFailureHandlers(windowRecord)

    window.webContents.on('will-navigate', (event, url) => {
      if (windowRecord.currentServerUrl != null && url.startsWith(windowRecord.currentServerUrl)) {
        return
      }
      if (url.startsWith('data:text/html')) {
        return
      }
      event.preventDefault()
      void shell.openExternal(url)
    })

    window.webContents.on('before-input-event', (event, input) => {
      if (isReloadWindowShortcutInput(input)) {
        event.preventDefault()
        reloadOneWorksWindow(windowRecord, window)
        return
      }

      const viewShortcutAction = getViewShortcutInputAction(input)
      if (viewShortcutAction != null) {
        event.preventDefault()
        sendViewShortcut(viewShortcutAction, window)
        return
      }

      if (!isDevToolsShortcutInput(input)) {
        return
      }

      event.preventDefault()
      markInspectingWindow()
      openOneWorksDevTools(window)
    })

    return windowRecord
  }

  return {
    createWindowRecord
  }
}
