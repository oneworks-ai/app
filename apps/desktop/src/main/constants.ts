import process from 'node:process'

export const SERVER_HOST = '127.0.0.1'
export const CLIENT_BASE = '/ui'
export const CLIENT_READY_PATH = `${CLIENT_BASE}/`
export const CLIENT_READY_TIMEOUT_MS = 30000
export const SERVER_READY_TIMEOUT_MS = 30000
export const SERVER_STOP_TIMEOUT_MS = 3000
export const DEVTOOLS_MENU_ACCELERATOR = process.platform === 'darwin' ? 'Alt+Command+I' : 'Ctrl+Shift+I'
export const RELOAD_WINDOW_MENU_ACCELERATOR = 'CmdOrCtrl+Shift+R'
export const RELOAD_WINDOW_SHORTCUT_LABEL = process.platform === 'darwin' ? 'Command+Shift+R' : 'Ctrl+Shift+R'
export const DEFAULT_LAUNCHER_SHORTCUT = 'option+space'
export const AUTO_UPDATE_CONFIG_FILES = ['app-update.yml', 'dev-app-update.yml']
export const WORKSPACE_SELECTOR_STATE_CHANNEL = 'desktop:workspace-selector-state'
export const DESKTOP_SETTINGS_CHANNEL = 'desktop:settings'
export const DESKTOP_UPDATE_STATUS_CHANNEL = 'desktop:update-status'
export const GLOBAL_INTERFACE_LANGUAGE_CHANNEL = 'desktop:global-interface-language'
export const TOGGLE_SIDEBAR_CHANNEL = 'desktop:toggle-sidebar'
export const VIEW_SHORTCUT_CHANNEL = 'desktop:view-shortcut'
export const WINDOW_FULLSCREEN_STATE_CHANNEL = 'desktop:window-fullscreen-state'
export const WORKSPACE_RESOURCE_REQUEST_CHANNEL = 'desktop:workspace-resource-request'
export const WORKSPACE_STARTUP_READY_CHANNEL = 'desktop:workspace-startup-ready'
export const WORKSPACE_CONNECTION_CHANNEL = 'desktop:workspace-connection'

export const VIEW_SHORTCUT_ACTIONS = {
  back: 'back',
  find: 'find',
  forward: 'forward',
  nextChat: 'next-chat',
  openBrowserTab: 'open-browser-tab',
  previousChat: 'previous-chat',
  reloadBrowserPage: 'reload-browser-page',
  toggleFileTree: 'toggle-file-tree',
  toggleSidePanel: 'toggle-side-panel',
  toggleSidebar: 'toggle-sidebar',
  toggleTerminal: 'toggle-terminal'
} as const

export type ViewShortcutAction = typeof VIEW_SHORTCUT_ACTIONS[keyof typeof VIEW_SHORTCUT_ACTIONS]

export interface ViewShortcutInput {
  action: ViewShortcutAction
  alt?: boolean
  key: string
  shift?: boolean
}

export const VIEW_SHORTCUT_INPUTS: ViewShortcutInput[] = [
  { action: VIEW_SHORTCUT_ACTIONS.toggleSidebar, key: 'b' },
  { action: VIEW_SHORTCUT_ACTIONS.toggleTerminal, key: 'j' },
  { action: VIEW_SHORTCUT_ACTIONS.toggleFileTree, key: 'e', shift: true },
  { action: VIEW_SHORTCUT_ACTIONS.openBrowserTab, key: 't' },
  { action: VIEW_SHORTCUT_ACTIONS.reloadBrowserPage, key: 'r' },
  { action: VIEW_SHORTCUT_ACTIONS.toggleSidePanel, alt: true, key: 'b' },
  { action: VIEW_SHORTCUT_ACTIONS.find, key: 'f' },
  { action: VIEW_SHORTCUT_ACTIONS.previousChat, key: '[', shift: true },
  { action: VIEW_SHORTCUT_ACTIONS.nextChat, key: ']', shift: true },
  { action: VIEW_SHORTCUT_ACTIONS.back, key: '[' },
  { action: VIEW_SHORTCUT_ACTIONS.forward, key: ']' }
]
