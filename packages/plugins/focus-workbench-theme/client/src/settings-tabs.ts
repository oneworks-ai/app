import { zh } from './i18n'

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
        id: 'surfaces',
        icon: 'format_color_fill',
        kind: 'boolean',
        path: 'overrides.colors.surfaces',
        visual: 'swatches',
        title: zh({ en: 'Neutral surface ladder', zh: '中性表面层级覆盖' }),
        description: zh({
          en: 'Use quiet grayscale canvas, sidebar, panel, and elevated surfaces',
          zh: '使用低噪灰阶画布、侧栏、面板和抬升表面'
        })
      },
      {
        id: 'dividers',
        icon: 'border_style',
        kind: 'boolean',
        path: 'overrides.colors.dividers',
        visual: 'swatches',
        title: zh({ en: 'Thin dividers', zh: '纤细分隔线覆盖' }),
        description: zh({
          en: 'Use restrained one-pixel structural dividers while preserving semantic states',
          zh: '使用克制的 1px 结构分隔线，并保留语义状态色'
        })
      }
    ]
  },
  {
    id: 'density',
    icon: 'format_size',
    title: zh({ en: 'Density & icons', zh: '密度与图标' }),
    fields: [
      {
        id: 'buttonPadding',
        icon: 'padding',
        kind: 'number',
        path: 'overrides.density.buttonPadding.value',
        enabledPath: 'overrides.density.buttonPadding.enabled',
        min: 5,
        max: 12,
        readOnly: true,
        unit: 'px',
        title: zh({ en: 'Button padding', zh: '按钮内边距' }),
        description: zh({
          en: 'Read-only all-side padding for normal and icon buttons',
          zh: '只读展示普通按钮和图标按钮的四向内边距'
        })
      },
      {
        id: 'iconSize',
        icon: 'match_case',
        kind: 'number',
        path: 'overrides.density.iconSize.value',
        enabledPath: 'overrides.density.iconSize.enabled',
        min: 14,
        max: 24,
        readOnly: true,
        unit: 'px',
        title: zh({ en: 'Component icon size', zh: '组件图标大小' }),
        description: zh({
          en: 'Read-only icon size for buttons, menus, and configuration rows',
          zh: '只读展示按钮、菜单和配置行的图标尺寸'
        })
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
        'Use compact controls and neutral surface hover feedback',
        '使用紧凑控件和中性表面悬停反馈'
      ),
      componentField(
        'inputs',
        'input',
        'overrides.components.inputs',
        'Inputs and selectors',
        '输入框与选择器',
        'Use quiet fields with clear focus rings',
        '使用低噪字段和清晰聚焦环'
      ),
      componentField(
        'menus',
        'menu_open',
        'overrides.components.menus',
        'Menus and navigation',
        '菜单与导航',
        'Use solid neutral sidebar surfaces and quiet menu states',
        '使用纯色中性侧栏表面和低噪菜单状态'
      ),
      componentField(
        'overlays',
        'dialogs',
        'overrides.components.overlays',
        'Overlays and containers',
        '浮层与容器',
        'Use restrained cards, dialogs, drawers, and popovers',
        '使用克制的卡片、对话框、抽屉和浮层'
      )
    ]
  }
]
