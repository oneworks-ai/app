import {
  DEFAULT_THEME_PRIMARY_COLOR,
  ONEWORKS_THEME_COLOR_PRESETS,
  normalizeThemePrimaryColor
} from '@oneworks/icon/presets'

import { createOneWorksIconDataUri } from '#~/utils/oneworks-icon'
import type { ConfigOneWorksIconMode } from '#~/utils/oneworks-icon'

import { normalizeDesktopIconBackground } from './app-icon-settings-model'
import type { DesktopIconBackground, DesktopIconTheme } from './app-icon-settings-model'
import type { TranslationFn } from './configUtils'

export type ThemePrimaryColor = typeof ONEWORKS_THEME_COLOR_PRESETS[number]['primaryColor']
type ThemePreset = typeof ONEWORKS_THEME_COLOR_PRESETS[number]

export const getPresetByPrimaryColor = (primaryColor: ThemePrimaryColor): ThemePreset =>
  ONEWORKS_THEME_COLOR_PRESETS.find(preset => preset.primaryColor === primaryColor) ??
    ONEWORKS_THEME_COLOR_PRESETS[0]

export const getPresetByTheme = (theme: DesktopIconTheme): ThemePreset =>
  ONEWORKS_THEME_COLOR_PRESETS.find(preset => preset.theme === theme) ??
    ONEWORKS_THEME_COLOR_PRESETS[0]

export const getProjectPrimaryColor = (appearance: Record<string, unknown>) =>
  normalizeThemePrimaryColor(
    typeof appearance.primaryColor === 'string' ? appearance.primaryColor : undefined
  ) ?? DEFAULT_THEME_PRIMARY_COLOR

export const getProjectIconBackground = (appearance: Record<string, unknown>) => (
  'iconBackground' in appearance
    ? normalizeDesktopIconBackground(appearance.iconBackground)
    : undefined
)

export const getProjectThemePreviewSources = ({
  iconBackground,
  iconMode,
  t
}: {
  iconBackground: DesktopIconBackground
  iconMode: ConfigOneWorksIconMode
  t: TranslationFn
}) =>
  ONEWORKS_THEME_COLOR_PRESETS.reduce<Partial<Record<DesktopIconTheme, string>>>((next, preset) => {
    next[preset.theme] = createOneWorksIconDataUri({
      mode: iconMode,
      backgroundStyle: iconBackground,
      size: 96,
      theme: preset.theme,
      title: t(`config.desktopSettings.appIcon.themeOptions.${preset.theme}`)
    })
    return next
  }, {})

export const getSyncAppIconCopy = (platform: string | undefined, t: TranslationFn) => {
  if (platform === 'darwin') {
    return {
      description: t('config.appSettings.projectThemeColor.syncDockIcon.desc'),
      label: t('config.appSettings.projectThemeColor.syncDockIcon.label')
    }
  }
  if (platform === 'win32') {
    return {
      description: t('config.appSettings.projectThemeColor.syncTaskbarIcon.desc'),
      label: t('config.appSettings.projectThemeColor.syncTaskbarIcon.label')
    }
  }
  return {
    description: t('config.appSettings.projectThemeColor.syncAppIcon.desc'),
    label: t('config.appSettings.projectThemeColor.syncAppIcon.label')
  }
}
