import { DEFAULT_LAUNCHER_SHORTCUT } from './constants'
import {
  DEFAULT_DESKTOP_ICON_APPEARANCE,
  DEFAULT_DESKTOP_ICON_BACKGROUND,
  DEFAULT_DESKTOP_ICON_SYNC,
  DEFAULT_DESKTOP_ICON_THEME
} from './desktop-icon-settings'
import type { DesktopRuntimeState } from './types'
import { DEFAULT_DESKTOP_AUTO_UPDATE, DEFAULT_DESKTOP_UPDATE_CHANNEL } from './update-types'

export const createDesktopRuntimeState = (): DesktopRuntimeState => ({
  desktopState: {
    iconAppearance: DEFAULT_DESKTOP_ICON_APPEARANCE,
    iconBackground: DEFAULT_DESKTOP_ICON_BACKGROUND,
    syncAppIcon: DEFAULT_DESKTOP_ICON_SYNC,
    iconTheme: DEFAULT_DESKTOP_ICON_THEME,
    launcherShortcut: DEFAULT_LAUNCHER_SHORTCUT,
    autoUpdate: DEFAULT_DESKTOP_AUTO_UPDATE,
    openLastWorkspaceOnStartup: false,
    recentWorkspaces: [],
    updateChannel: DEFAULT_DESKTOP_UPDATE_CHANNEL
  },
  isQuitting: false,
  pendingLaunchRequests: [],
  services: new Map(),
  windows: new Map()
})
