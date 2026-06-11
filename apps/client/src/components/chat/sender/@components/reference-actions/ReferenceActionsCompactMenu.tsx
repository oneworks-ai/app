import { useTranslation } from 'react-i18next'

import { OverlayAction } from '#~/components/overlay'

import type {
  SenderToolbarData,
  SenderToolbarHandlers,
  SenderToolbarRefs,
  SenderToolbarState
} from '../../@types/sender-toolbar-types'
import { SenderMobileSelectDrawer } from '../mobile-select-drawer/SenderMobileSelectDrawer'
import { PermissionModeMenuItems } from '../permission-mode-control/PermissionModeMenu'

export function ReferenceActionsCompactMenu({
  isInlineEdit,
  open,
  permissionMode,
  permissionModeOptions,
  refs,
  handlers,
  showPermissionModeInMore,
  onClose
}: {
  isInlineEdit: boolean
  open: boolean
  permissionMode: SenderToolbarState['permissionMode']
  permissionModeOptions: SenderToolbarData['permissionModeOptions']
  refs: Pick<SenderToolbarRefs, 'referenceMenuNavigation' | 'permissionMenuNavigation'>
  handlers: Pick<
    SenderToolbarHandlers,
    | 'onReferenceOpenChange'
    | 'onOpenContextPicker'
    | 'onReferenceImageSelect'
    | 'onReferenceMenuKeyDown'
    | 'onPermissionMenuKeyDown'
    | 'onCloseReferenceActions'
    | 'onSelectPermissionMode'
  >
  showPermissionModeInMore: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { referenceMenuNavigation, permissionMenuNavigation } = refs
  const {
    onOpenContextPicker,
    onReferenceImageSelect,
    onReferenceMenuKeyDown,
    onPermissionMenuKeyDown,
    onSelectPermissionMode,
    onCloseReferenceActions
  } = handlers
  const menu = (
    <div className='reference-actions-menu' role='menu' aria-label={t('chat.referenceActionsShort')}>
      <OverlayAction
        ref={referenceMenuNavigation.registerItem('image')}
        role='menuitem'
        className='reference-actions-menu-item'
        onMouseEnter={() => referenceMenuNavigation.setActiveKey('image')}
        onFocus={() => referenceMenuNavigation.setActiveKey('image')}
        onKeyDown={(event) => onReferenceMenuKeyDown(event, 'image')}
        onClick={() => {
          onCloseReferenceActions()
          onReferenceImageSelect()
        }}
      >
        <span className='reference-action-option'>
          <span className='material-symbols-rounded reference-action-option__icon'>image</span>
          <span className='reference-action-option__label'>{t('chat.referenceImage')}</span>
        </span>
      </OverlayAction>
      {!isInlineEdit && (
        <OverlayAction
          ref={referenceMenuNavigation.registerItem('file')}
          role='menuitem'
          className='reference-actions-menu-item'
          onMouseEnter={() => referenceMenuNavigation.setActiveKey('file')}
          onFocus={() => referenceMenuNavigation.setActiveKey('file')}
          onKeyDown={(event) => onReferenceMenuKeyDown(event, 'file')}
          onClick={() => {
            onCloseReferenceActions()
            onOpenContextPicker()
          }}
        >
          <span className='reference-action-option'>
            <span className='material-symbols-rounded reference-action-option__icon'>description</span>
            <span className='reference-action-option__label'>{t('chat.referenceFile')}</span>
          </span>
        </OverlayAction>
      )}
      {showPermissionModeInMore && (
        <>
          <div className='reference-actions-menu-divider' role='separator' />
          <div className='reference-actions-menu-label' role='presentation'>
            {t('chat.referencePermission')}
          </div>
          <PermissionModeMenuItems
            handlers={{ onPermissionMenuKeyDown, onSelectPermissionMode }}
            permissionMode={permissionMode}
            permissionModeOptions={permissionModeOptions}
            refs={{ permissionMenuNavigation }}
          />
        </>
      )}
    </div>
  )

  return (
    <SenderMobileSelectDrawer
      open={open}
      title={t('chat.referenceActionsShort')}
      className='reference-actions-mobile-drawer'
      onClose={onClose}
    >
      {menu}
    </SenderMobileSelectDrawer>
  )
}
