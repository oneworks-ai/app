import { theme } from 'antd'
import { useSetAtom } from 'jotai'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { DEFAULT_THEME_PRIMARY_COLOR, normalizeThemePrimaryColor } from '@oneworks/icon/presets'
import type { ConfigResponse } from '@oneworks/types'

import { getConfig } from '#~/api'
import { changeAppLanguage } from '#~/i18n'
import { normalizeThemeMode, themeAtom } from '#~/store'
import type { ThemeMode } from '#~/store'

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

interface AppPreferences {
  isDarkMode: boolean
  themeConfig: {
    algorithm: typeof theme.darkAlgorithm | typeof theme.defaultAlgorithm
    token: {
      colorPrimary: string
    }
  }
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
  const setThemeMode = useSetAtom(themeAtom)
  const { isDarkMode, themeMode } = useResolvedThemeMode()
  const [storedPrimaryColor, setStoredPrimaryColor] = useState(() => getStoredThemePrimaryColor())
  const { data: configRes } = useSWR<ConfigResponse>('/api/config', getConfig)
  const interfaceLanguage = configRes?.sources?.merged?.general?.interfaceLanguage
  const globalThemeMode = getGlobalThemeMode(configRes)
  const primaryColor = getGlobalThemePrimaryColor(configRes) ?? storedPrimaryColor ?? DEFAULT_THEME_PRIMARY_COLOR

  useDesktopThemeSourceBridge(themeMode)

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_PRIMARY_COLOR_STORAGE_KEY) return
      setStoredPrimaryColor(normalizeThemePrimaryColor(event.newValue))
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode)
  }, [isDarkMode])

  useEffect(() => {
    if (globalThemeMode != null) {
      setThemeMode(globalThemeMode)
    }
  }, [globalThemeMode, setThemeMode])

  useEffect(() => {
    applyThemePrimaryColorVariables(primaryColor)
    persistThemePrimaryColor(primaryColor)
  }, [primaryColor])

  useEffect(() => {
    if (interfaceLanguage && i18n.language !== interfaceLanguage) {
      void changeAppLanguage(interfaceLanguage)
    }
  }, [i18n, interfaceLanguage])

  const themeConfig = useMemo(() => ({
    algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: primaryColor
    }
  }), [isDarkMode, primaryColor])

  return {
    isDarkMode,
    themeConfig
  }
}
