import { ConfigProvider } from 'antd'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { DEFAULT_THEME_PRIMARY_COLOR, normalizeThemePrimaryColor } from '@oneworks/icon/presets'

import {
  THEME_PRIMARY_COLOR_STORAGE_KEY,
  applyThemePrimaryColorVariables,
  getPrimaryColorForDesktopSettings,
  getStoredThemePrimaryColor,
  getThemeModeForDesktopSettings,
  getThemePackForDesktopSettings,
  getThemePackSettingsForDesktopSettings,
  persistThemePrimaryColor
} from '#~/hooks/use-app-preferences'
import { useDesktopThemeSourceBridge, useResolvedThemeMode } from '#~/hooks/use-resolved-theme-mode'
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
import {
  applyThemePackToDocument,
  buildThemePackConfig,
  getThemePack,
  normalizeThemePackSettings,
  resolveThemePackPrimaryColor
} from '#~/utils/theme-pack'

const getInitialPrimaryColor = () => getStoredThemePrimaryColor() ?? DEFAULT_THEME_PRIMARY_COLOR

function ThemedStandaloneRoute({ children }: { children: ReactNode }) {
  const { ready } = usePluginContext()
  const themes = usePluginThemes()
  const setThemeMode = useSetAtom(themeAtom)
  const setThemePack = useSetAtom(themePackAtom)
  const setThemePackSettings = useSetAtom(themePackSettingsAtom)
  const themePack = useAtomValue(themePackAtom)
  const themePackSettings = useAtomValue(themePackSettingsAtom)
  const { isDarkMode, themeMode } = useResolvedThemeMode()
  const desktopApi = window.oneworksDesktop
  const canUseDesktopSettings = desktopApi?.getDesktopSettings != null
  const [storedPrimaryColor, setStoredPrimaryColor] = useState(getInitialPrimaryColor)
  const [desktopSettings, setDesktopSettings] = useState<unknown>()
  const configuredPrimaryColor = normalizeThemePrimaryColor(
    getPrimaryColorForDesktopSettings(desktopSettings)
  ) ?? storedPrimaryColor
  const configuredThemeMode = getThemeModeForDesktopSettings(desktopSettings)
  const configuredThemePack = getThemePackForDesktopSettings(desktopSettings)
  const configuredThemePackSettings = useMemo(
    () => getThemePackSettingsForDesktopSettings(desktopSettings),
    [desktopSettings]
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
      .catch(error => !disposed && console.error('[standalone-route] failed to load desktop theme settings', error))
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

  const themeConfig = useMemo(() =>
    buildThemePackConfig({
      isDarkMode,
      primaryColor,
      settings,
      theme: activeTheme
    }), [activeTheme, isDarkMode, primaryColor, settings])

  if (!ready) return null
  return (
    <ConfigProvider theme={themeConfig}>
      <PluginThemeStyles />
      {children}
    </ConfigProvider>
  )
}

export function StandaloneRouteThemeProvider({ children }: { children: ReactNode }) {
  return (
    <PluginProvider runtimeSource='manager'>
      <ThemedStandaloneRoute>{children}</ThemedStandaloneRoute>
    </PluginProvider>
  )
}
