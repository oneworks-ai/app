import { normalizeDesktopIconSettings } from './app-icon-settings-model'

const appearancePrimaryColors = new Set(['#E23F12', '#3F7E8F', '#00B454', '#8B9493'])
const updateChannels = new Set<DesktopSettings['updateChannel']>(['stable', 'rc', 'beta', 'alpha'])

export const fallbackLauncherShortcut = 'option+space'

export const emptyDesktopSettings: DesktopSettings = {
  ...normalizeDesktopIconSettings(undefined),
  launcherShortcut: '',
  launcherShortcutRegistered: false,
  autoUpdate: true,
  openLastWorkspaceOnStartup: false,
  updateChannel: 'stable'
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

export const normalizeDesktopSettings = (value: unknown): DesktopSettings => {
  if (!isRecord(value)) return emptyDesktopSettings
  return {
    ...normalizeDesktopIconSettings(value),
    primaryColor: typeof value.primaryColor === 'string' && appearancePrimaryColors.has(value.primaryColor)
      ? value.primaryColor as DesktopSettings['primaryColor']
      : undefined,
    themeMode: value.themeMode === 'light' || value.themeMode === 'dark' || value.themeMode === 'system'
      ? value.themeMode
      : undefined,
    launcherShortcut: typeof value.launcherShortcut === 'string' ? value.launcherShortcut : '',
    launcherShortcutError: typeof value.launcherShortcutError === 'string' && value.launcherShortcutError !== ''
      ? value.launcherShortcutError
      : undefined,
    launcherShortcutRegistered: typeof value.launcherShortcutRegistered === 'boolean'
      ? value.launcherShortcutRegistered
      : false,
    autoUpdate: typeof value.autoUpdate === 'boolean' ? value.autoUpdate : true,
    openLastWorkspaceOnStartup: typeof value.openLastWorkspaceOnStartup === 'boolean'
      ? value.openLastWorkspaceOnStartup
      : false,
    updateChannel: typeof value.updateChannel === 'string' &&
        updateChannels.has(value.updateChannel as DesktopSettings['updateChannel'])
      ? value.updateChannel as DesktopSettings['updateChannel']
      : 'stable'
  }
}
