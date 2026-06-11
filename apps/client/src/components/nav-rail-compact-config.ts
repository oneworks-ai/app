import type { TFunction } from 'i18next'

import { appLanguageOptions, getActiveAppLanguageOption } from '#~/i18n'
import type { ThemeMode } from '#~/store'

import type { NavRailCompactChoiceAction, NavRailCompactMoreAction } from './NavRailCompact'

export function buildCompactMoreActions({
  currentPath,
  onOpenSidebar,
  showSidebar,
  t
}: {
  currentPath: string
  onOpenSidebar?: () => void
  showSidebar: boolean
  t: TFunction
}): NavRailCompactMoreAction[] {
  const actions: NavRailCompactMoreAction[] = []

  if (showSidebar && onOpenSidebar != null) {
    actions.push({
      active: currentPath === '/' || currentPath.startsWith('/session/'),
      icon: 'menu',
      key: 'sessions',
      label: t('common.sessions'),
      onSelect: onOpenSidebar
    })
  }

  return actions
}

export function buildCompactThemeActions({
  setThemeMode,
  t,
  themeMode
}: {
  setThemeMode: (value: ThemeMode) => unknown
  t: TFunction
  themeMode: ThemeMode
}): NavRailCompactChoiceAction[] {
  return [
    {
      active: themeMode === 'light',
      icon: 'light_mode',
      key: 'light',
      label: t('common.themeLight'),
      onSelect: () => {
        void setThemeMode('light')
      }
    },
    {
      active: themeMode === 'dark',
      icon: 'dark_mode',
      key: 'dark',
      label: t('common.themeDark'),
      onSelect: () => {
        void setThemeMode('dark')
      }
    },
    {
      active: themeMode === 'system',
      icon: 'desktop_windows',
      key: 'system',
      label: t('common.themeSystem'),
      onSelect: () => {
        void setThemeMode('system')
      }
    }
  ]
}

export function buildCompactLanguageActions({
  currentLanguage,
  onChangeLanguage
}: {
  currentLanguage: string
  onChangeLanguage: (language: string) => void
}): NavRailCompactChoiceAction[] {
  const activeLanguage = getActiveAppLanguageOption(currentLanguage)

  return appLanguageOptions.map(option => ({
    active: activeLanguage?.value === option.value,
    key: option.value,
    label: option.label,
    onSelect: () => {
      onChangeLanguage(option.value)
    }
  }))
}
