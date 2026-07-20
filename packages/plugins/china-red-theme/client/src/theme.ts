/// <reference types="vite/client" />

import bannerArtwork from './banner-panorama.png'
import { zh } from './i18n'
import { normalizeChinaRedThemeSettings } from './settings'
import type { ChinaRedThemeSettings } from './settings'
import { settingsTabs } from './settings-tabs'
import themeCss from './theme.css?inline'

const applyChinaRedDocument = ({
  root,
  settings
}: {
  root: HTMLElement
  settings: ChinaRedThemeSettings
}) => {
  const active: string[] = []
  const { colors, components, layout } = settings.overrides
  if (colors.backgrounds) active.push('backgrounds')
  if (colors.borders) active.push('borders')
  if (components.buttons) active.push('buttons')
  if (components.inputs) active.push('inputs')
  if (components.menus) active.push('menus')
  if (components.overlays) active.push('overlays')
  if (layout.padding.enabled) active.push('padding')
  if (layout.iconSize.enabled) active.push('icons')
  root.dataset.oneworksThemePackOverrides = active.join(' ')
  root.style.setProperty('--oneworks-theme-pack-component-padding', `${layout.padding.value}px`)
  root.style.setProperty('--oneworks-theme-pack-component-icon-size', `${layout.iconSize.value}px`)
  return () => {
    delete root.dataset.oneworksThemePackOverrides
    root.style.removeProperty('--oneworks-theme-pack-component-padding')
    root.style.removeProperty('--oneworks-theme-pack-component-icon-size')
  }
}

export const chinaRedTheme = {
  id: 'china-red',
  title: zh({ en: 'China Edition', zh: '中国方案' }),
  description: zh({
    en: 'A special-edition workbench built from cinnabar red, warm paper, gold borders, and abundant coding momentum',
    zh: '朱砂红、暖宣纸、金色边框与澎湃代码动能组成的特别版工作台'
  }),
  primaryColor: '#E23F12',
  cssText: themeCss,
  normalizeSettings: normalizeChinaRedThemeSettings,
  applyDocument: applyChinaRedDocument,
  createThemeConfig: ({ isDarkMode }: { isDarkMode: boolean }) => ({
    token: {
      borderRadius: 4,
      colorBgBase: isDarkMode ? '#241512' : '#fffaf0',
      colorBorder: isDarkMode ? '#b88a36' : '#c8a04a',
      colorPrimary: '#E23F12',
      colorTextBase: isDarkMode ? '#fff2d8' : '#431b15',
      controlHeight: 30,
      fontSize: 12
    },
    components: {
      Button: { borderRadius: 4, controlHeight: 30 },
      Card: { borderRadiusLG: 6 },
      Input: { borderRadius: 4 },
      Select: { borderRadius: 4 }
    }
  }),
  banner: {
    ariaLabel: zh({ en: 'ONEWORKS China Edition', zh: 'ONEWORKS 中国方案' }),
    artworkUrl: bannerArtwork,
    title: zh({ en: 'CODE FOR STRENGTH · TECHNOLOGY FOR PROGRESS', zh: '代码强国 · 科技报国' }),
    subtitle: zh({ en: 'CHINA EDITION · BETA', zh: '中国方案 · 特别发行' }),
    slogan: zh({ en: 'Build dreams with code. Make ideas happen.', zh: '以代码筑梦，让创意发生' }),
    topline: [
      zh({ en: 'INTELLIGENT COLLABORATION WORKBENCH', zh: '智能协作工作台' }),
      zh({ en: 'CODE · TECHNOLOGY · SPECIAL EDITION', zh: '代码强国 · 科技报国 · 特别发行' })
    ],
    ribbon: [
      zh({ en: 'ABUNDANT CODING MOMENTUM', zh: '澎湃代码动能' }),
      zh({ en: 'BUILD DREAMS WITH CODE', zh: '以代码筑梦' }),
      zh({ en: 'CHINA SPECIAL EDITION', zh: '中国方案特别版' })
    ],
    visiblePath: 'showBanner'
  },
  settingsTabs
}
