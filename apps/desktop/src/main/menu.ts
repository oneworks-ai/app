/* eslint-disable max-lines -- system menu template is intentionally centralized. */
import process from 'node:process'

import { BrowserWindow, Menu, app } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

import { standaloneDevicesRoutePath } from '@oneworks/types'

import { getWorkspaceDescription, getWorkspaceDisplayName } from '../workspace-state.cjs'
import { DEVTOOLS_MENU_ACCELERATOR, RELOAD_WINDOW_MENU_ACCELERATOR, VIEW_SHORTCUT_ACTIONS } from './constants'
import type { ViewShortcutAction } from './constants'
import { toElectronAccelerator } from './launcher-shortcut'
import { buildQuitConfirmationMenuLabel, resolveQuitConfirmationAppName } from './quit-confirmation'
import type { QuitConfirmationLanguage } from './quit-confirmation'
import { openOneWorksDevTools, reloadOneWorksWindow, sendViewShortcut } from './shortcuts'
import type { DesktopRuntimeState, OpenWorkspaceDialogInput, WindowRecord, WorkspaceSelectorMode } from './types'
import { checkCliRuntimeUpdates, installCliRuntimeUpdates } from './updates'

interface AppMenuManagerInput {
  checkForUpdates: (input?: { interactive?: boolean }) => Promise<unknown>
  createLauncherWindow: (
    input?: { forceNew?: boolean; show?: boolean; sourceWorkspaceFolder?: string }
  ) => Promise<WindowRecord>
  createWorkspaceSelectorWindow: (input?: {
    mode?: WorkspaceSelectorMode
    parentWindow?: WindowRecord
  }) => Promise<WindowRecord>
  findWindowRecord: (window: BrowserWindow | null) => WindowRecord | undefined
  getQuitConfirmationLanguage: () => QuitConfirmationLanguage
  handleDesktopError: (error: unknown) => void
  openStandaloneTabWindow: (routePath: string) => Promise<WindowRecord>
  openWorkspaceDialog: (input?: OpenWorkspaceDialogInput) => Promise<string | undefined>
  openWorkspaceWindow: (workspaceFolder: string) => Promise<WindowRecord>
  requestQuitConfirmation: () => void
  runtimeState: DesktopRuntimeState
}

