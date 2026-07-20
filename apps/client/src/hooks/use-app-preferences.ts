import type { ThemeConfig } from 'antd'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { DEFAULT_THEME_PRIMARY_COLOR, normalizeThemePrimaryColor } from '@oneworks/icon/presets'
import type { AppearanceThemePackConfigMap, ConfigResponse } from '@oneworks/types'

import { getConfig } from '#~/api'
import { changeAppLanguage } from '#~/i18n'
import type { PluginThemeRuntimeRegistration, PluginThemeSettingsValue } from '#~/plugins/plugin-theme-contract'
import { usePluginThemes } from '#~/plugins/plugin-themes'
import {
  THEME_PACK_SETTINGS_STORAGE_KEY,
  THEME_PACK_STORAGE_KEY,
  getStoredThemePackSettings,
  normalizeThemeMode,
  normalizeThemePack,
  themeAtom,
  themePackAtom,
  themePackSettingsAtom
} from '#~/store'
import type { ThemeMode, ThemePack } from '#~/store'
import { getGlobalAppearanceThemePack, getGlobalThemePackSettingsMap } from '#~/utils/appearance-config'
import {
  applyThemePackToDocument,
  buildThemePackConfig,
  getThemePack,
  normalizeThemePackSettings,
  resolveThemePackPrimaryColor
} from '#~/utils/theme-pack'

import { useDesktopThemeSourceBridge, useResolvedThemeMode } from './use-resolved-theme-mode'

export const THEME_PRIMARY_COLOR_STORAGE_KEY = 'oneworks_theme_primary_color'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value != null && typeof value === 'object' && !Array.isArray(value)
)

export const getGlobalThemePrimaryColor = (configRes: ConfigResponse | undefined) =>
  normalizeThemePrimaryColor(
    configRes?.resolvedSources?.global?.appearance?.primaryColor ??
      configRes?.sources?.global?.appearance?.primaryColor
  )

export const getGlobalThemeMode = (configRes: ConfigResponse | undefined): ThemeMode | undefined => {
  const value = configRes?.resolvedSources?.global?.appearance?.themeMode ??
    configRes?.sources?.global?.appearance?.themeMode
  return value == null ? undefined : normalizeThemeMode(value)
}

export const getPrimaryColorForDesktopSettings = (settings: unknown) => {
  if (!isRecord(settings) || typeof settings.primaryColor !== 'string') return undefined
  return normalizeThemePrimaryColor(settings.primaryColor)
}

export const getThemeModeForDesktopSettings = (settings: unknown): ThemeMode | undefined => {
  if (!isRecord(settings)) return undefined
  return settings.themeMode == null ? undefined : normalizeThemeMode(settings.themeMode)
}

export const getThemePackForDesktopSettings = (settings: unknown): ThemePack | undefined => {
  if (!isRecord(settings)) return undefined
  return normalizeThemePack(settings.themePack)
}

export const getThemePackSettingsForDesktopSettings = (
  settings: unknown
): AppearanceThemePackConfigMap | undefined => {
  if (!isRecord(settings)) return undefined
  const themePacks = isRecord(settings.themePacks) ? settings.themePacks : {}
  return Object.fromEntries(
    Object.entries(themePacks).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
  )
}

interface AppPreferences {
  activeTheme?: PluginThemeRuntimeRegistration
  isDarkMode: boolean
  themeConfig: ThemeConfig
  themePack: ThemePack
  themeSettings: PluginThemeSettingsValue
}

export const getStoredThemePrimaryColor = () => {
  try {
    return normalizeThemePrimaryColor(localStorage.getItem(THEME_PRIMARY_COLOR_STORAGE_KEY))
  } catch {
    return undefined
  }
}

export const persistThemePrimaryColor = (primaryColor: string) => {
  try {
    localStorage.setItem(THEME_PRIMARY_COLOR_STORAGE_KEY, primaryColor)
  } catch {}
}

