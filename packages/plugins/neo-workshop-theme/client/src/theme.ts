/// <reference types="vite/client" />

import { zh } from './i18n'
import { normalizeNeoWorkshopThemeSettings } from './settings'
import type { NeoWorkshopThemeSettings } from './settings'
import { settingsTabs } from './settings-tabs'
import themeCss from './theme.css?inline'

const applyNeoWorkshopDocument = ({
  root,
  settings
}: {
  root: HTMLElement
  settings: NeoWorkshopThemeSettings
}) => {
  const active: string[] = []
  const { colors, components, geometry } = settings.overrides
  if (colors.palette) active.push('palette')
  if (colors.borders) active.push('borders')
  if (geometry.corners) active.push('corners')
  if (geometry.shadows) active.push('shadows')
  if (geometry.buttonPadding.enabled) active.push('button-padding')
  if (components.buttons) active.push('buttons')
  if (components.inputs) active.push('inputs')
  if (components.menus) active.push('menus')
  if (components.overlays) active.push('overlays')
  root.dataset.oneworksThemePackOverrides = active.join(' ')
  root.style.setProperty('--oneworks-neo-button-padding', `${geometry.buttonPadding.value}px`)
  return () => {
    delete root.dataset.oneworksThemePackOverrides
    root.style.removeProperty('--oneworks-neo-button-padding')
  }
}

export const neoWorkshopTheme = {
  id: 'neo-workshop',
  title: zh({ en: 'Neo Workshop', zh: '新粗野工坊' }),
  description: zh({
    en:
      'A playful neo-brutalist workbench with cream surfaces, black outlines, hard shadows, yellow highlights, and pink actions',
    zh: '由奶油色表面、黑色轮廓、硬阴影、黄色高亮和粉色操作组成的新粗野主义工作台'
  }),
  primaryColor: '#fe7da8',
  cssText: themeCss,
  normalizeSettings: normalizeNeoWorkshopThemeSettings,
  applyDocument: applyNeoWorkshopDocument,
  createThemeConfig: ({ isDarkMode, settings }: { isDarkMode: boolean; settings: Record<string, unknown> }) => {
    const normalized = normalizeNeoWorkshopThemeSettings(settings)
    const square = normalized.overrides.geometry.corners
    return {
      token: {
        borderRadius: square ? 0 : 8,
        colorBgBase: isDarkMode ? '#171411' : '#fff8e7',
        colorBorder: '#141111',
        colorPrimary: '#fe7da8',
        colorTextBase: isDarkMode ? '#fff7e5' : '#141111',
        controlHeight: 32,
        fontSize: 13,
        lineWidth: normalized.overrides.colors.borders ? 2 : 1
      },
      components: {
        Button: { borderRadius: square ? 0 : 8, controlHeight: 32, fontWeight: 700 },
        Card: { borderRadiusLG: square ? 0 : 12 },
        Input: { borderRadius: square ? 0 : 8 },
        Select: { borderRadius: square ? 0 : 8 }
      }
    }
  },
  settingsTabs
}
