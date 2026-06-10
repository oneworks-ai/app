import type {
  DesktopIconAppearance,
  DesktopIconBackground,
  DesktopIconSync,
  DesktopIconTheme
} from './desktop-icon-settings'
import type { DesktopUpdateChannel } from './update-types'

export interface DesktopState {
  iconAppearance: DesktopIconAppearance
  iconBackground: DesktopIconBackground
  syncAppIcon: DesktopIconSync
  iconTheme: DesktopIconTheme
  launcherShortcut: string
  autoUpdate: boolean
  openLastWorkspaceOnStartup: boolean
  recentWorkspaces: string[]
  updateChannel: DesktopUpdateChannel
}

export type DesktopSettingsState = Omit<DesktopState, 'recentWorkspaces'>

export interface DesktopBuildSource {
  branch: string
  buildTime: string
  gitHash: string
}

export interface DesktopSettings {
  iconAppearance: DesktopIconAppearance
  iconBackground: DesktopIconBackground
  syncAppIcon: DesktopIconSync
  iconTheme: DesktopIconTheme
  primaryColor?: '#E23F12' | '#3F7E8F' | '#00B454' | '#8B9493'
  themeMode?: 'system' | 'light' | 'dark'
  buildSource?: DesktopBuildSource
  launcherShortcut: string
  launcherShortcutError?: string
  launcherShortcutRegistered: boolean
  autoUpdate: boolean
  openLastWorkspaceOnStartup: boolean
  updateChannel: DesktopUpdateChannel
}