export const applyThemePrimaryColorVariables = (primaryColor: string) => {
  const rootStyle = document.documentElement.style
  rootStyle.setProperty('--primary-color', primaryColor)
  rootStyle.setProperty('--primary-soft-bg', `color-mix(in srgb, ${primaryColor} 12%, var(--bg-color))`)
  rootStyle.setProperty('--primary-text-color', `color-mix(in srgb, ${primaryColor} 82%, var(--text-color))`)
}

export function useAppPreferences(): AppPreferences {
  const { i18n } = useTranslation()
  const themes = usePluginThemes()
  const setThemeMode = useSetAtom(themeAtom)
  const setThemePack = useSetAtom(themePackAtom)
  const setThemePackSettings = useSetAtom(themePackSettingsAtom)
  const { isDarkMode, themeMode } = useResolvedThemeMode()
  const themePack = useAtomValue(themePackAtom)
  const themePackSettings = useAtomValue(themePackSettingsAtom)
  const [storedPrimaryColor, setStoredPrimaryColor] = useState(() => getStoredThemePrimaryColor())
  const { data: configRes } = useSWR<ConfigResponse>('/api/config', getConfig)
  const interfaceLanguage = configRes?.sources?.merged?.general?.interfaceLanguage
  const globalThemeMode = getGlobalThemeMode(configRes)
  const globalThemePack = getGlobalAppearanceThemePack(configRes)
  const globalThemePackSettings = useMemo(() => getGlobalThemePackSettingsMap(configRes), [configRes])
  const configuredPrimaryColor = getGlobalThemePrimaryColor(configRes) ??
    storedPrimaryColor ??
    DEFAULT_THEME_PRIMARY_COLOR
  const activeTheme = getThemePack(themePack, themes)
  const themeSettings = useMemo(
    () => normalizeThemePackSettings(activeTheme, themePackSettings[themePack]),
    [activeTheme, themePack, themePackSettings]
  )
  const primaryColor = resolveThemePackPrimaryColor(themePack, configuredPrimaryColor, themes)
  useDesktopThemeSourceBridge(themeMode)

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === THEME_PRIMARY_COLOR_STORAGE_KEY) {
        setStoredPrimaryColor(normalizeThemePrimaryColor(event.newValue))
      } else if (event.key === THEME_PACK_STORAGE_KEY) {
        setThemePack(normalizeThemePack(event.newValue))
      } else if (event.key === THEME_PACK_SETTINGS_STORAGE_KEY) {
        setThemePackSettings(getStoredThemePackSettings())
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [setThemePack, setThemePackSettings])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode)
  }, [isDarkMode])
  useEffect(() => {
    if (globalThemeMode != null) setThemeMode(globalThemeMode)
  }, [globalThemeMode, setThemeMode])
  useEffect(() => {
    if (globalThemePack != null) setThemePack(globalThemePack)
  }, [globalThemePack, setThemePack])
  useEffect(() => {
    if (globalThemePackSettings != null) setThemePackSettings(globalThemePackSettings)
  }, [globalThemePackSettings, setThemePackSettings])
  useEffect(() => applyThemePrimaryColorVariables(primaryColor), [primaryColor])
  useEffect(() => persistThemePrimaryColor(configuredPrimaryColor), [configuredPrimaryColor])
  useLayoutEffect(
    () => applyThemePackToDocument(themePack, activeTheme, themeSettings),
    [activeTheme, themePack, themeSettings]
  )
  useEffect(() => {
    if (interfaceLanguage && i18n.language !== interfaceLanguage) {
      void changeAppLanguage(interfaceLanguage)
    }
  }, [i18n, interfaceLanguage])

  const themeConfig = useMemo(() =>
    buildThemePackConfig({
      isDarkMode,
      primaryColor,
      settings: themeSettings,
      theme: activeTheme
    }), [activeTheme, isDarkMode, primaryColor, themeSettings])

  return { activeTheme, isDarkMode, themeConfig, themePack, themeSettings }
}
