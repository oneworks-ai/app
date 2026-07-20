import { zh } from './i18n'

const settingText = {
  backgrounds: zh({ en: 'Background and text colors', zh: '背景与文字颜色覆盖' }),
  backgroundsDescription: zh({
    en: 'Use warm-paper backgrounds, cinnabar text, and China Edition surface colors',
    zh: '使用暖宣纸背景、朱砂文字和中国方案表面色'
  }),
  borders: zh({ en: 'Gold borders', zh: '金色边框覆盖' }),
  bordersDescription: zh({
    en: 'Replace structural dividers, containers, and ordinary component borders while preserving semantic states',
    zh: '统一替换结构分割线、容器和普通组件边框；语义状态色保持不变'
  }),
  padding: zh({ en: 'Component padding', zh: '组件内边距覆盖' }),
  paddingDescription: zh({
    en: 'Read-only preset horizontal padding for buttons, inputs, and menus in px; use the switch to apply it',
    zh: '只读展示按钮、输入框和菜单的预设水平内边距，单位为 px；开关控制是否应用'
  }),
  iconSize: zh({ en: 'Component icon sizing', zh: '组件图标大小覆盖' }),
  iconSizeDescription: zh({
    en: 'Read-only preset icon sizing for settings, buttons, and menus in px; use the switch to apply it',
    zh: '只读展示普通配置项、按钮和菜单的预设图标尺寸，单位为 px；开关控制是否应用'
  })
}

const componentField = (
  id: string,
  icon: string,
  path: string,
  en: string,
  zhTitle: string,
  enDescription: string,
  zhDescription: string
) => ({
  id,
  icon,
  kind: 'boolean',
  path,
  title: zh({ en, zh: zhTitle }),
  description: zh({ en: enDescription, zh: zhDescription })
})

export const settingsTabs = [
  {
    id: 'colors',
    icon: 'palette',
    title: zh({ en: 'Base colors', zh: '基础颜色' }),
    fields: [
      {
        id: 'backgrounds',
        icon: 'format_color_fill',
        kind: 'boolean',
        path: 'overrides.colors.backgrounds',
        title: settingText.backgrounds,
        description: settingText.backgroundsDescription,
        visual: 'swatches'
      },
      {
        id: 'borders',
        icon: 'border_style',
        kind: 'boolean',
        path: 'overrides.colors.borders',
        title: settingText.borders,
        description: settingText.bordersDescription,
        visual: 'swatches'
      }
    ]
  },
  {
    id: 'layout',
    icon: 'format_size',
    title: zh({ en: 'Spacing & icons', zh: '间距与图标' }),
    fields: [
      {
        id: 'padding',
        icon: 'padding',
        kind: 'number',
        path: 'overrides.layout.padding.value',
        enabledPath: 'overrides.layout.padding.enabled',
        min: 4,
        max: 24,
        readOnly: true,
        unit: 'px',
        title: settingText.padding,
        description: settingText.paddingDescription
      },
      {
        id: 'iconSize',
        icon: 'match_case',
        kind: 'number',
        path: 'overrides.layout.iconSize.value',
        enabledPath: 'overrides.layout.iconSize.enabled',
        min: 12,
        max: 32,
        readOnly: true,
        unit: 'px',
        title: settingText.iconSize,
        description: settingText.iconSizeDescription
      }
    ]
  },
  {
    id: 'components',
    icon: 'widgets',
    title: zh({ en: 'Components', zh: '组件' }),
    fields: [
      componentField(
        'buttons',
        'smart_button',
        'overrides.components.buttons',
        'Buttons',
        '按钮',
        'Enable cinnabar gradients, compact radii, and themed shadows',
        '启用朱砂渐变、紧凑圆角和主题阴影'
      ),
      componentField(
        'inputs',
        'input',
        'overrides.components.inputs',
        'Inputs and selectors',
        '输入框与选择器',
        'Enable themed surfaces, borders, radii, and subtle inset shadows',
        '启用主题表面、边框、圆角和轻量内阴影'
      ),
      componentField(
        'menus',
        'menu_open',
        'overrides.components.menus',
        'Menus and dropdowns',
        '菜单与下拉列表',
        'Enable themed menu surfaces, radii, density, and sidebar states',
        '启用主题菜单表面、圆角、密度和侧栏状态'
      ),
      componentField(
        'overlays',
        'dialogs',
        'overrides.components.overlays',
        'Overlays and containers',
        '浮层与容器',
        'Enable card, drawer, dialog, tooltip, and workspace surface styling',
        '启用卡片、抽屉、对话框、提示层和工作区表面样式'
      )
    ]
  },
  {
    id: 'banner',
    icon: 'flag',
    title: zh({ en: 'Banner', zh: '横幅' }),
    fields: [{
      id: 'showBanner',
      icon: 'flag',
      kind: 'boolean',
      path: 'showBanner',
      title: zh({ en: 'Show theme banner', zh: '展示主题横幅' }),
      description: zh({
        en: 'Show the playful China Edition banner above the workspace',
        zh: '在工作区顶部展示中国方案特别版整活横幅'
      })
    }]
  }
]
