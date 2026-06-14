/* eslint-disable max-lines -- interaction panel tab menus keep shared keys, labels, and pinned actions together. */

import type { MenuProps } from 'antd'
import type { TFunction } from 'i18next'

import { resolvePluginContributionText } from '#~/plugins/plugin-i18n'
import type { PluginContributionWorkbenchAddMenuItem } from '#~/plugins/plugin-manifest'

import type { InteractionPanelIframePage } from './InteractionPanelIframeView'
import type { InteractionPanelMobileDebugDeviceOption } from './interaction-panel-mobile-debug-pages'
import type { InteractionPanelPinnedTab } from './interaction-panel-pinned-tabs'
import {
  INTERACTION_PANEL_NEW_IFRAME_SHORTCUT,
  INTERACTION_PANEL_NEW_TERMINAL_SHORTCUT,
  INTERACTION_PANEL_OPEN_FILE_SHORTCUT,
  formatInteractionPanelShortcut
} from './interaction-panel-shortcuts'
import { buildInteractionPanelTabContextActions } from './interaction-panel-tab-context-actions'
import type { InteractionPanelTerminalShellKind } from './interaction-panel-tab-context-actions'
import type { InteractionPanelTab } from './interaction-panel-tabs'

type InteractionPanelMenuItems = NonNullable<MenuProps['items']>
export type InteractionPanelAddMenuItemKind =
  | 'iframe'
  | 'mobile-debug'
  | 'page-debugger'
  | 'plugin'
  | 'resource'
  | 'session'
  | 'terminal'

export const INTERACTION_PANEL_MOBILE_DEBUG_CONFIG_KEY = 'mobile-debug:config'
export const INTERACTION_PANEL_MOBILE_DEBUG_DEVICE_KEY_PREFIX = 'mobile-debug:device:'
export const INTERACTION_PANEL_MOBILE_DEBUG_NO_DEVICES_KEY = 'mobile-debug:no-devices'
export const INTERACTION_PANEL_PLUGIN_ADD_MENU_KEY_PREFIX = 'plugin:add:'

export const toInteractionPanelPluginAddMenuKey = (scope: string, id: string) =>
  `${INTERACTION_PANEL_PLUGIN_ADD_MENU_KEY_PREFIX}${scope}:${id}`

export const parseInteractionPanelPluginAddMenuKey = (key: string) => {
  if (!key.startsWith(INTERACTION_PANEL_PLUGIN_ADD_MENU_KEY_PREFIX)) return undefined
  const payload = key.slice(INTERACTION_PANEL_PLUGIN_ADD_MENU_KEY_PREFIX.length)
  const [scope, id] = payload.split(':', 2)
  if (scope == null || scope === '' || id == null || id === '') return undefined
  return { id, scope }
}

export const toInteractionPanelMobileDebugDeviceMenuKey = (deviceId: string, deviceLabel?: string) =>
  `${INTERACTION_PANEL_MOBILE_DEBUG_DEVICE_KEY_PREFIX}${encodeURIComponent(deviceId)}${
    deviceLabel == null ? '' : `:${encodeURIComponent(deviceLabel)}`
  }`

export const parseInteractionPanelMobileDebugDeviceMenuKey = (key: string) => {
  if (!key.startsWith(INTERACTION_PANEL_MOBILE_DEBUG_DEVICE_KEY_PREFIX)) return undefined
  const payload = key.slice(INTERACTION_PANEL_MOBILE_DEBUG_DEVICE_KEY_PREFIX.length)
  const [deviceId, deviceLabel] = payload.split(':', 2)
  return {
    id: decodeURIComponent(deviceId),
    label: deviceLabel == null ? undefined : decodeURIComponent(deviceLabel)
  }
}

export const renderInteractionPanelSubmenuExpandIcon = () => (
  <span className='material-symbols-rounded nav-menu-submenu-chevron'>
    keyboard_arrow_right
  </span>
)

