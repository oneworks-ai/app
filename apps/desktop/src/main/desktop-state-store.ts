import fs from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

import { getRecentWorkspaceFoldersFromState } from '../workspace-state.cjs'
import { DEFAULT_LAUNCHER_SHORTCUT } from './constants'
import { DEFAULT_DESKTOP_CONTEXT_CAPTURE_SETTINGS } from './context-capture-settings'
import { normalizeDesktopIconSettings } from './desktop-icon-settings'
import { toElectronAccelerator } from './launcher-shortcut'
import type { DesktopSettingsState, DesktopState } from './types'
import { DEFAULT_DESKTOP_AUTO_UPDATE, DEFAULT_DESKTOP_UPDATE_CHANNEL } from './update-types'

const legacyDesktopSettingKeys = [
  'launcherShortcut',
  'openLastWorkspaceOnStartup',
  'iconAppearance',
  'iconBackground',
  'syncAppIcon',
  'iconTheme'
] as const

const readJsonFile = (filePath: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return undefined
  }
}

const writeJsonFile = (filePath: string, value: unknown) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

const getDesktopStatePath = () => path.join(app.getPath('userData'), 'desktop-state.json')

const pickLegacyDesktopSettings = (state: unknown) => {
  if (state == null || typeof state !== 'object' || Array.isArray(state)) {
    return {}
  }

  const source = state as Record<string, unknown>
  return Object.fromEntries(
    legacyDesktopSettingKeys
      .filter(key => key in source)
      .map(key => [key, source[key]])
  )
}

const getLauncherShortcutFromValue = (value: unknown) => {
  if (typeof value === 'string') {
    const shortcut = value.trim()
    if (shortcut === '') return ''
    return toElectronAccelerator(shortcut) == null ? DEFAULT_LAUNCHER_SHORTCUT : shortcut
  }
  if (value == null) {
    return ''
  }
  return DEFAULT_LAUNCHER_SHORTCUT
}

const getLauncherShortcutFromState = (state: unknown) => {
  if (state == null || typeof state !== 'object' || Array.isArray(state)) {
    return DEFAULT_LAUNCHER_SHORTCUT
  }

  if (!('launcherShortcut' in state)) {
    return DEFAULT_LAUNCHER_SHORTCUT
  }

  return getLauncherShortcutFromValue((state as { launcherShortcut?: unknown }).launcherShortcut)
}

const getOpenLastWorkspaceOnStartupFromState = (state: unknown) => {
  if (state == null || typeof state !== 'object' || Array.isArray(state)) {
    return false
  }

  const value = (state as { openLastWorkspaceOnStartup?: unknown }).openLastWorkspaceOnStartup
  return typeof value === 'boolean' ? value : false
}

export const readLegacyDesktopSettings = (): Partial<DesktopSettingsState> => {
  const state = readJsonFile(getDesktopStatePath())
  if (state == null || typeof state !== 'object' || Array.isArray(state)) {
    return {}
  }

  const source = state as Record<string, unknown>
  const iconSettings = normalizeDesktopIconSettings(source)
  return {
    ...('launcherShortcut' in source
      ? { launcherShortcut: getLauncherShortcutFromValue(source.launcherShortcut) }
      : {}),
    ...('openLastWorkspaceOnStartup' in source
      ? { openLastWorkspaceOnStartup: getOpenLastWorkspaceOnStartupFromState(source) }
      : {}),
    ...('iconAppearance' in source ? { iconAppearance: iconSettings.iconAppearance } : {}),
    ...('iconBackground' in source ? { iconBackground: iconSettings.iconBackground } : {}),
    ...('syncAppIcon' in source ? { syncAppIcon: iconSettings.syncAppIcon } : {}),
    ...('iconTheme' in source ? { iconTheme: iconSettings.iconTheme } : {})
  }
}

export const readDesktopState = (): DesktopState => {
  const state = readJsonFile(getDesktopStatePath())
  return {
    contextCapture: DEFAULT_DESKTOP_CONTEXT_CAPTURE_SETTINGS,
    ...normalizeDesktopIconSettings(state),
    launcherShortcut: getLauncherShortcutFromState(state),
    autoUpdate: DEFAULT_DESKTOP_AUTO_UPDATE,
    openLastWorkspaceOnStartup: getOpenLastWorkspaceOnStartupFromState(state),
    savedPasswordsAutoSignIn: true,
    savedPasswordsOfferToSave: true,
    savedPasswordsRequireAuth: true,
    recentWorkspaces: getRecentWorkspaceFoldersFromState(state),
    updateChannel: DEFAULT_DESKTOP_UPDATE_CHANNEL
  }
}

export const saveDesktopState = (
  desktopState: DesktopState,
  options: {
    preserveLegacySettings?: boolean
  } = {}
) => {
  const legacySettings = options.preserveLegacySettings === true
    ? pickLegacyDesktopSettings(readJsonFile(getDesktopStatePath()))
    : {}
  writeJsonFile(getDesktopStatePath(), {
    ...legacySettings,
    recentWorkspaces: desktopState.recentWorkspaces
  })
}
