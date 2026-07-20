import { ConfigProvider } from 'antd'
import { useAtomValue, useSetAtom } from 'jotai'
import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useState } from 'react'
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
  getThemePackForDesktopSettings,
  getThemePackSettingsForDesktopSettings,
  persistThemePrimaryColor
} from '#~/hooks/use-app-preferences'
import { useDesktopThemeSourceBridge, useResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'
import { NotificationProvider } from '#~/notifications/NotificationProvider'
import { PluginProvider } from '#~/plugins/PluginProvider'
import { usePluginContext } from '#~/plugins/plugin-context'
import { PluginThemeStyles, usePluginThemes } from '#~/plugins/plugin-themes'
import {
  THEME_PACK_SETTINGS_STORAGE_KEY,
  THEME_PACK_STORAGE_KEY,
  getStoredThemePackSettings,
  normalizeThemePack,
  themeAtom,
  themePackAtom,
  themePackSettingsAtom
} from '#~/store'
import { getGlobalAppearanceThemePack, getGlobalThemePackSettingsMap } from '#~/utils/appearance-config'
import {
  applyThemePackToDocument,
  buildThemePackConfig,
  getThemePack,
  normalizeThemePackSettings,
  resolveThemePackPrimaryColor
} from '#~/utils/theme-pack'

const LauncherRoute = lazy(async () => ({
  default: (await import('#~/routes/LauncherRoute')).LauncherRoute
}))

function useLauncherThemeConfig() {
  const themes = usePluginThemes()
  const setThemeMode = useSetAtom(themeAtom)
  const setThemePack = useSetAtom(themePackAtom)
  const setThemePackSettings = useSetAtom(themePackSettingsAtom)
  const themePack = useAtomValue(themePackAtom)
  const themePackSettings = useAtomValue(themePackSettingsAtom)
  const { isDarkMode, themeMode } = useResolvedThemeMode()
  const desktopApi = window.oneworksDesktop
  const canUseDesktopSettings = desktopApi?.getDesktopSettings != null
  const canUseApiConfig = !canUseDesktopSettings && desktopApi == null
  const [storedPrimaryColor, setStoredPrimaryColor] = useState(() => getStoredThemePrimaryColor())
  const [desktopSettings, setDesktopSettings] = useState<unknown>()
  const { data: configRes } = useSWR<ConfigResponse>(canUseApiConfig ? '/api/config' : null, getConfig)
  const configuredPrimaryColor = normalizeThemePrimaryColor(
    getPrimaryColorForDesktopSettings(desktopSettings) ?? getGlobalThemePrimaryColor(configRes)
  ) ?? storedPrimaryColor ?? DEFAULT_THEME_PRIMARY_COLOR
  const configuredThemeMode = getThemeModeForDesktopSettings(desktopSettings) ?? getGlobalThemeMode(configRes)
  const configuredThemePack = getThemePackForDesktopSettings(desktopSettings) ?? getGlobalAppearanceThemePack(configRes)
  const configuredThemePackSettings = useMemo(
    () => getThemePackSettingsForDesktopSettings(desktopSettings) ?? getGlobalThemePackSettingsMap(configRes),
    [configRes, desktopSettings]
  )
  const activeTheme = getThemePack(themePack, themes)
  const settings = useMemo(
    () => normalizeThemePackSettings(activeTheme, themePackSettings[themePack]),
    [activeTheme, themePack, themePackSettings]
  )
  const primaryColor = resolveThemePackPrimaryColor(themePack, configuredPrimaryColor, themes)

  useDesktopThemeSourceBridge(themeMode)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode)
  }, [isDarkMode])
  useEffect(() => {
    if (configuredThemeMode != null) setThemeMode(configuredThemeMode)
  }, [configuredThemeMode, setThemeMode])
  useEffect(() => {
    if (configuredThemePack != null) setThemePack(configuredThemePack)
  }, [configuredThemePack, setThemePack])
  useEffect(() => {
    if (configuredThemePackSettings != null) setThemePackSettings(configuredThemePackSettings)
  }, [configuredThemePackSettings, setThemePackSettings])
  useEffect(() => applyThemePrimaryColorVariables(primaryColor), [primaryColor])
  useEffect(() => persistThemePrimaryColor(configuredPrimaryColor), [configuredPrimaryColor])
  useLayoutEffect(
    () => applyThemePackToDocument(themePack, activeTheme, settings),
    [activeTheme, settings, themePack]
  )

  useEffect(() => {
    if (!canUseDesktopSettings) {
      setDesktopSettings(undefined)
      return
    }
    let disposed = false
    void desktopApi?.getDesktopSettings?.()
      .then(settings => !disposed && setDesktopSettings(settings))
      .catch(error => !disposed && console.error('[launcher] failed to load desktop theme settings', error))
    const dispose = desktopApi?.onDesktopSettingsChange?.(setDesktopSettings)
    return () => {
      disposed = true
      dispose?.()
    }
  }, [canUseDesktopSettings, desktopApi])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === THEME_PRIMARY_COLOR_STORAGE_KEY) {
        setStoredPrimaryColor(normalizeThemePrimaryColor(event.newValue) ?? DEFAULT_THEME_PRIMARY_COLOR)
      } else if (event.key === THEME_PACK_STORAGE_KEY) {
        setThemePack(normalizeThemePack(event.newValue))
      } else if (event.key === THEME_PACK_SETTINGS_STORAGE_KEY) {
        setThemePackSettings(getStoredThemePackSettings())
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [setThemePack, setThemePackSettings])

  return useMemo(() =>
    buildThemePackConfig({
      isDarkMode,
      primaryColor,
      settings,
      theme: activeTheme
    }), [activeTheme, isDarkMode, primaryColor, settings])
}

function ThemedLauncherApp() {
  const { ready } = usePluginContext()
  const themeConfig = useLauncherThemeConfig()
  if (!ready) return null
  return (
    <ConfigProvider theme={themeConfig}>
      <PluginThemeStyles />
      <Suspense fallback={null}>
        <LauncherRoute />
      </Suspense>
    </ConfigProvider>
  )
}

export function LauncherApp() {
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
    <NotificationProvider>
      <PluginProvider runtimeSource='manager' surface='launcher'>
        <ThemedLauncherApp />
      </PluginProvider>
    </NotificationProvider>
  )
}