export const createAppMenuManager = ({
  checkForUpdates,
  createLauncherWindow,
  createWorkspaceSelectorWindow,
  findWindowRecord,
  getQuitConfirmationLanguage,
  handleDesktopError,
  openStandaloneTabWindow,
  openWorkspaceDialog,
  openWorkspaceWindow,
  requestQuitConfirmation,
  runtimeState
}: AppMenuManagerInput) => {
  const getFocusedWindowRecord = () => {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    return findWindowRecord(focusedWindow instanceof BrowserWindow ? focusedWindow : null)
  }

  const openNewLauncherWindow = () => {
    void createLauncherWindow({ forceNew: true }).catch(handleDesktopError)
  }

  const openLauncher = () => {
    void createLauncherWindow().catch(handleDesktopError)
  }

  const openStandaloneMobileDebug = () => {
    void openStandaloneTabWindow(standaloneDevicesRoutePath).catch(handleDesktopError)
  }

  const openUpdateCheck = () => {
    void checkForUpdates({ interactive: true }).catch(handleDesktopError)
  }

  const checkRuntimeUpdates = () => {
    void checkCliRuntimeUpdates().catch(handleDesktopError)
  }

  const installRuntimeUpdates = () => {
    void installCliRuntimeUpdates().catch(handleDesktopError)
  }

  const reloadWindow = (window?: BrowserWindow) => {
    const targetWindow = window instanceof BrowserWindow ? window : BrowserWindow.getFocusedWindow()
    reloadOneWorksWindow(findWindowRecord(targetWindow), targetWindow)
  }

  const getLauncherMenuAccelerator = () => (
    toElectronAccelerator(runtimeState.desktopState.launcherShortcut) ?? undefined
  )

  const buildQuitMenuItem = (): MenuItemConstructorOptions => {
    const includeAppName = process.platform === 'darwin'
    return {
      accelerator: includeAppName ? 'Command+Q' : 'Ctrl+Q',
      click: requestQuitConfirmation,
      label: buildQuitConfirmationMenuLabel({
        appName: resolveQuitConfirmationAppName(app.name),
        includeAppName,
        language: getQuitConfirmationLanguage()
      })
    }
  }

  const openWorkspaceFromFocusedWindow = () => {
    const targetWindowRecord = getFocusedWindowRecord()
    void openWorkspaceDialog({
      reuseTargetWindow: targetWindowRecord?.kind === 'selector',
      targetWindowRecord
    }).catch(handleDesktopError)
  }

  const buildRecentWorkspaceItems = (input: { maxItems?: number } = {}) => {
    const workspaces = input.maxItems == null
      ? runtimeState.desktopState.recentWorkspaces
      : runtimeState.desktopState.recentWorkspaces.slice(0, input.maxItems)
    return workspaces.map<MenuItemConstructorOptions>(
      workspaceFolder => ({
        click: () => {
          void openWorkspaceWindow(workspaceFolder).catch(handleDesktopError)
        },
        label: getWorkspaceDisplayName(workspaceFolder),
        sublabel: getWorkspaceDescription(workspaceFolder)
      })
    )
  }

  const buildWorkspaceMenuItems = (): MenuItemConstructorOptions[] => {
    const recentWorkspaceItems = buildRecentWorkspaceItems()
    const runningWorkspaceItems = Array.from(runtimeState.services.values()).map<MenuItemConstructorOptions>(
      service => ({
        click: () => {
          void openWorkspaceWindow(service.workspaceFolder).catch(handleDesktopError)
        },
        label: service.displayName,
        sublabel: service.description
      })
    )

    return [
      {
        accelerator: getLauncherMenuAccelerator(),
        click: openLauncher,
        label: 'Open Launcher'
      },
      { type: 'separator' },
      {
        accelerator: 'Shift+CmdOrCtrl+N',
        click: openNewLauncherWindow,
        label: 'New Window'
      },
      {
        label: 'New Window with Profile',
        submenu: [
          {
            click: openNewLauncherWindow,
            label: 'Default Profile'
          }
        ]
      },
      {
        click: openStandaloneMobileDebug,
        label: 'Debug Phone'
      },
      { type: 'separator' },
      {
        accelerator: 'CmdOrCtrl+O',
        click: openWorkspaceFromFocusedWindow,
        label: 'Open...'
      },
      {
        click: openWorkspaceFromFocusedWindow,
        label: 'Open Folder...'
      },
      { type: 'separator' },
      {
        enabled: recentWorkspaceItems.length > 0,
        label: 'Open Recent',
        submenu: recentWorkspaceItems.length > 0
          ? recentWorkspaceItems
          : [{ enabled: false, label: 'No recent projects' }]
      },
      { type: 'separator' },
      {
        accelerator: 'CmdOrCtrl+Shift+O',
        click: openWorkspaceFromFocusedWindow,
        label: 'Open Workspace...'
      },
      {
        click: () => {
          const parentWindow = getFocusedWindowRecord()
          void createWorkspaceSelectorWindow({
            mode: 'dialog',
            parentWindow
          }).catch(handleDesktopError)
        },
        label: 'Switch Project...'
      },
      {
        enabled: runningWorkspaceItems.length > 0,
        label: 'Running Projects',
        submenu: runningWorkspaceItems.length > 0
          ? runningWorkspaceItems
          : [{ enabled: false, label: 'No running projects' }]
      }
    ]
  }

  const buildDockWindowItems = () => (
    Array.from(runtimeState.windows.values())
      .filter(windowRecord => windowRecord.kind !== 'launcher' && !windowRecord.window.isDestroyed())
      .map<MenuItemConstructorOptions>((windowRecord) => {
        const windowTitle = windowRecord.window.getTitle().trim()
        const label = windowTitle === ''
          ? app.name
          : windowTitle.replace(/\s+-\s+One Works$/, '')
        return {
          checked: windowRecord.window.isFocused(),
          click: () => {
            if (windowRecord.window.isMinimized()) {
              windowRecord.window.restore()
            }
            windowRecord.window.show()
            windowRecord.window.focus()
          },
          label,
          type: 'checkbox'
        }
      })
  )

  const refreshDockMenu = () => {
    if (process.platform !== 'darwin' || app.dock == null) {
      return
    }

    const recentWorkspaceItems = buildRecentWorkspaceItems({ maxItems: 10 })
    const recentWorkspaceSubmenuItems = buildRecentWorkspaceItems({ maxItems: 10 })
    const windowItems = buildDockWindowItems()
    const dockTemplate: MenuItemConstructorOptions[] = [
      ...(recentWorkspaceItems.length > 0
        ? [
          ...recentWorkspaceItems,
          { type: 'separator' } satisfies MenuItemConstructorOptions
        ]
        : []),
      ...(windowItems.length > 0
        ? [
          ...windowItems,
          { type: 'separator' } satisfies MenuItemConstructorOptions
        ]
        : []),
      {
        accelerator: getLauncherMenuAccelerator(),
        click: openLauncher,
        label: 'Open Launcher'
      },
      { type: 'separator' },
      {
        accelerator: 'Shift+CmdOrCtrl+N',
        click: openNewLauncherWindow,
        label: 'New Window'
      },
      {
        label: 'New Window with Profile',
        submenu: [
          {
            click: openNewLauncherWindow,
            label: 'Default Profile'
          }
        ]
      },
      { type: 'separator' },
      {
        accelerator: 'CmdOrCtrl+O',
        click: openWorkspaceFromFocusedWindow,
        label: 'Open...'
      },
      {
        click: openWorkspaceFromFocusedWindow,
        label: 'Open Folder...'
      },
      {
        enabled: recentWorkspaceItems.length > 0,
        label: 'Open Recent',
        submenu: recentWorkspaceSubmenuItems.length > 0
          ? recentWorkspaceSubmenuItems
          : [{ enabled: false, label: 'No recent projects' }]
      }
    ]

    app.dock.setMenu(Menu.buildFromTemplate(dockTemplate))
  }

  const refreshAppMenu = () => {
    const viewShortcutItem = (
      label: string,
      accelerator: string,
      action: ViewShortcutAction
    ): MenuItemConstructorOptions => ({
      accelerator,
      click: () => sendViewShortcut(action),
      label
    })
    const template: MenuItemConstructorOptions[] = [
      ...(process.platform === 'darwin'
        ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              {
                click: openUpdateCheck,
                label: 'Check for Updates...'
              },
              { type: 'separator' },
              buildQuitMenuItem()
            ]
          } satisfies MenuItemConstructorOptions
        ]
        : []),
      {
        label: 'File',
        submenu: [
          ...buildWorkspaceMenuItems(),
          { type: 'separator' },
          process.platform === 'darwin' ? { role: 'close' } : buildQuitMenuItem()
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { type: 'separator' },
          { role: 'selectAll' }
        ]
      },
      {
        label: 'View',
        submenu: [
          viewShortcutItem('Toggle Sidebar', 'CmdOrCtrl+B', VIEW_SHORTCUT_ACTIONS.toggleSidebar),
          viewShortcutItem('Toggle Terminal', 'CmdOrCtrl+J', VIEW_SHORTCUT_ACTIONS.toggleTerminal),
          viewShortcutItem('Toggle File Tree', 'Shift+CmdOrCtrl+E', VIEW_SHORTCUT_ACTIONS.toggleFileTree),
          viewShortcutItem('Open Browser Tab', 'CmdOrCtrl+T', VIEW_SHORTCUT_ACTIONS.openBrowserTab),
          viewShortcutItem('Reload Browser Page', 'CmdOrCtrl+R', VIEW_SHORTCUT_ACTIONS.reloadBrowserPage),
          {
            accelerator: RELOAD_WINDOW_MENU_ACCELERATOR,
            click: (_item, window) => reloadWindow(window instanceof BrowserWindow ? window : undefined),
            label: 'Reload Window'
          },
          viewShortcutItem('Toggle Side Panel', 'Alt+CmdOrCtrl+B', VIEW_SHORTCUT_ACTIONS.toggleSidePanel),
          viewShortcutItem('Find', 'CmdOrCtrl+F', VIEW_SHORTCUT_ACTIONS.find),
          { type: 'separator' },
          viewShortcutItem('Previous Chat', 'Shift+CmdOrCtrl+[', VIEW_SHORTCUT_ACTIONS.previousChat),
          viewShortcutItem('Next Chat', 'Shift+CmdOrCtrl+]', VIEW_SHORTCUT_ACTIONS.nextChat),
          viewShortcutItem('Back', 'CmdOrCtrl+[', VIEW_SHORTCUT_ACTIONS.back),
          viewShortcutItem('Forward', 'CmdOrCtrl+]', VIEW_SHORTCUT_ACTIONS.forward),
          { type: 'separator' },
          { accelerator: 'CmdOrCtrl+Plus', label: 'Zoom In', role: 'zoomIn' },
          { accelerator: 'CmdOrCtrl+-', label: 'Zoom Out', role: 'zoomOut' },
          { accelerator: 'CmdOrCtrl+0', label: 'Actual Size', role: 'resetZoom' }
        ]
      },
      {
        label: 'Developer',
        submenu: [
          {
            accelerator: DEVTOOLS_MENU_ACCELERATOR,
            click: (_item, window) => openOneWorksDevTools(window instanceof BrowserWindow ? window : undefined),
            label: 'Open One Works DevTools'
          }
        ]
      },
      {
        label: 'Help',
        submenu: [
          ...(process.platform === 'darwin'
            ? []
            : [
              {
                click: openUpdateCheck,
                label: 'Check for Updates...'
              },
              { type: 'separator' } satisfies MenuItemConstructorOptions
            ]),
          {
            click: checkRuntimeUpdates,
            label: 'Check CLI Runtime Updates...'
          },
          {
            click: installRuntimeUpdates,
            label: 'Install CLI Runtime Update...'
          }
        ]
      }
    ]

    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
    refreshDockMenu()
  }

  return {
    refreshAppMenu
  }
}
