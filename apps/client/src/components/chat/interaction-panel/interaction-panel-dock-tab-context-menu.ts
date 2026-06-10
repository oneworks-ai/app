import type { TFunction } from 'i18next'
import type { KeyboardEvent } from 'react'
import { createElement } from 'react'

import type { BuiltInContextMenuItem, IContextMenuItemComponentProps, ReactContextMenuItemConfig } from 'dockview'

import type { InteractionPanelIframePage } from './InteractionPanelIframeView'
import type { InteractionPanelPinnedTab } from './interaction-panel-pinned-tabs'
import { buildInteractionPanelTabContextActions } from './interaction-panel-tab-context-actions'
import type { InteractionPanelTerminalShellKind } from './interaction-panel-tab-context-actions'
import type { InteractionPanelTabCloseScope } from './interaction-panel-tab-groups'
import type { InteractionPanelTab } from './interaction-panel-tabs'

type InteractionPanelDockContextMenuEntry = BuiltInContextMenuItem | ReactContextMenuItemConfig

interface InteractionPanelDockContextMenuItemProps {
  disabled?: boolean
  icon: string
  label: string
  onSelect: () => void
}

const InteractionPanelDockContextMenuItem = ({ close, componentProps }: IContextMenuItemComponentProps) => {
  const { disabled = false, icon, label, onSelect } = componentProps as InteractionPanelDockContextMenuItemProps
  const selectItem = () => {
    if (disabled) return
    onSelect()
    close()
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    selectItem()
  }

  return createElement(
    'div',
    {
      'aria-disabled': disabled,
      className: [
        'dv-context-menu-item',
        'chat-interaction-panel__dock-context-menu-item',
        disabled ? 'dv-context-menu-item--disabled is-disabled' : ''
      ]
        .filter(Boolean)
        .join(' '),
      onClick: selectItem,
      onKeyDown: handleKeyDown,
      role: 'menuitem',
      tabIndex: disabled ? undefined : 0
    },
    createElement('span', { className: 'material-symbols-rounded chat-interaction-panel__menu-icon' }, icon),
    createElement('span', { className: 'chat-interaction-panel__dock-context-menu-label' }, label)
  )
}

const createDockContextMenuItem = (
  props: InteractionPanelDockContextMenuItemProps
): ReactContextMenuItemConfig => ({
  component: InteractionPanelDockContextMenuItem,
  componentProps: props
})

const buildTypeSpecificMenuItems = ({
  iframePage,
  onCopyText,
  onNewTerminal,
  t,
  tab,
  workspaceRootPath
}: {
  iframePage?: InteractionPanelIframePage
  onCopyText: (text: string, successMessage: string) => void
  onNewTerminal: (shellKind?: InteractionPanelTerminalShellKind) => void
  t: TFunction
  tab: InteractionPanelTab
  workspaceRootPath?: string
}): ReactContextMenuItemConfig[] =>
  buildInteractionPanelTabContextActions({ iframePage, onCopyText, onNewTerminal, t, tab, workspaceRootPath })
    .map(action =>
      createDockContextMenuItem({
        disabled: action.disabled,
        icon: action.icon,
        label: action.label,
        onSelect: action.run
      })
    )

export const buildInteractionPanelDockTabContextMenuItems = ({
  allTabs,
  canPinMoreTabs,
  iframePage,
  onCopyText,
  onEditPinnedTab,
  onCloseTabGroup,
  onNewTerminal,
  onPinTab,
  onUnpinTab,
  pinnedTab,
  t,
  tab,
  workspaceRootPath
}: {
  allTabs: InteractionPanelTab[]
  canPinMoreTabs: boolean
  iframePage?: InteractionPanelIframePage
  onCopyText: (text: string, successMessage: string) => void
  onCloseTabGroup: (tab: InteractionPanelTab, scope: InteractionPanelTabCloseScope) => void
  onEditPinnedTab: (tab: InteractionPanelPinnedTab) => void
  onNewTerminal: (shellKind?: InteractionPanelTerminalShellKind) => void
  onPinTab: (tab: InteractionPanelTab) => void
  onUnpinTab: (tab: InteractionPanelTab) => void
  pinnedTab?: InteractionPanelPinnedTab
  t: TFunction
  tab?: InteractionPanelTab
  workspaceRootPath?: string
}): InteractionPanelDockContextMenuEntry[] => {
  const items: InteractionPanelDockContextMenuEntry[] = []

  if (tab != null) {
    items.push(
      ...buildTypeSpecificMenuItems({
        iframePage,
        onCopyText,
        onNewTerminal,
        t,
        tab,
        workspaceRootPath
      }),
      'separator'
    )
  }

  if (tab != null && pinnedTab != null) {
    items.push(
      createDockContextMenuItem({
        icon: 'edit',
        label: t('chat.interactionPanel.editPinnedTab'),
        onSelect: () => onEditPinnedTab(pinnedTab)
      }),
      createDockContextMenuItem({
        icon: 'push_pin',
        label: t('chat.interactionPanel.unpinTab'),
        onSelect: () => onUnpinTab(tab)
      }),
      'separator'
    )
  } else if (tab != null) {
    items.push(
      createDockContextMenuItem({
        disabled: !canPinMoreTabs,
        icon: 'push_pin',
        label: t('chat.interactionPanel.pinTab'),
        onSelect: () => onPinTab(tab)
      }),
      'separator'
    )
  }

  if (tab != null) {
    const index = allTabs.findIndex(item => item.id === tab.id)
    items.push(
      createDockContextMenuItem({
        icon: 'close',
        label: t('common.close'),
        onSelect: () => onCloseTabGroup(tab, 'current')
      }),
      createDockContextMenuItem({
        disabled: allTabs.length <= 1,
        icon: 'tab_close_right',
        label: t('chat.workspaceFileCloseOthers'),
        onSelect: () => onCloseTabGroup(tab, 'others')
      }),
      createDockContextMenuItem({
        disabled: index < 0 || index >= allTabs.length - 1,
        icon: 'low_priority',
        label: t('chat.workspaceFileCloseRight'),
        onSelect: () => onCloseTabGroup(tab, 'right')
      }),
      createDockContextMenuItem({
        icon: 'cancel_presentation',
        label: t('chat.workspaceFileCloseAll'),
        onSelect: () => onCloseTabGroup(tab, 'all')
      })
    )
  }

  return items
}
