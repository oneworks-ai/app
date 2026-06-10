/* eslint-disable max-lines */

import { useTranslation } from 'react-i18next'

import { OverlayMenu } from '#~/components/overlay'
import type { OverlayMenuActionItem, OverlayMenuItem } from '#~/components/overlay'

import type { SenderProps } from '../../@types/sender-props'
import type { SenderToolbarData, SenderToolbarHandlers, SenderToolbarState } from '../../@types/sender-toolbar-types'
import { permissionModeIconMap } from '../../@utils/sender-constants'
import { useReferenceActionsSessionTargetItem } from './use-reference-actions-session-target-item'
import {
  getReferenceActionsStatusValue,
  isReferenceActionsStatusAccountItem,
  isReferenceActionsStatusAdapterItem,
  useReferenceActionsStatusBarItems
} from './use-reference-actions-status-bar-items'
import type { ReferenceActionsStatusGitItems } from './use-reference-actions-status-git-items'
import {
  useReferenceActionsDraftStatusGitItems,
  useReferenceActionsSessionStatusGitItems
} from './use-reference-actions-status-git-items'

const permissionModeMenuKeyPrefix = 'permission-mode:'
const closedSubmenuKeys: string[] = []
const emptyStatusGitItems: ReferenceActionsStatusGitItems = { items: [], selectedKeys: [] }

interface ReferenceActionsDesktopMenuProps {
  isInlineEdit: boolean
  permissionMode: SenderToolbarState['permissionMode']
  state: Pick<
    SenderToolbarState,
    | 'adapterLocked'
    | 'isThinking'
    | 'modelUnavailable'
    | 'selectedAccount'
    | 'selectedAdapter'
    | 'showAccountSelector'
  >
  data: Pick<SenderToolbarData, 'accountOptions' | 'adapterOptions' | 'hiddenBuiltinAdapterOptions'>
  permissionModeOptions: SenderToolbarData['permissionModeOptions']
  sessionTarget?: SenderProps['sessionTarget']
  showSessionTargetInMore: boolean
  showPermissionModeInMore: boolean
  showStatusBarControlsInMore: boolean
  statusBarGitControlsInMore?: SenderProps['statusBarGitControlsInMore']
  onCloseReferenceActions: SenderToolbarHandlers['onCloseReferenceActions']
  onAccountChange: SenderToolbarHandlers['onAccountChange']
  onAdapterChange: SenderToolbarHandlers['onAdapterChange']
  onOpenContextPicker: SenderToolbarHandlers['onOpenContextPicker']
  onReferenceImageSelect: SenderToolbarHandlers['onReferenceImageSelect']
  onSelectPermissionMode: SenderToolbarHandlers['onSelectPermissionMode']
}

export function ReferenceActionsDesktopMenu(props: ReferenceActionsDesktopMenuProps) {
  const controls = props.statusBarGitControlsInMore
  if (props.showStatusBarControlsInMore && controls?.type === 'session') {
    return <ReferenceActionsDesktopMenuSessionStatusGit {...props} controls={controls} />
  }
  if (props.showStatusBarControlsInMore && controls?.type === 'draft') {
    return <ReferenceActionsDesktopMenuDraftStatusGit {...props} controls={controls} />
  }

  return <ReferenceActionsDesktopMenuContent {...props} statusGitItems={emptyStatusGitItems} />
}

function ReferenceActionsDesktopMenuSessionStatusGit({
  controls,
  ...props
}: ReferenceActionsDesktopMenuProps & {
  controls: Extract<NonNullable<SenderProps['statusBarGitControlsInMore']>, { type: 'session' }>
}) {
  const statusGitItems = useReferenceActionsSessionStatusGitItems(controls, {
    onClose: props.onCloseReferenceActions
  })
  return <ReferenceActionsDesktopMenuContent {...props} statusGitItems={statusGitItems} />
}

