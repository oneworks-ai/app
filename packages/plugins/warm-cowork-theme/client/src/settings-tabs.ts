import { zh } from './i18n'

const radiusField = (id: string, path: string, en: string, zhTitle: string, description: string) => ({
  id,
  icon: 'rounded_corner',
  kind: 'number',
  path: `${path}.value`,
  enabledPath: `${path}.enabled`,
  min: 0,
  max: 32,
  readOnly: true,
  unit: 'px',
  title: zh({ en, zh: zhTitle }),
  description: zh({ en: description, zh: `只读展示${zhTitle}的主题预设值` })
})

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
        visual: 'swatches',
        title: zh({ en: 'Warm ivory and coral palette', zh: '暖象牙白与珊瑚配色覆盖' }),
        description: zh({
          en: 'Use warm canvas layers, white cards, and coral primary actions',
          zh: '使用暖色画布层级、白色卡片与珊瑚色主操作'
        })
      },
      {
        id: 'status',
        icon: 'pending_actions',
        kind: 'boolean',
        path: 'overrides.colors.status',
        visual: 'swatches',
        title: zh({ en: 'Blue progress semantics', zh: '蓝色进度语义覆盖' }),
        description: zh({
          en: 'Use blue for progress, active work, and informational status without recoloring warnings or errors',
          zh: '使用蓝色表达进度、活跃工作与信息状态，不重染警告和错误'
        })
      }
    ]
  },
  {
    id: 'workspace',
    icon: 'grid_view',
    title: zh({ en: 'Workspace', zh: '工作区' }),
    fields: [
      {
        id: 'grid',
        icon: 'grid_4x4',
        kind: 'boolean',
        path: 'overrides.workspace.grid',
        title: zh({ en: 'Subtle workspace grid', zh: '轻量工作区网格' }),
        description: zh({
          en: 'Show a 32-pixel drafting grid on open workspace surfaces',
          zh: '在开放工作区表面展示 32px 制图网格'
        })
      },
      radiusField(
        'controlRadius',
        'overrides.workspace.controlRadius',
        'Control radius',
        '控件圆角',
        'Read-only radius for buttons, fields, and segmented controls'
      ),
      radiusField(
        'groupRadius',
        'overrides.workspace.groupRadius',
        'Group radius',
        '分组圆角',
        'Read-only radius for grouped controls and popovers'
      ),
      radiusField(
        'panelRadius',
        'overrides.workspace.panelRadius',
        'Panel radius',
        '面板圆角',
        'Read-only radius for cards, dialogs, and workspace panels'
      ),
      {
        id: 'shadows',
        icon: 'filter_none',
        kind: 'boolean',
        path: 'overrides.workspace.shadows',
        title: zh({ en: 'Short workspace shadows', zh: '短距离工作区阴影' }),
        description: zh({
          en: 'Use warm short shadows in light mode and near-black shadows in dark mode',
          zh: '浅色模式使用暖色短阴影，深色模式使用近黑短阴影'
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
        'Use coral primary actions and neutral surface hover feedback',
        '使用珊瑚色主操作与中性表面悬停反馈'
      ),
      componentField(
        'inputs',
        'input',
        'overrides.components.inputs',
        'Inputs and composer',
        '输入框与编辑器',
        'Use warm fields and a tight composer focus glow',
        '使用暖色字段与紧凑的编辑器聚焦光晕'
      ),
      componentField(
        'menus',
        'menu_open',
        'overrides.components.menus',
        'Menus and navigation',
        '菜单与导航',
        'Use neutral progressive sidebar layers and compact segmented states',
        '使用中性渐进侧栏层级与紧凑分段状态'
      ),
      componentField(
        'overlays',
        'dialogs',
        'overrides.components.overlays',
        'Cards and overlays',
        '卡片与浮层',
        'Use roomy cards, dialogs, drawers, and popovers',
        '使用宽松卡片、对话框、抽屉和浮层'
      )
    ]
  }
]
