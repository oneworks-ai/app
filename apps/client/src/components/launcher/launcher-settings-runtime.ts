import type { OneWorksDeviceShellApi, OneWorksDeviceShellKind } from '@oneworks/types'

import { isPwaUpdaterAvailable } from '#~/pwa'
import { isDesktopClientMode } from '#~/runtime-config'

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

export type LauncherSettingId = (typeof launcherSettingIds)[number]
export type LauncherSettingsRuntimeKind = 'android' | 'electron' | 'partial' | 'pwa' | 'web'
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
  hasDesktopBridge: boolean
  hasDeviceShellBridge: boolean
  isDesktopClient: boolean
  isInstalledPwa: boolean
}

export interface LauncherSettingsRuntimePolicy {
  isElectron: boolean
  runtime: LauncherSettingsRuntimeKind
  updaterAvailable: boolean
}

export interface LauncherSettingsRuntimePolicyInput extends LauncherSettingsRuntimeInput {
  hasServiceWorker: boolean
  isProduction: boolean
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

const resolveKnownShellKind = (
  shellKind: OneWorksDeviceShellKind,
  isInstalledPwa: boolean
): LauncherSettingsRuntimeKind => {
  if (shellKind === 'web') return isInstalledPwa ? 'pwa' : 'web'
  return shellKind
}

export const resolveLauncherSettingsRuntime = (
  input: LauncherSettingsRuntimeInput
): LauncherSettingsRuntimeKind => {
  const authoritativeDeviceShellKind = normalizeDeviceShellKind(input.deviceShellKind)
  if (authoritativeDeviceShellKind != null) {
    return resolveKnownShellKind(authoritativeDeviceShellKind, input.isInstalledPwa)
  }

  const desktopShellKind = normalizeDeviceShellKind(input.desktopShellKind)
  if (desktopShellKind != null) {
    return resolveKnownShellKind(desktopShellKind, input.isInstalledPwa)
  }

  if (input.isDesktopClient || electronPlatforms.has(input.desktopPlatform ?? '')) {
    return 'electron'
  }
  if (input.hasDeviceShellBridge || input.hasDesktopBridge) return 'partial'
  return input.isInstalledPwa ? 'pwa' : 'web'
}

export const resolveLauncherSettingsRuntimePolicy = (
  input: LauncherSettingsRuntimePolicyInput
): LauncherSettingsRuntimePolicy => {
  const runtime = resolveLauncherSettingsRuntime(input)
  return {
    isElectron: runtime === 'electron',
    runtime,
    updaterAvailable: (runtime === 'pwa' || runtime === 'web') && isPwaUpdaterAvailable({
      hasServiceWorker: input.hasServiceWorker,
      isDesktop: input.isDesktopClient,
      isProd: input.isProduction
    })
  }
}

export const readLauncherSettingsRuntimePolicy = (): LauncherSettingsRuntimePolicy => {
  const desktopApi = globalThis.window?.oneworksDesktop
  const deviceShellApi = globalThis.window?.oneworksDeviceShell
  const desktopShellKind = normalizeDeviceShellKind(desktopApi?.shellKind)
  const deviceShellKind = normalizeDeviceShellKind(deviceShellApi?.shellKind)
  const hasExternalDesktopSignal = desktopApi == null ||
    desktopApi.platform != null ||
    desktopShellKind === 'electron' ||
    deviceShellKind === 'electron'
  const isInstalledPwa = globalThis.window
    ?.matchMedia?.('(display-mode: standalone)')
    .matches === true
  return resolveLauncherSettingsRuntimePolicy({
    desktopPlatform: desktopApi?.platform,
    desktopShellKind,
    deviceShellKind,
    hasDesktopBridge: desktopApi != null,
    hasDeviceShellBridge: deviceShellApi != null,
    hasServiceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    isDesktopClient: isDesktopClientMode() && hasExternalDesktopSignal,
    isInstalledPwa,
    isProduction: import.meta.env.PROD
  })
}

export const canUseLauncherApiConfig = (policy: LauncherSettingsRuntimePolicy) => !policy.isElectron

export const isLauncherSettingAvailable = (
  policy: LauncherSettingsRuntimePolicy,
  settingId: LauncherSettingId
) => {
  if (settingId === 'update-experience') {
    return policy.updaterAvailable
  }
  if (electronOnlyLauncherSettingIdSet.has(settingId)) {
    return policy.runtime === 'electron'
  }
  return true
}

export const getAvailableLauncherSettingIds = (
  policy: LauncherSettingsRuntimePolicy
): LauncherSettingId[] => (
  launcherSettingIds.filter(settingId => isLauncherSettingAvailable(policy, settingId))
)

export const getLauncherUpdateExperienceTranslationKeys = (
  runtime: LauncherSettingsRuntimeKind
): LauncherUpdateExperienceTranslationKeys | undefined => {
  if (runtime !== 'pwa' && runtime !== 'web') return undefined
  return updateExperienceTranslationKeys[runtime]
}
