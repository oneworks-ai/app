/// <reference types="vite/client" />

import { zh } from './i18n'
import { normalizeWarmCoworkThemeSettings } from './settings'
import type { WarmCoworkThemeSettings } from './settings'
import { settingsTabs } from './settings-tabs'
import themeCss from './theme.css?inline'

const applyWarmCoworkDocument = ({ root, settings }: { root: HTMLElement; settings: WarmCoworkThemeSettings }) => {
  const active: string[] = []
  const { colors, components, workspace } = settings.overrides
  if (colors.palette) active.push('palette')
  if (colors.status) active.push('status')
  if (workspace.grid) active.push('grid')
  if (workspace.shadows) active.push('shadows')
  if (workspace.controlRadius.enabled) active.push('control-radius')
  if (workspace.groupRadius.enabled) active.push('group-radius')
  if (workspace.panelRadius.enabled) active.push('panel-radius')
  if (components.buttons) active.push('buttons')
  if (components.inputs) active.push('inputs')
  if (components.menus) active.push('menus')
  if (components.overlays) active.push('overlays')
  root.dataset.oneworksThemePackOverrides = active.join(' ')
  root.style.setProperty('--oneworks-cowork-control-radius', `${workspace.controlRadius.value}px`)
  root.style.setProperty('--oneworks-cowork-group-radius', `${workspace.groupRadius.value}px`)
  root.style.setProperty('--oneworks-cowork-panel-radius', `${workspace.panelRadius.value}px`)
  return () => {
    delete root.dataset.oneworksThemePackOverrides
    root.style.removeProperty('--oneworks-cowork-control-radius')
    root.style.removeProperty('--oneworks-cowork-group-radius')
    root.style.removeProperty('--oneworks-cowork-panel-radius')
  }
}

export const warmCoworkTheme = {
  id: 'warm-cowork',
  title: zh({ en: 'Cowork', zh: 'Cowork 主题' }),
  description: zh({
    en:
      'A warm card-oriented workspace with an ivory grid, coral primary actions, blue progress semantics, and a 9/14/20 radius ladder',
    zh: '带有象牙白网格、珊瑚色主操作、蓝色进度语义与 9/14/20 圆角阶梯的卡片式协作工作区'
  }),
  primaryColor: '#c9684d',
  cssText: themeCss,
  normalizeSettings: normalizeWarmCoworkThemeSettings,
  applyDocument: applyWarmCoworkDocument,
  createThemeConfig: ({ isDarkMode, settings }: { isDarkMode: boolean; settings: Record<string, unknown> }) => {
    const normalized = normalizeWarmCoworkThemeSettings(settings)
    const { controlRadius, panelRadius } = normalized.overrides.workspace
    return {
      token: {
        borderRadius: controlRadius.enabled ? controlRadius.value : 8,
        colorBgBase: isDarkMode ? '#1d1b18' : '#f7f4ee',
        colorBorder: isDarkMode ? '#474139' : '#d9d4ca',
        colorInfo: isDarkMode ? '#69abe0' : '#2b6fa6',
        colorPrimary: isDarkMode ? '#df8063' : '#c9684d',
        colorTextBase: isDarkMode ? '#f4efe6' : '#24221f',
        controlHeight: 32,
        fontSize: 13
      },
      components: {
        Button: { borderRadius: controlRadius.enabled ? controlRadius.value : 8, controlHeight: 32 },
        Card: { borderRadiusLG: panelRadius.enabled ? panelRadius.value : 16 },
        Input: { borderRadius: controlRadius.enabled ? controlRadius.value : 8 },
        Select: { borderRadius: controlRadius.enabled ? controlRadius.value : 8 }
      }
    }
  },
  settingsTabs
}
