import { theme as antdTheme } from 'antd'
import type { ThemeConfig } from 'antd'

import type { PluginThemeRuntimeRegistration, PluginThemeSettingsValue } from '#~/plugins/plugin-theme-contract'

export const getThemePack = (
  themePack: string,
  themes: PluginThemeRuntimeRegistration[]
) => themes.find(theme => theme.id === themePack)

export const getThemePackPrimaryColor = (
  themePack: string,
  themes: PluginThemeRuntimeRegistration[]
) => getThemePack(themePack, themes)?.primaryColor

export const resolveThemePackPrimaryColor = (
  themePack: string,
  configuredPrimaryColor: string,
  themes: PluginThemeRuntimeRegistration[]
) => getThemePackPrimaryColor(themePack, themes) ?? configuredPrimaryColor

export const normalizeThemePackSettings = (
  theme: PluginThemeRuntimeRegistration | undefined,
  value: unknown
): PluginThemeSettingsValue => {
  if (theme == null) return {}
  try {
    const settings = theme.normalizeSettings(value)
    return settings != null && typeof settings === 'object' && !Array.isArray(settings)
      ? settings
      : {}
  } catch {
    return {}
  }
}

const getPathValue = (value: unknown, path: string): unknown => (
  path.split('.').reduce<unknown>((current, key) => (
    current != null && typeof current === 'object' && !Array.isArray(current)
      ? (current as Record<string, unknown>)[key]
      : undefined
  ), value)
)

export const shouldShowThemeBanner = (
  theme: PluginThemeRuntimeRegistration | undefined,
  settings: PluginThemeSettingsValue
) =>
  theme?.banner != null && (
    theme.banner.visiblePath == null || getPathValue(settings, theme.banner.visiblePath) !== false
  )

export const applyThemePackToDocument = (
  themePack: string,
  theme: PluginThemeRuntimeRegistration | undefined,
  settings: PluginThemeSettingsValue
) => {
  const root = document.documentElement
  const activeThemeId = theme?.id === themePack ? themePack : 'default'
  root.dataset.oneworksThemePack = activeThemeId
  let cleanup: (() => void) | void
  try {
    cleanup = theme?.applyDocument?.({ root, settings })
  } catch {
    cleanup = undefined
  }

  return () => {
    try {
      cleanup?.()
    } catch {}
    if (root.dataset.oneworksThemePack === activeThemeId) {
      root.dataset.oneworksThemePack = 'default'
    }
  }
}

export const buildThemePackConfig = ({
  isDarkMode,
  primaryColor,
  settings,
  theme
}: {
  isDarkMode: boolean
  primaryColor: string
  settings: PluginThemeSettingsValue
  theme?: PluginThemeRuntimeRegistration
}): ThemeConfig => {
  const effectivePrimaryColor = theme?.primaryColor ?? primaryColor
  let pluginConfig: ThemeConfig = {}
  try {
    pluginConfig = theme?.createThemeConfig?.({
      isDarkMode,
      primaryColor: effectivePrimaryColor,
      settings
    }) ?? {}
  } catch {}

  return {
    ...pluginConfig,
    algorithm: pluginConfig.algorithm ?? (isDarkMode ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm),
    token: {
      ...pluginConfig.token,
      colorPrimary: effectivePrimaryColor
    }
  }
}
