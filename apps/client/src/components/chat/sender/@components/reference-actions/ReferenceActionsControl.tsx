import './ReferenceActionsControl.scss'
import './ReferenceActionsOption.scss'

import { Dropdown } from 'antd'
import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { useResponsiveLayout } from '#~/hooks/use-responsive-layout'

import type { SenderProps } from '../../@types/sender-props'
import type {
  SenderToolbarData,
  SenderToolbarHandlers,
  SenderToolbarRefs,
  SenderToolbarState
} from '../../@types/sender-toolbar-types'
import { ReferenceActionsCompactMenu } from './ReferenceActionsCompactMenu'
import { ReferenceActionsDesktopMenu } from './ReferenceActionsDesktopMenu'

export function ReferenceActionsControl({
  state,
  data,
  refs,
  handlers,
  sessionTarget,
  showHeaderControlsInMore = false,
  showStatusBarControlsInMore = false,
  statusBarGitControlsInMore
}: {
  state: Pick<
    SenderToolbarState,
    | 'isInlineEdit'
    | 'adapterLocked'
    | 'canOpenReferenceActions'
    | 'isThinking'
    | 'modelUnavailable'
    | 'showReferenceActions'
    | 'permissionMode'
    | 'selectedAccount'
    | 'selectedAdapter'
    | 'showAccountSelector'
  >
  data: Pick<
    SenderToolbarData,
    'accountOptions' | 'adapterOptions' | 'hiddenBuiltinAdapterOptions' | 'permissionModeOptions'
  >
  refs: Pick<SenderToolbarRefs, 'referenceMenuNavigation' | 'permissionMenuNavigation'>
  sessionTarget?: SenderProps['sessionTarget']
  handlers: Pick<
    SenderToolbarHandlers,
    | 'onAccountChange'
    | 'onAdapterChange'
    | 'onReferenceOpenChange'
    | 'onOpenContextPicker'
    | 'onReferenceImageSelect'
    | 'onReferenceMenuKeyDown'
    | 'onPermissionMenuKeyDown'
    | 'onCloseReferenceActions'
    | 'onSelectPermissionMode'
  >
  showHeaderControlsInMore?: boolean
  showStatusBarControlsInMore?: boolean
  statusBarGitControlsInMore?: SenderProps['statusBarGitControlsInMore']
}) {
  const { t } = useTranslation()
  const { isCompactLayout, isTouchInteraction } = useResponsiveLayout()
  const { isInlineEdit, canOpenReferenceActions, showReferenceActions, permissionMode } = state
  const { permissionModeOptions } = data
  const {
    onReferenceOpenChange,
    onOpenContextPicker,
    onReferenceImageSelect,
    onSelectPermissionMode,
    onCloseReferenceActions
  } = handlers
  const isCompactControl = isCompactLayout || isTouchInteraction
  const showPermissionModeInMore = showHeaderControlsInMore && !isInlineEdit && permissionModeOptions.length > 0
  const showSessionTargetInMore = showHeaderControlsInMore && !isInlineEdit && sessionTarget != null &&
    !sessionTarget.locked && sessionTarget.disabled !== true

  const handleReferenceTriggerClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!isCompactControl && canOpenReferenceActions) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    void onReferenceOpenChange(true)
  }

  const referenceMenu = !isCompactControl && (
    <ReferenceActionsDesktopMenu
      isInlineEdit={isInlineEdit}
      permissionMode={permissionMode}
      state={state}
      data={data}
      permissionModeOptions={permissionModeOptions}
      sessionTarget={sessionTarget}
      showSessionTargetInMore={showSessionTargetInMore}
      showPermissionModeInMore={showPermissionModeInMore}
      showStatusBarControlsInMore={showStatusBarControlsInMore}
      statusBarGitControlsInMore={statusBarGitControlsInMore}
      onCloseReferenceActions={onCloseReferenceActions}
      onAccountChange={handlers.onAccountChange}
      onAdapterChange={handlers.onAdapterChange}
      onOpenContextPicker={onOpenContextPicker}
      onReferenceImageSelect={onReferenceImageSelect}
      onSelectPermissionMode={onSelectPermissionMode}
    />
  )

  return (
    <>
      <Dropdown
        menu={{ items: [] }}
        popupRender={() => referenceMenu}
        open={isCompactControl ? false : showReferenceActions}
        onOpenChange={onReferenceOpenChange}
        placement='topLeft'
        trigger={['click']}
        overlayClassName='reference-actions-dropdown'
        destroyOnHidden
      >
        <div
          className={`toolbar-btn toolbar-btn--reference ${showReferenceActions ? 'active' : ''}`.trim()}
          tabIndex={-1}
          aria-haspopup='menu'
          aria-expanded={!isCompactControl && showReferenceActions}
          onClick={handleReferenceTriggerClick}
        >
          <span className='toolbar-btn__icon-shell'>
            <span className='material-symbols-rounded'>menu</span>
          </span>
          <span className='toolbar-btn__text'>{t('chat.referenceActionsShort')}</span>
        </div>
      </Dropdown>
      {isCompactControl && (
        <ReferenceActionsCompactMenu
          open={showReferenceActions}
          isInlineEdit={isInlineEdit}
          permissionMode={permissionMode}
          permissionModeOptions={permissionModeOptions}
          refs={refs}
          handlers={handlers}
          showPermissionModeInMore={showPermissionModeInMore}
          onClose={() => onReferenceOpenChange(false)}
        />
      )}
    </>
  )
}