function ReferenceActionsDesktopMenuDraftStatusGit({
  controls,
  ...props
}: ReferenceActionsDesktopMenuProps & {
  controls: Extract<NonNullable<SenderProps['statusBarGitControlsInMore']>, { type: 'draft' }>
}) {
  const statusGitItems = useReferenceActionsDraftStatusGitItems(controls, {
    onClose: props.onCloseReferenceActions
  })
  return <ReferenceActionsDesktopMenuContent {...props} statusGitItems={statusGitItems} />
}

function ReferenceActionsDesktopMenuContent({
  isInlineEdit,
  permissionMode,
  state,
  data,
  permissionModeOptions,
  sessionTarget,
  showSessionTargetInMore,
  showPermissionModeInMore,
  showStatusBarControlsInMore,
  statusGitItems,
  onCloseReferenceActions,
  onAccountChange,
  onAdapterChange,
  onOpenContextPicker,
  onReferenceImageSelect,
  onSelectPermissionMode
}: ReferenceActionsDesktopMenuProps & {
  statusGitItems: ReferenceActionsStatusGitItems
}) {
  const { t } = useTranslation()
  const selectedPermissionOption = permissionModeOptions.find(option => option.value === permissionMode)
  const sessionTargetItem = useReferenceActionsSessionTargetItem({ sessionTarget, showSessionTargetInMore })
  const statusBarItems = useReferenceActionsStatusBarItems({
    ...state,
    ...data,
    isInlineEdit,
    showStatusBarControlsInMore
  })
  const items: OverlayMenuItem[] = [
    {
      key: 'image',
      label: t('chat.referenceImage'),
      icon: 'image'
    },
    ...(!isInlineEdit
      ? [{
        key: 'file',
        label: t('chat.referenceFile'),
        icon: 'description'
      }]
      : []),
    ...(sessionTargetItem == null ? [] : [sessionTargetItem]),
    ...(showPermissionModeInMore
      ? [{
        key: 'permission-mode',
        label: t('chat.referencePermission'),
        icon: permissionModeIconMap[permissionMode],
        trailing: selectedPermissionOption?.label == null
          ? undefined
          : <span className='reference-actions-menu-current'>{selectedPermissionOption.label}</span>,
        children: permissionModeOptions.map(option => ({
          key: `${permissionModeMenuKeyPrefix}${option.value}`,
          label: option.label,
          icon: permissionModeIconMap[option.value],
          selected: permissionMode === option.value
        }))
      }]
      : []),
    ...statusGitItems.items,
    ...statusBarItems.items
  ]

  const handleMenuItemClick = (item: OverlayMenuActionItem) => {
    if (item.onSelect != null) {
      item.onSelect()
      onCloseReferenceActions()
      return
    }

    if (item.key === 'image') {
      onCloseReferenceActions()
      onReferenceImageSelect()
      return
    }

    if (item.key === 'file') {
      onCloseReferenceActions()
      onOpenContextPicker()
      return
    }

    if (item.key.startsWith(permissionModeMenuKeyPrefix)) {
      const mode = item.key.slice(permissionModeMenuKeyPrefix.length) as SenderToolbarState['permissionMode']
      if (permissionModeOptions.some(option => option.value === mode)) {
        onSelectPermissionMode(mode)
      }
      return
    }

    if (isReferenceActionsStatusAccountItem(item.key)) {
      onAccountChange?.(getReferenceActionsStatusValue(item.key))
      onCloseReferenceActions()
      return
    }

    if (isReferenceActionsStatusAdapterItem(item.key)) {
      onAdapterChange?.(getReferenceActionsStatusValue(item.key))
      onCloseReferenceActions()
    }
  }

  return (
    <OverlayMenu
      className='reference-actions-menu-composite'
      defaultOpenKeys={closedSubmenuKeys}
      menuClassName='reference-actions-menu'
      panelClassName='reference-actions-menu-panel'
      selectedKeys={[
        `${permissionModeMenuKeyPrefix}${permissionMode}`,
        ...statusGitItems.selectedKeys,
        ...statusBarItems.selectedKeys
      ]}
      surface
      submenuTrigger='click'
      items={items}
      onItemClick={handleMenuItemClick}
    />
  )
}
