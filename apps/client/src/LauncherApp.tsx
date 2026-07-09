import { ConfigProvider, theme } from 'antd'
import { useSetAtom } from 'jotai'
import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'

import { DEFAULT_THEME_PRIMARY_COLOR, normalizeThemePrimaryColor } from '@oneworks/icon/presets'
import type { ConfigResponse } from '@oneworks/types'

import { getConfig } from '#~/api'
import {
  THEME_PRIMARY_COLOR_STORAGE_KEY,
  applyThemePrimaryColorVariables,
  getGlobalThemeMode,
  getGlobalThemePrimaryColor,
  getPrimaryColorForDesktopSettings,
  getStoredThemePrimaryColor,
  getThemeModeForDesktopSettings,
  persistThemePrimaryColor
} from '#~/hooks/use-app-preferences'
import { useDesktopThemeSourceBridge, useResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'
import { NotificationProvider } from '#~/notifications/NotificationProvider'
import { PluginProvider } from '#~/plugins/PluginProvider'
import { themeAtom } from '#~/store'

const LauncherRoute = lazy(async () => ({
  default: (await import('#~/routes/LauncherRoute')).LauncherRoute
}))

function useLauncherThemeConfig() {
  const setThemeMode = useSetAtom(themeAtom)
  const { isDarkMode, themeMode } = useResolvedThemeMode()
  const desktopApi = window.oneworksDesktop
  const canUseDesktopSettings = desktopApi?.getDesktopSettings != null
  const canUseApiConfig = !canUseDesktopSettings && desktopApi == null
  const [storedPrimaryColor, setStoredPrimaryColor] = useState(() => getStoredThemePrimaryColor())
  const [desktopSettings, setDesktopSettings] = useState<unknown>()
  const { data: configRes } = useSWR<ConfigResponse>(canUseApiConfig ? '/api/config' : null, getConfig)
  const primaryColor = normalizeThemePrimaryColor(
    getPrimaryColorForDesktopSettings(desktopSettings) ??
      getGlobalThemePrimaryColor(configRes)
  ) ?? storedPrimaryColor ?? DEFAULT_THEME_PRIMARY_COLOR
  const configuredThemeMode = getThemeModeForDesktopSettings(desktopSettings) ?? getGlobalThemeMode(configRes)

  useDesktopThemeSourceBridge(themeMode)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode)
  }, [isDarkMode])

  useEffect(() => {
    if (configuredThemeMode != null) {
      setThemeMode(configuredThemeMode)
    }
  }, [configuredThemeMode, setThemeMode])

  useEffect(() => {
    applyThemePrimaryColorVariables(primaryColor)
    persistThemePrimaryColor(primaryColor)
  }, [primaryColor])

  useEffect(() => {
    if (!canUseDesktopSettings) {
      setDesktopSettings(undefined)
      return
    }

    let disposed = false
    void desktopApi?.getDesktopSettings?.()
      .then((settings) => {
        if (!disposed) {
          setDesktopSettings(settings)
        }
      })
      .catch((error) => {
        if (!disposed) {
          console.error('[launcher] failed to load desktop theme settings', error)
        }
      })

    const dispose = desktopApi?.onDesktopSettingsChange?.((settings) => {
      setDesktopSettings(settings)
    })

    return () => {
      disposed = true
      dispose?.()
    }
  }, [canUseDesktopSettings, desktopApi])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_PRIMARY_COLOR_STORAGE_KEY) return
      const nextPrimaryColor = normalizeThemePrimaryColor(event.newValue) ?? DEFAULT_THEME_PRIMARY_COLOR
      setStoredPrimaryColor(nextPrimaryColor)
      applyThemePrimaryColorVariables(nextPrimaryColor)
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  return useMemo(() => ({
    algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: primaryColor
    }
  }), [isDarkMode, primaryColor])
}

export function LauncherApp() {
  const themeConfig = useLauncherThemeConfig()
  const isWebLauncher = window.oneworksDesktop == null

  useEffect(() => {
    document.documentElement.classList.add('oneworks-launcher-window')
    document.documentElement.classList.toggle('oneworks-launcher-web', isWebLauncher)
    return () => {
      document.documentElement.classList.remove('oneworks-launcher-window')
      document.documentElement.classList.remove('oneworks-launcher-web')
    }
  }, [isWebLauncher])

  return (
    <ConfigProvider theme={themeConfig}>
      <NotificationProvider>
        <PluginProvider runtimeSource='manager' surface='launcher'>
          <Suspense fallback={null}>
            <LauncherRoute />
          </Suspense>
        </PluginProvider>
      </NotificationProvider>
    </ConfigProvider>
  )
}
