/// <reference types="vite/client" />

import { zh } from './i18n'
import { normalizeFocusWorkbenchThemeSettings } from './settings'
import type { FocusWorkbenchThemeSettings } from './settings'
import { settingsTabs } from './settings-tabs'
import themeCss from './theme.css?inline'

const applyFocusWorkbenchDocument = (
  { root, settings }: { root: HTMLElement; settings: FocusWorkbenchThemeSettings }
) => {
  const active: string[] = []
  const { colors, components, density } = settings.overrides
  if (colors.surfaces) active.push('surfaces')
  if (colors.dividers) active.push('dividers')
  if (density.buttonPadding.enabled) active.push('button-padding')
  if (density.iconSize.enabled) active.push('icons')
  if (components.buttons) active.push('buttons')
  if (components.inputs) active.push('inputs')
  if (components.menus) active.push('menus')
  if (components.overlays) active.push('overlays')
  root.dataset.oneworksThemePackOverrides = active.join(' ')
  root.style.setProperty('--oneworks-focus-button-padding', `${density.buttonPadding.value}px`)
  root.style.setProperty('--oneworks-focus-icon-size', `${density.iconSize.value}px`)
  return () => {
    delete root.dataset.oneworksThemePackOverrides
    root.style.removeProperty('--oneworks-focus-button-padding')
    root.style.removeProperty('--oneworks-focus-icon-size')
  }
}

export const focusWorkbenchTheme = {
  id: 'focus-workbench',
  title: zh({ en: 'Codex', zh: 'Codex 主题' }),
  description: zh({
    en:
      'A restrained neutral workbench with thin dividers, compact controls, low visual noise, and quiet blue interaction feedback',
    zh: '以中性表面、纤细分隔线、紧凑控件、低视觉噪声和克制蓝色反馈组成的专注工作台'
  }),
  primaryColor: '#006dcc',
  cssText: themeCss,
  normalizeSettings: normalizeFocusWorkbenchThemeSettings,
  applyDocument: applyFocusWorkbenchDocument,
  createThemeConfig: ({ isDarkMode }: { isDarkMode: boolean }) => ({
    token: {
      borderRadius: 8,
      colorBgBase: isDarkMode ? '#151515' : '#f7f7f7',
      colorBorder: isDarkMode ? '#383838' : '#d7d7d7',
      colorPrimary: isDarkMode ? '#339cff' : '#006dcc',
      colorTextBase: isDarkMode ? '#f5f5f5' : '#171717',
      controlHeight: 30,
      fontSize: 13,
      lineWidth: 1
    },
    components: {
      Button: { borderRadius: 8, controlHeight: 30 },
      Card: { borderRadiusLG: 16 },
      Input: { borderRadius: 8 },
      Select: { borderRadius: 8 }
    }
  }),
  settingsTabs
}