const renderMenuIcon = (icon: string) =>
  <span className='material-symbols-rounded chat-interaction-panel__menu-icon'>{icon}</span>

const renderSelectionMenuIcon = (isSelected: boolean) =>
  isSelected
    ? <span className='material-symbols-rounded nav-menu-icon active'>check</span>
    : <div className='nav-menu-icon-placeholder' />

const renderAddMenuLabel = (label: string) => (
  <span className='chat-interaction-panel__add-menu-label'>{label}</span>
)

const renderAddMenuShortcut = (shortcut: string | undefined, isMac: boolean) =>
  shortcut == null || shortcut === ''
    ? undefined
    : (
      <span className='chat-interaction-panel__add-menu-shortcut'>
        {formatInteractionPanelShortcut(shortcut, isMac)}
      </span>
    )

export const buildInteractionPanelAddMenuItems = (
  t: TFunction,
  isMac: boolean,
  options: {
    canCreateSessionTab?: boolean
    includeKinds?: InteractionPanelAddMenuItemKind[]
    language?: string
    mobileDebugDevices?: InteractionPanelMobileDebugDeviceOption[]
    openResourceShortcut?: string
    pluginMenuItems?: Array<PluginContributionWorkbenchAddMenuItem & { pluginScope: string }>
    selectedMobileDebugDeviceId?: string
  } = {}
): MenuProps['items'] => {
  const shouldIncludeKind = (kind: InteractionPanelAddMenuItemKind) =>
    options.includeKinds == null || options.includeKinds.includes(kind)
  const mobileDebugDevices = options.mobileDebugDevices ?? []
  const pluginMenuItems = options.pluginMenuItems ?? []
  const pluginLanguage = options.language ?? 'en'
  const mobileDebugDeviceItems: InteractionPanelMenuItems = [
    {
      key: INTERACTION_PANEL_MOBILE_DEBUG_CONFIG_KEY,
      icon: <span className='material-symbols-rounded nav-menu-icon'>tune</span>,
      label: renderAddMenuLabel(t('chat.interactionPanel.mobileDebugConfig'))
    },
    { type: 'divider' },
    ...(mobileDebugDevices.length === 0
      ? [{
        key: INTERACTION_PANEL_MOBILE_DEBUG_NO_DEVICES_KEY,
        icon: <span className='material-symbols-rounded nav-menu-icon'>tune</span>,
        label: renderAddMenuLabel(t('chat.interactionPanel.mobileDebugNoKnownDevices'))
      }]
      : mobileDebugDevices.map(device => ({
        key: toInteractionPanelMobileDebugDeviceMenuKey(device.id, device.label),
        icon: renderSelectionMenuIcon(device.id === options.selectedMobileDebugDeviceId),
        label: renderAddMenuLabel(device.label)
      })))
  ]
  const openResourceShortcut = options.openResourceShortcut ?? INTERACTION_PANEL_OPEN_FILE_SHORTCUT

  const builtInItems: InteractionPanelMenuItems = [
    ...(shouldIncludeKind('resource')
      ? [{
        extra: renderAddMenuShortcut(openResourceShortcut, isMac),
        key: 'resource',
        icon: <span className='material-symbols-rounded'>pageview</span>,
        label: renderAddMenuLabel(t('chat.interactionPanel.openResource'))
      }]
      : []),
    ...(shouldIncludeKind('terminal')
      ? [{
        extra: renderAddMenuShortcut(INTERACTION_PANEL_NEW_TERMINAL_SHORTCUT, isMac),
        key: 'terminal',
        icon: <span className='material-symbols-rounded'>terminal</span>,
        label: renderAddMenuLabel(t('chat.terminal.addSession'))
      }]
      : []),
    ...(options.canCreateSessionTab === false || !shouldIncludeKind('session')
      ? []
      : [{
        key: 'session',
        icon: <span className='material-symbols-rounded'>chat</span>,
        label: renderAddMenuLabel(t('chat.interactionPanel.addSession'))
      }]),
    ...(shouldIncludeKind('iframe')
      ? [{
        extra: renderAddMenuShortcut(INTERACTION_PANEL_NEW_IFRAME_SHORTCUT, isMac),
        key: 'iframe',
        icon: <span className='material-symbols-rounded'>language</span>,
        label: renderAddMenuLabel(t('chat.interactionPanel.addIframe'))
      }]
      : []),
    ...(shouldIncludeKind('page-debugger')
      ? [{
        key: 'page-debugger',
        icon: <span className='material-symbols-rounded'>data_object</span>,
        label: renderAddMenuLabel(t('chat.interactionPanel.pageDebuggerListTitle'))
      }]
      : []),
    ...(shouldIncludeKind('mobile-debug')
      ? [{
        key: 'mobile-debug',
        children: mobileDebugDeviceItems,
        icon: <span className='material-symbols-rounded'>phonelink_setup</span>,
        label: renderAddMenuLabel(t('chat.interactionPanel.addMobileDebug'))
      }]
      : [])
  ]

  if (pluginMenuItems.length <= 0 || !shouldIncludeKind('plugin')) return builtInItems

  return [
    ...builtInItems,
    { type: 'divider' },
    ...pluginMenuItems.map(item => ({
      key: toInteractionPanelPluginAddMenuKey(item.pluginScope, item.id),
      icon: <span className='material-symbols-rounded'>{item.icon ?? 'layers'}</span>,
      label: renderAddMenuLabel(resolvePluginContributionText(item, 'title', pluginLanguage) ?? item.title)
    }))
  ]
}

