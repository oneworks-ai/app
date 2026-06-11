import type { MenuProps } from 'antd'
import type { TFunction } from 'i18next'

import type { PluginContributionWorkbenchAddMenuItem } from '#~/plugins/plugin-manifest'

import type { InteractionPanelMobileDebugDeviceOption } from './interaction-panel/interaction-panel-mobile-debug-pages'
import { buildInteractionPanelAddMenuItems } from './interaction-panel/interaction-panel-tab-menu'
import type { InteractionPanelAddMenuItemKind } from './interaction-panel/interaction-panel-tab-menu'
import type { WorkspaceDrawerView } from './workspace-drawer/workspace-drawer-types'
import type { WorkspaceDrawerViewItem } from './workspace-drawer/workspace-drawer-view-items'

export const WORKBENCH_DRAWER_VIEW_MENU_KEY_PREFIX = 'workspace-drawer:view:'

export const toWorkbenchDrawerViewMenuKey = (view: WorkspaceDrawerView) =>
  `${WORKBENCH_DRAWER_VIEW_MENU_KEY_PREFIX}${encodeURIComponent(view)}`

export const parseWorkbenchDrawerViewMenuKey = (key: string): WorkspaceDrawerView | undefined => {
  if (!key.startsWith(WORKBENCH_DRAWER_VIEW_MENU_KEY_PREFIX)) return undefined
  const payload = key.slice(WORKBENCH_DRAWER_VIEW_MENU_KEY_PREFIX.length)
  if (payload === '') return undefined
  return decodeURIComponent(payload) as WorkspaceDrawerView
}

const renderWorkbenchCreateMenuIcon = (icon: string) => (
  <span className='material-symbols-rounded chat-interaction-panel__menu-icon'>{icon}</span>
)

export const buildWorkbenchCreateMenuItems = (
  t: TFunction,
  isMac: boolean,
  options: {
    canCreateSessionTab?: boolean
    interactionPanelItemKinds?: InteractionPanelAddMenuItemKind[]
    language?: string
    mobileDebugDevices?: InteractionPanelMobileDebugDeviceOption[]
    pluginMenuItems?: Array<PluginContributionWorkbenchAddMenuItem & { pluginScope: string }>
    selectedMobileDebugDeviceId?: string
    workspaceDrawerItems?: WorkspaceDrawerViewItem[]
  } = {}
): MenuProps['items'] => {
  const interactionPanelItems = buildInteractionPanelAddMenuItems(t, isMac, {
    ...options,
    includeKinds: options.interactionPanelItemKinds,
    language: options.language
  }) ?? []
  const workspaceDrawerItems = options.workspaceDrawerItems ?? []
  if (workspaceDrawerItems.length === 0) return interactionPanelItems

  return [
    ...interactionPanelItems,
    { type: 'divider' },
    ...workspaceDrawerItems.map(item => ({
      key: toWorkbenchDrawerViewMenuKey(item.key),
      icon: renderWorkbenchCreateMenuIcon(item.icon),
      label: item.label
    }))
  ]
}
