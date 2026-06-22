import { normalizeDesktopIconSettings } from './app-icon-settings-model'

const appearancePrimaryColors = new Set(['#E23F12', '#3F7E8F', '#00B454', '#8B9493'])
const updateChannels = new Set<DesktopSettings['updateChannel']>(['stable', 'rc', 'beta', 'alpha'])
const contextCaptureOverlayPlacements = new Set<DesktopContextCaptureOverlayPlacement>(['auto', 'above', 'below'])

export const fallbackLauncherShortcut = 'option+space'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const normalizeApplicationList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(item => item !== '')
    )
  ]
}

const normalizeDesktopContextCaptureSettings = (value: unknown): DesktopContextCaptureSettings => {
  const source = isRecord(value) ? value : {}
  return {
    allowApplications: normalizeApplicationList(source.allowApplications),
    denyApplications: normalizeApplicationList(source.denyApplications),
    enabled: typeof source.enabled === 'boolean' ? source.enabled : false,
    overlayPlacement: typeof source.overlayPlacement === 'string' &&
        contextCaptureOverlayPlacements.has(source.overlayPlacement as DesktopContextCaptureOverlayPlacement)
      ? source.overlayPlacement as DesktopContextCaptureOverlayPlacement
      : 'auto'
  }
}

export const emptyDesktopSettings: DesktopSettings = {
  contextCapture: normalizeDesktopContextCaptureSettings(undefined),
  ...normalizeDesktopIconSettings(undefined),
  launcherShortcut: '',
  launcherShortcutRegistered: false,
  autoUpdate: true,
  openLastWorkspaceOnStartup: false,
  savedPasswordsAutoSignIn: true,
  savedPasswordsOfferToSave: true,
  savedPasswordsRequireAuth: true,
  updateChannel: 'stable'
}

export const normalizeDesktopSettings = (value: unknown): DesktopSettings => {
  if (!isRecord(value)) return emptyDesktopSettings
  return {
    contextCapture: normalizeDesktopContextCaptureSettings(value.contextCapture),
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
    savedPasswordsAutoSignIn: typeof value.savedPasswordsAutoSignIn === 'boolean'
      ? value.savedPasswordsAutoSignIn
      : true,
    savedPasswordsOfferToSave: typeof value.savedPasswordsOfferToSave === 'boolean'
      ? value.savedPasswordsOfferToSave
      : true,
    savedPasswordsRequireAuth: typeof value.savedPasswordsRequireAuth === 'boolean'
      ? value.savedPasswordsRequireAuth
      : true,
    updateChannel: typeof value.updateChannel === 'string' &&
        updateChannels.has(value.updateChannel as DesktopSettings['updateChannel'])
      ? value.updateChannel as DesktopSettings['updateChannel']
      : 'stable'
  }
}