const buildInteractionPanelTypeSpecificMenuItems = ({
  iframePage,
  onCopyText,
  onNewTerminal,
  t,
  tab
}: {
  iframePage?: InteractionPanelIframePage
  onCopyText: (text: string, successMessage: string) => void
  onNewTerminal: (shellKind?: InteractionPanelTerminalShellKind) => void
  t: TFunction
  tab: InteractionPanelTab
}): InteractionPanelMenuItems =>
  buildInteractionPanelTabContextActions({ iframePage, onCopyText, onNewTerminal, t, tab })
    .map(action => ({
      disabled: action.disabled,
      icon: renderMenuIcon(action.icon),
      key: action.key,
      label: action.label,
      onClick: action.run
    }))

export const buildInteractionPanelPinnedTabMenuItems = ({
  iframePage,
  onCopyText,
  onCloseTab,
  onEditPinnedTab,
  onNewTerminal,
  onUnpinTab,
  pinnedTab,
  t
}: {
  iframePage?: InteractionPanelIframePage
  onCopyText: (text: string, successMessage: string) => void
  onCloseTab: (tab: InteractionPanelTab) => void
  onEditPinnedTab: (tab: InteractionPanelPinnedTab) => void
  onNewTerminal: (shellKind?: InteractionPanelTerminalShellKind) => void
  onUnpinTab: (tab: InteractionPanelTab) => void
  pinnedTab: InteractionPanelPinnedTab
  t: TFunction
}): MenuProps['items'] => [
  ...buildInteractionPanelTypeSpecificMenuItems({
    iframePage,
    onCopyText,
    onNewTerminal,
    t,
    tab: pinnedTab.tab
  }),
  { type: 'divider' },
  {
    key: 'edit-pinned',
    icon: renderMenuIcon('edit'),
    label: t('chat.interactionPanel.editPinnedTab'),
    onClick: () => onEditPinnedTab(pinnedTab)
  },
  {
    key: 'unpin',
    icon: renderMenuIcon('push_pin'),
    label: t('chat.interactionPanel.unpinTab'),
    onClick: () => onUnpinTab(pinnedTab.tab)
  },
  { type: 'divider' },
  {
    key: 'close',
    icon: renderMenuIcon('close'),
    label: t('common.close'),
    onClick: () => onCloseTab(pinnedTab.tab)
  }
]
