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
        id: 'palette',
        icon: 'format_color_fill',
        kind: 'boolean',
        path: 'overrides.colors.palette',
        title: zh({ en: 'Cream, yellow, and pink palette', zh: '奶油黄粉配色覆盖' }),
        description: zh({
          en: 'Use cream work surfaces, yellow highlights, and pink primary actions',
          zh: '使用奶油色工作面、黄色高亮和粉色主操作'
        }),
        visual: 'swatches'
      },
      {
        id: 'borders',
        icon: 'border_style',
        kind: 'boolean',
        path: 'overrides.colors.borders',
        title: zh({ en: 'Black structural borders', zh: '黑色结构边框覆盖' }),
        description: zh({
          en: 'Use strong black dividers and component outlines while keeping semantic states intact',
          zh: '使用醒目的黑色分割线和组件轮廓，并保留语义状态色'
        }),
        visual: 'swatches'
      }
    ]
  },
  {
    id: 'geometry',
    icon: 'select_window',
    title: zh({ en: 'Geometry', zh: '几何与阴影' }),
    fields: [
      {
        id: 'corners',
        icon: 'crop_square',
        kind: 'boolean',
        path: 'overrides.geometry.corners',
        title: zh({ en: 'Square component corners', zh: '方形组件边角' }),
        description: zh({
          en: 'Remove ornamental rounding from ordinary controls and containers',
          zh: '移除普通控件和容器的装饰性圆角'
        })
      },
      {
        id: 'shadows',
        icon: 'filter_none',
        kind: 'boolean',
        path: 'overrides.geometry.shadows',
        title: zh({ en: 'Hard offset shadows', zh: '硬偏移阴影' }),
        description: zh({
          en: 'Apply four-pixel structural shadows to elevated surfaces',
          zh: '为抬升表面应用 4px 结构硬阴影'
        })
      },
      {
        id: 'buttonPadding',
        icon: 'padding',
        kind: 'number',
        path: 'overrides.geometry.buttonPadding.value',
        enabledPath: 'overrides.geometry.buttonPadding.enabled',
        min: 5,
        max: 12,
        readOnly: true,
        unit: 'px',
        title: zh({ en: 'Button padding', zh: '按钮内边距' }),
        description: zh({
          en: 'Read-only all-side padding for normal and icon buttons',
          zh: '只读展示普通按钮和图标按钮的四向内边距'
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
        'Use blocky actions with surface-based hover feedback',
        '使用块状按钮和基于表面色的悬停反馈'
      ),
      componentField(
        'inputs',
        'input',
        'overrides.components.inputs',
        'Inputs and selectors',
        '输入框与选择器',
        'Use square fields with strong outlines',
        '使用方形字段与醒目轮廓'
      ),
      componentField(
        'menus',
        'menu_open',
        'overrides.components.menus',
        'Menus and navigation',
        '菜单与导航',
        'Use neutral progressive sidebar layers and blocky menu states',
        '使用中性渐进侧栏层级与块状菜单状态'
      ),
      componentField(
        'overlays',
        'dialogs',
        'overrides.components.overlays',
        'Overlays and containers',
        '浮层与容器',
        'Use outlined cards, dialogs, drawers, and popovers',
        '为卡片、对话框、抽屉和浮层应用描边'
      )
    ]
  }
]
