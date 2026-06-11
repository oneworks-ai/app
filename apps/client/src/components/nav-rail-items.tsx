import type { MenuProps } from 'antd'
import type { TFunction } from 'i18next'

import type { ExperimentsConfig } from '@oneworks/types'

import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { appLanguageOptions, getActiveAppLanguageOption } from '#~/i18n'
import type { ThemeMode } from '#~/store'

export interface NavRailItem {
  active: boolean
  icon: string
  key: string
  label: string
  path: string
}

const normalizePath = (path: string) => {
  const normalized = path.replace(/\/+$/, '')
  return normalized === '' ? '/' : normalized
}

const isPluginStorePath = (path: string) => {
  const normalizedPath = normalizePath(path)
  if (normalizedPath === '/plugins') return true

  const segments = normalizedPath.split('/').filter(Boolean)
  return segments.length === 2 && segments[0] === 'plugins'
}

export function buildLanguageItems({
  currentLanguage,
  onChangeLanguage
}: {
  currentLanguage: string
  onChangeLanguage: (language: string) => unknown
}): MenuProps['items'] {
  const activeLanguage = getActiveAppLanguageOption(currentLanguage)
  return appLanguageOptions.map(option => ({
    key: option.value,
    label: option.label,
    icon: activeLanguage?.value === option.value
      ? (
        <MaterialSymbol className='nav-menu-icon active' name='check' />
      )
      : <div className='nav-menu-icon-placeholder' />,
    onClick: () => {
      void onChangeLanguage(option.value)
    }
  }))
}

export function buildThemeItems({
  setThemeMode,
  t,
  themeMode
}: {
  setThemeMode: (themeMode: ThemeMode) => unknown
  t: TFunction
  themeMode: ThemeMode
}): MenuProps['items'] {
  return [
    {
      key: 'light',
      label: t('common.themeLight'),
      icon: themeMode === 'light'
        ? <MaterialSymbol className='nav-menu-icon active' name='check' />
        : <MaterialSymbol className='nav-menu-icon' name='light_mode' />,
      onClick: () => {
        void setThemeMode('light')
      }
    },
    {
      key: 'dark',
      label: t('common.themeDark'),
      icon: themeMode === 'dark'
        ? <MaterialSymbol className='nav-menu-icon active' name='check' />
        : <MaterialSymbol className='nav-menu-icon' name='dark_mode' />,
      onClick: () => {
        void setThemeMode('dark')
      }
    },
    {
      key: 'system',
      label: t('common.themeSystem'),
      icon: themeMode === 'system'
        ? <MaterialSymbol className='nav-menu-icon active' name='check' />
        : <MaterialSymbol className='nav-menu-icon' name='desktop_windows' />,
      onClick: () => {
        void setThemeMode('system')
      }
    }
  ]
}

export function buildNavItems({
  currentPath,
  experiments,
  t
}: {
  currentPath: string
  experiments?: ExperimentsConfig
  t: TFunction
}): NavRailItem[] {
  const items: NavRailItem[] = [
    {
      key: 'sessions',
      icon: 'forum',
      label: t('common.sessions'),
      path: '/',
      active: currentPath === '/' || currentPath.startsWith('/session/')
    },
    {
      key: 'knowledge',
      icon: 'library_books',
      label: t('common.knowledgeBase'),
      path: '/knowledge',
      active: currentPath === '/knowledge'
    },
    {
      key: 'automation',
      icon: 'schedule',
      label: t('common.scheduledTasks'),
      path: '/automation',
      active: currentPath === '/automation'
    },
    {
      key: 'plugins',
      icon: 'extension',
      label: t('common.pluginStore'),
      path: '/plugins',
      active: isPluginStorePath(currentPath)
    },
    ...(experiments?.benchmark === true
      ? [{
        key: 'benchmark',
        icon: 'speed',
        label: t('common.benchmark'),
        path: '/benchmark',
        active: currentPath === '/benchmark'
      }]
      : [])
  ]

  return items
}
