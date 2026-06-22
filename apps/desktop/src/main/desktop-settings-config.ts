/* eslint-disable max-lines -- desktop and appearance config helpers stay together for migration safety. */
import process from 'node:process'

import { buildConfigJsonVariables, loadConfigState, updateConfigFile } from '@oneworks/config'
import { normalizeThemePrimaryColor } from '@oneworks/icon/presets'
import type { Config } from '@oneworks/types'
import { app } from 'electron'

import { DEFAULT_LAUNCHER_SHORTCUT } from './constants'
import { normalizeDesktopContextCaptureSettings } from './context-capture-settings'
import { normalizeDesktopIconSettings } from './desktop-icon-settings'
import { toElectronAccelerator } from './launcher-shortcut'
import type { DesktopSettingsState } from './types'
import type { DesktopUpdateChannel } from './update-types'
import { normalizeDesktopAutoUpdate, normalizeDesktopUpdateChannel } from './update-types'

const desktopSettingsKeys = [
  'contextCapture',
  'launcherShortcut',
  'openLastWorkspaceOnStartup',
  'savedPasswordsAutoSignIn',
  'savedPasswordsOfferToSave',
  'savedPasswordsRequireAuth',
  'iconAppearance',
  'iconBackground',
  'syncAppIcon',
  'iconTheme'
] as const satisfies readonly (keyof DesktopSettingsState)[]

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

const ensureRealHomeEnv = () => {
  if (process.env.__ONEWORKS_PROJECT_REAL_HOME__ != null && process.env.__ONEWORKS_PROJECT_REAL_HOME__.trim() !== '') {
    return
  }

  process.env.__ONEWORKS_PROJECT_REAL_HOME__ = app.getPath('home')
}

const getDesktopUpdateChannel = (value: Config['desktop'] | undefined) => (
  value != null && Object.prototype.hasOwnProperty.call(value, 'updateChannel')
    ? normalizeDesktopUpdateChannel(value.updateChannel)
    : undefined
)

const getDesktopAutoUpdate = (value: Config['desktop'] | undefined) => (
  value != null && Object.prototype.hasOwnProperty.call(value, 'autoUpdate')
    ? normalizeDesktopAutoUpdate(value.autoUpdate)
    : undefined
)

export interface ProjectDesktopUpdateSettings {
  autoUpdate?: boolean
  updateChannel?: DesktopUpdateChannel
}

const pickDefinedProjectDesktopUpdateSettings = (
  desktopConfig: Config['desktop'] | undefined
): ProjectDesktopUpdateSettings => {
  const autoUpdate = getDesktopAutoUpdate(desktopConfig)
  const updateChannel = getDesktopUpdateChannel(desktopConfig)
  return {
    ...(autoUpdate == null ? {} : { autoUpdate }),
    ...(updateChannel == null ? {} : { updateChannel })
  }
}

const normalizeLauncherShortcut = (value: unknown) => {
  if (typeof value === 'string') {
    const shortcut = value.trim()
    if (shortcut === '') return ''
    return toElectronAccelerator(shortcut) == null ? DEFAULT_LAUNCHER_SHORTCUT : shortcut
  }
  if (value == null) return DEFAULT_LAUNCHER_SHORTCUT
  return DEFAULT_LAUNCHER_SHORTCUT
}

const normalizeOpenLastWorkspaceOnStartup = (value: unknown) => (
  typeof value === 'boolean' ? value : false
)

const normalizeEnabledByDefault = (value: unknown) => (
  typeof value === 'boolean' ? value : true
)

const normalizeDesktopSettings = (value: unknown): DesktopSettingsState => {
  const source = isRecord(value) ? value : {}
  return {
    contextCapture: normalizeDesktopContextCaptureSettings(source.contextCapture),
    ...normalizeDesktopIconSettings(source),
    launcherShortcut: normalizeLauncherShortcut(source.launcherShortcut),
    autoUpdate: normalizeDesktopAutoUpdate(source.autoUpdate),
    openLastWorkspaceOnStartup: normalizeOpenLastWorkspaceOnStartup(source.openLastWorkspaceOnStartup),
    savedPasswordsAutoSignIn: normalizeEnabledByDefault(source.savedPasswordsAutoSignIn),
    savedPasswordsOfferToSave: normalizeEnabledByDefault(source.savedPasswordsOfferToSave),
    savedPasswordsRequireAuth: normalizeEnabledByDefault(source.savedPasswordsRequireAuth),
    updateChannel: normalizeDesktopUpdateChannel(source.updateChannel)
  }
}

const pickDefinedDesktopSettings = (
  value: Config['desktop'] | Partial<DesktopSettingsState> | undefined
): Partial<DesktopSettingsState> => {
  if (value == null) return {}

  return Object.fromEntries(
    desktopSettingsKeys
      .filter(key => value[key] !== undefined)
      .map(key => [key, value[key]])
  ) as Partial<DesktopSettingsState>
}

const normalizeThemeMode = (value: unknown) => (
  value === 'light' || value === 'dark' || value === 'system'
    ? value
    : undefined
)

const pickDefinedAppearanceSettings = (
  value: Config['appearance'] | Partial<NonNullable<Config['appearance']>> | undefined
): Partial<NonNullable<Config['appearance']>> => {
  if (value == null) return {}
  const primaryColor = normalizeThemePrimaryColor(value.primaryColor)
  const themeMode = normalizeThemeMode(value.themeMode)

  return {
    ...(primaryColor == null ? {} : { primaryColor }),
    ...(themeMode == null ? {} : { themeMode })
  }
}

const resolveGlobalDesktopConfigState = async () => {
  ensureRealHomeEnv()
  const cwd = process.cwd()
  const state = await loadConfigState({
    cwd,
    jsonVariables: buildConfigJsonVariables(cwd, process.env)
  })
  return {
    rawConfig: state.globalSource?.rawConfig?.desktop,
    resolvedConfig: state.globalSource?.resolvedConfig?.desktop
  }
}

