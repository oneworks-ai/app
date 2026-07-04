/* eslint-disable max-lines -- Electron window factory keeps window lifecycle wiring in one boundary. */
import process from 'node:process'

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
  restoreWorkspaceReadyWindowBackground,
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

const parseBoundsEnv = (value: string | undefined) => {
  const normalized = value?.trim()
  if (normalized == null || normalized === '') return undefined

  const match = /^(?<x>-?\d+),(?<y>-?\d+),(?<width>\d+),(?<height>\d+)$/u.exec(normalized)
  if (match?.groups == null) {
    console.warn(`[oneworks-desktop] invalid window bounds env ignored: ${normalized}`)
    return undefined
  }

  const bounds = {
    height: Number.parseInt(match.groups.height, 10),
    width: Number.parseInt(match.groups.width, 10),
    x: Number.parseInt(match.groups.x, 10),
    y: Number.parseInt(match.groups.y, 10)
  }
  if (bounds.width < 300 || bounds.height < 360) {
    console.warn(`[oneworks-desktop] too small window bounds env ignored: ${normalized}`)
    return undefined
  }
  return bounds
}

const resolveInitialWindowBounds = (input: CreateWindowRecordInput) => {
  const kind = input.kind ?? 'workspace'
  const specificEnv = kind === 'launcher'
    ? process.env.ONEWORKS_DESKTOP_LAUNCHER_WINDOW_BOUNDS
    : kind === 'workspace' || kind === 'standalone'
    ? process.env.ONEWORKS_DESKTOP_WORKSPACE_WINDOW_BOUNDS
    : kind === 'selector'
    ? process.env.ONEWORKS_DESKTOP_SELECTOR_WINDOW_BOUNDS
    : undefined

  return parseBoundsEnv(specificEnv) ?? parseBoundsEnv(process.env.ONEWORKS_DESKTOP_WINDOW_BOUNDS)
}

const isRecordableLauncherWindow = () => process.env.ONEWORKS_DESKTOP_RECORDABLE_LAUNCHER_WINDOW === '1'

const isRecordableWindowMode = () => (
  process.env.ONEWORKS_DESKTOP_RECORDABLE_WINDOWS === '1' ||
  process.env.ONEWORKS_DESKTOP_RECORDABLE_LAUNCHER_WINDOW === '1'
)

const prepareRecordableWindowForSystemCapture = (window: BrowserWindow) => {
  if (process.platform !== 'darwin' || !isRecordableWindowMode()) return
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
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
    const isStandaloneWindow = input.kind === 'standalone'
    const isInitialSelectorWindow = isSelectorWindow && selectorMode === 'initial'
    const initialBounds = resolveInitialWindowBounds(input)
    const defaultMinHeight = isLauncherWindow ? 360 : isSelectorWindow ? 620 : 720
    const minHeight = initialBounds?.height == null
      ? defaultMinHeight
      : Math.min(defaultMinHeight, initialBounds.height)
    const recordableLauncherWindow = isLauncherWindow && isRecordableLauncherWindow()
    const window = new BrowserWindow({
      height: isLauncherWindow ? 560 : isInitialSelectorWindow ? 760 : isSelectorWindow ? 700 : 900,
      minHeight,
      minWidth: 300,
      parent: input.parentWindow?.window,
      resizable: !isLauncherWindow,
      show: false,
      skipTaskbar: isLauncherWindow && !recordableLauncherWindow,
      title: isLauncherWindow
        ? buildLauncherWindowTitle()
        : isSelectorWindow
        ? buildWorkspaceSelectorWindowTitle()
        : 'One Works',
      width: isLauncherWindow ? 760 : isInitialSelectorWindow ? 920 : isSelectorWindow ? 720 : 1280,
      ...initialBounds,
      ...getWindowChromeOptions({ isLauncherWindow, isStandaloneWindow }),
      webPreferences: {
        additionalArguments: [getSystemLocaleArgument()],
        contextIsolation: true,
        nodeIntegration: false,
        preload: preloadPath,
        sandbox: true,
        webviewTag: true
      }
    })
    prepareRecordableWindowForSystemCapture(window)
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
        if (isRecordableWindowMode()) {
          window.moveTop()
        }
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
        const childWindowKind = windowRecord.kind === 'standalone' ? 'standalone' : 'workspace'
        const childWindowRecord = createWindowRecord({ kind: childWindowKind })
        childWindowRecord.kind = childWindowKind
        childWindowRecord.selectorMode = undefined
        childWindowRecord.currentServerUrl = windowRecord.currentServerUrl
        if (childWindowKind === 'standalone') {
          childWindowRecord.standaloneRoutePath = windowRecord.standaloneRoutePath
        } else {
          childWindowRecord.workspaceFolder = windowRecord.workspaceFolder
          childWindowRecord.workspaceServerUrl = windowRecord.workspaceServerUrl
        }
        childWindowRecord.window.setTitle(windowRecord.window.getTitle())
        setWorkspaceLoadingWindowBackground(childWindowRecord.window)

        void childWindowRecord.window.loadURL(url).then(() => {
          if (childWindowRecord.window.isDestroyed()) {
            return
          }
          if (childWindowKind === 'standalone') {
            restoreWorkspaceReadyWindowBackground(childWindowRecord.window)
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
