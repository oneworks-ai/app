import type { ThemeConfig } from 'antd'

import type { PluginI18nText } from './plugin-i18n'

export type PluginThemeSettingsValue = Record<string, unknown>

interface PluginThemeSettingFieldBase {
  description?: PluginI18nText
  icon: string
  id: string
  title: PluginI18nText
}

export interface PluginThemeBooleanSettingField extends PluginThemeSettingFieldBase {
  kind: 'boolean'
  path: string
  visual?: 'swatches'
}

export interface PluginThemeNumberSettingField extends PluginThemeSettingFieldBase {
  enabledPath?: string
  kind: 'number'
  max?: number
  min?: number
  path: string
  readOnly?: boolean
  unit?: string
}

export type PluginThemeSettingField =
  | PluginThemeBooleanSettingField
  | PluginThemeNumberSettingField

export interface PluginThemeSettingsTab {
  fields: PluginThemeSettingField[]
  icon: string
  id: string
  title: PluginI18nText
}

export interface PluginThemeBannerRegistration {
  ariaLabel: PluginI18nText
  artworkUrl: string
  brand?: {
    eyebrow?: PluginI18nText
    markUrl?: string | { dark: string; light: string }
    name: PluginI18nText
    tagline?: PluginI18nText
  }
  ribbon?: PluginI18nText[]
  slogan?: PluginI18nText
  subtitle?: PluginI18nText
  title: PluginI18nText
  topline?: PluginI18nText[]
  visiblePath?: string
}

export interface PluginThemeConfigContext {
  isDarkMode: boolean
  primaryColor: string
  settings: PluginThemeSettingsValue
}

export interface PluginThemeDocumentContext {
  root: HTMLElement
  settings: PluginThemeSettingsValue
}

export interface PluginThemeRegistration {
  applyDocument?: (context: PluginThemeDocumentContext) => (() => void) | void
  banner?: PluginThemeBannerRegistration
  createThemeConfig?: (context: PluginThemeConfigContext) => ThemeConfig
  cssText?: string
  description: PluginI18nText
  id: string
  normalizeSettings: (value: unknown) => PluginThemeSettingsValue
  primaryColor?: string
  settingsTabs?: PluginThemeSettingsTab[]
  title: PluginI18nText
}

export interface PluginThemeRuntimeRegistration extends PluginThemeRegistration {
  pluginScope: string
}