const writeGlobalDesktopConfig = async (desktopConfig: Config['desktop']) => {
  ensureRealHomeEnv()
  await updateConfigFile({
    workspaceFolder: process.cwd(),
    source: 'global',
    section: 'desktop',
    value: desktopConfig ?? {}
  })
}

export const loadProjectDesktopUpdateChannel = async (
  workspaceFolder?: string
): Promise<DesktopUpdateChannel | undefined> => {
  return (await loadProjectDesktopUpdateSettings(workspaceFolder)).updateChannel
}

export const loadProjectDesktopUpdateSettings = async (
  workspaceFolder?: string
): Promise<ProjectDesktopUpdateSettings> => {
  if (workspaceFolder == null || workspaceFolder.trim() === '') return {}

  ensureRealHomeEnv()
  const cwd = workspaceFolder
  const state = await loadConfigState({
    cwd,
    jsonVariables: buildConfigJsonVariables(cwd, process.env)
  })
  return pickDefinedProjectDesktopUpdateSettings(state.projectSource?.resolvedConfig?.desktop)
}

export const saveProjectDesktopUpdateChannel = async (
  workspaceFolder: string | undefined,
  updateChannel: DesktopUpdateChannel
) => {
  await saveProjectDesktopUpdateSettingsPatch(workspaceFolder, { updateChannel })
}

export const saveProjectDesktopUpdateSettingsPatch = async (
  workspaceFolder: string | undefined,
  settings: ProjectDesktopUpdateSettings
) => {
  if (workspaceFolder == null || workspaceFolder.trim() === '') {
    throw new Error('A workspace is required to save desktop update settings.')
  }

  ensureRealHomeEnv()
  const cwd = workspaceFolder
  const state = await loadConfigState({
    cwd,
    jsonVariables: buildConfigJsonVariables(cwd, process.env)
  })
  await updateConfigFile({
    workspaceFolder,
    source: 'project',
    section: 'desktop',
    value: {
      ...pickDefinedProjectDesktopUpdateSettings(state.projectSource?.rawConfig?.desktop),
      ...settings
    }
  })
}

const resolveGlobalAppearanceConfigState = async () => {
  ensureRealHomeEnv()
  const cwd = process.cwd()
  const state = await loadConfigState({
    cwd,
    jsonVariables: buildConfigJsonVariables(cwd, process.env)
  })
  return {
    rawConfig: state.globalSource?.rawConfig?.appearance,
    resolvedConfig: state.globalSource?.resolvedConfig?.appearance
  }
}

const writeGlobalAppearanceConfig = async (appearanceConfig: Config['appearance']) => {
  ensureRealHomeEnv()
  await updateConfigFile({
    workspaceFolder: process.cwd(),
    source: 'global',
    section: 'appearance',
    value: appearanceConfig ?? {}
  })
}

export const loadGlobalAppearanceSettings = async () => {
  const { resolvedConfig } = await resolveGlobalAppearanceConfigState()
  return pickDefinedAppearanceSettings(resolvedConfig)
}

const resolveMigrationPatch = (
  resolvedGlobalConfig: Config['desktop'] | undefined,
  legacySettings: Partial<DesktopSettingsState>
) => {
  const globalSource = resolvedGlobalConfig ?? {}
  return Object.fromEntries(
    desktopSettingsKeys
      .filter(key => globalSource[key] === undefined && legacySettings[key] !== undefined)
      .map(key => [key, legacySettings[key]])
  ) as Partial<DesktopSettingsState>
}

export const loadGlobalDesktopSettings = async (
  legacySettings: Partial<DesktopSettingsState>
): Promise<DesktopSettingsState> => {
  return (await loadGlobalDesktopSettingsState(legacySettings)).settings
}

export const loadGlobalDesktopSettingsState = async (
  legacySettings: Partial<DesktopSettingsState>
): Promise<{
  legacyMigrationSucceeded: boolean
  settings: DesktopSettingsState
}> => {
  const { rawConfig, resolvedConfig } = await resolveGlobalDesktopConfigState()
  const migrationPatch = resolveMigrationPatch(resolvedConfig, legacySettings)
  const mergedConfig = {
    ...legacySettings,
    ...pickDefinedDesktopSettings(resolvedConfig)
  }
  let legacyMigrationSucceeded = true

  if (Object.keys(migrationPatch).length > 0) {
    try {
      await writeGlobalDesktopConfig({
        ...(rawConfig ?? {}),
        ...migrationPatch
      })
    } catch (error) {
      legacyMigrationSucceeded = false
      console.warn('[oneworks-desktop] failed to migrate desktop settings into global config', error)
    }
  }

  return {
    legacyMigrationSucceeded,
    settings: normalizeDesktopSettings(mergedConfig)
  }
}

export const saveGlobalDesktopSettingsPatch = async (settings: Partial<DesktopSettingsState>) => {
  const { rawConfig } = await resolveGlobalDesktopConfigState()
  await writeGlobalDesktopConfig({
    ...(rawConfig ?? {}),
    ...pickDefinedDesktopSettings(settings)
  })
}

export const saveGlobalDesktopSettings = async (settings: DesktopSettingsState) => {
  await saveGlobalDesktopSettingsPatch(settings)
}

export const saveGlobalAppearanceSettingsPatch = async (
  settings: Partial<NonNullable<Config['appearance']>>
) => {
  const { rawConfig } = await resolveGlobalAppearanceConfigState()
  await writeGlobalAppearanceConfig({
    ...(rawConfig ?? {}),
    ...pickDefinedAppearanceSettings(settings)
  })
}
