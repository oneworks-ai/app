import type { OneWorksDeviceShellApi, OneWorksDeviceShellKind } from '@oneworks/types'

import { isDesktopClientMode, isStandaloneClientMode } from '#~/runtime-config'

export const launcherSettingIds = [
  'language',
  'shortcut',
  'open-last-workspace-on-startup',
  'auto-update',
  'update-channel',
  'launch-at-login',
  'status-pin',
  'update-experience',
  'hide-after-action',
  'current-project',
  'resource-search',
  'footer-hints',
  'text-size',
  'theme',
  'window-mode',
  'favorites',
  'app-icon'
] as const

export type LauncherSettingId = typeof launcherSettingIds[number]
export type LauncherSettingsRuntimeKind = 'android' | 'electron' | 'pwa' | 'web'
export type LauncherWebSettingsRuntimeKind = Extract<LauncherSettingsRuntimeKind, 'pwa' | 'web'>

export const electronOnlyLauncherSettingIds = [
  'auto-update',
  'launch-at-login',
  'open-last-workspace-on-startup',
  'shortcut',
  'status-pin',
  'update-channel'
] as const satisfies readonly LauncherSettingId[]

type LauncherUpdateExperienceTranslationKey<
  Field extends 'description' | 'status' | 'title',
  Runtime extends LauncherWebSettingsRuntimeKind,
> = `launcher.settings.items.updateExperience.${Field}.${Runtime}`

export type LauncherUpdateExperienceTranslationKeys<
  Runtime extends LauncherWebSettingsRuntimeKind = LauncherWebSettingsRuntimeKind,
> = Runtime extends LauncherWebSettingsRuntimeKind ? {
    descriptionKey: LauncherUpdateExperienceTranslationKey<'description', Runtime>
    runtime: Runtime
    statusKey: LauncherUpdateExperienceTranslationKey<'status', Runtime>
    titleKey: LauncherUpdateExperienceTranslationKey<'title', Runtime>
  }
  : never

export interface LauncherSettingsRuntimeInput {
  desktopPlatform?: string
  desktopShellKind?: OneWorksDeviceShellApi['shellKind']
  deviceShellKind?: OneWorksDeviceShellApi['shellKind']
  isDesktopClient: boolean
  isStandaloneClient: boolean
}

const electronOnlyLauncherSettingIdSet = new Set<LauncherSettingId>(electronOnlyLauncherSettingIds)
const electronPlatforms = new Set(['darwin', 'linux', 'win32'])

const updateExperienceTranslationKeys = {
  pwa: {
    descriptionKey: 'launcher.settings.items.updateExperience.description.pwa',
    runtime: 'pwa',
    statusKey: 'launcher.settings.items.updateExperience.status.pwa',
    titleKey: 'launcher.settings.items.updateExperience.title.pwa'
  },
  web: {
    descriptionKey: 'launcher.settings.items.updateExperience.description.web',
    runtime: 'web',
    statusKey: 'launcher.settings.items.updateExperience.status.web',
    titleKey: 'launcher.settings.items.updateExperience.title.web'
  }
} as const satisfies {
  [Runtime in LauncherWebSettingsRuntimeKind]: LauncherUpdateExperienceTranslationKeys<Runtime>
}

const normalizeDeviceShellKind = (
  value: OneWorksDeviceShellApi['shellKind']
): OneWorksDeviceShellKind | undefined => {
  if (value === 'android' || value === 'electron' || value === 'web') return value
  return undefined
}

export const resolveLauncherSettingsRuntime = (
  input: LauncherSettingsRuntimeInput
): LauncherSettingsRuntimeKind => {
  const shellKind = normalizeDeviceShellKind(input.deviceShellKind) ??
    normalizeDeviceShellKind(input.desktopShellKind)

  if (shellKind === 'android') return 'android'
  if (shellKind === 'electron') return 'electron'
  if (shellKind === 'web') return input.isStandaloneClient ? 'pwa' : 'web'

  if (input.isDesktopClient || electronPlatforms.has(input.desktopPlatform ?? '')) {
    return 'electron'
  }
  return input.isStandaloneClient ? 'pwa' : 'web'
}

export const readLauncherSettingsRuntime = (): LauncherSettingsRuntimeKind => {
  const desktopApi = globalThis.window?.oneworksDesktop
  return resolveLauncherSettingsRuntime({
    desktopPlatform: desktopApi?.platform,
    desktopShellKind: desktopApi?.shellKind,
    deviceShellKind: globalThis.window?.oneworksDeviceShell?.shellKind,
    isDesktopClient: isDesktopClientMode(),
    isStandaloneClient: isStandaloneClientMode()
  })
}

export const isLauncherSettingAvailable = (
  runtime: LauncherSettingsRuntimeKind,
  settingId: LauncherSettingId
) => {
  if (settingId === 'update-experience') {
    return runtime === 'pwa' || runtime === 'web'
  }
  if (electronOnlyLauncherSettingIdSet.has(settingId)) {
    return runtime === 'electron'
  }
  return true
}

export const getAvailableLauncherSettingIds = (
  runtime: LauncherSettingsRuntimeKind
): LauncherSettingId[] => (
  launcherSettingIds.filter(settingId => isLauncherSettingAvailable(runtime, settingId))
)

export const getLauncherUpdateExperienceTranslationKeys = (
  runtime: LauncherSettingsRuntimeKind
): LauncherUpdateExperienceTranslationKeys | undefined => {
  if (runtime !== 'pwa' && runtime !== 'web') return undefined
  return updateExperienceTranslationKeys[runtime]
}
