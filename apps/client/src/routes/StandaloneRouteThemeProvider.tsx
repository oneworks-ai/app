import { ConfigProvider, theme } from 'antd'
import { useSetAtom } from 'jotai'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { DEFAULT_THEME_PRIMARY_COLOR, normalizeThemePrimaryColor } from '@oneworks/icon/presets'

import {
  THEME_PRIMARY_COLOR_STORAGE_KEY,
  applyThemePrimaryColorVariables,
  getPrimaryColorForDesktopSettings,
  getStoredThemePrimaryColor,
  getThemeModeForDesktopSettings,
  persistThemePrimaryColor
} from '#~/hooks/use-app-preferences'
import { useDesktopThemeSourceBridge, useResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'
import { themeAtom } from '#~/store'

const getInitialPrimaryColor = () => getStoredThemePrimaryColor() ?? DEFAULT_THEME_PRIMARY_COLOR

function useStandaloneThemeConfig() {
  const setThemeMode = useSetAtom(themeAtom)
  const { isDarkMode, themeMode } = useResolvedThemeMode()
  const desktopApi = window.oneworksDesktop
  const canUseDesktopSettings = desktopApi?.getDesktopSettings != null
  const [storedPrimaryColor, setStoredPrimaryColor] = useState(getInitialPrimaryColor)
  const [desktopSettings, setDesktopSettings] = useState<unknown>()
  const primaryColor = normalizeThemePrimaryColor(
    getPrimaryColorForDesktopSettings(desktopSettings)
  ) ?? storedPrimaryColor
  const configuredThemeMode = getThemeModeForDesktopSettings(desktopSettings)

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
          console.error('[standalone-route] failed to load desktop theme settings', error)
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

export function StandaloneRouteThemeProvider({ children }: { children: ReactNode }) {
  const themeConfig = useStandaloneThemeConfig()

  return (
    <ConfigProvider theme={themeConfig}>
      {children}
    </ConfigProvider>
  )
}
