import './PermissionModeControl.scss'

import { ShortcutTooltip } from '@oneworks/components/route-layout'
import { Dropdown } from 'antd'
import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { useResponsiveLayout } from '#~/hooks/use-responsive-layout'

import type {
  SenderToolbarData,
  SenderToolbarHandlers,
  SenderToolbarRefs,
  SenderToolbarState
} from '../../@types/sender-toolbar-types'
import { permissionModeIconMap } from '../../@utils/sender-constants'
import { SenderMobileSelectDrawer } from '../mobile-select-drawer/SenderMobileSelectDrawer'
import { PermissionModeMenu } from './PermissionModeMenu'

export function PermissionModeControl({
  state,
  data,
  refs,
  handlers
}: {
  state: Pick<
    SenderToolbarState,
    'showPermissionActions' | 'permissionMode' | 'canOpenReferenceActions' | 'isMac'
  >
  data: Pick<SenderToolbarData, 'permissionModeOptions' | 'composerControlShortcuts'>
  refs: Pick<SenderToolbarRefs, 'permissionMenuNavigation'>
  handlers: Pick<
    SenderToolbarHandlers,
    | 'onPermissionOpenChange'
    | 'onPermissionMenuKeyDown'
    | 'onSelectPermissionMode'
  >
}) {
  const { t } = useTranslation()
  const { isCompactLayout, isTouchInteraction } = useResponsiveLayout()
  const { showPermissionActions, permissionMode, canOpenReferenceActions, isMac } = state
  const { permissionModeOptions, composerControlShortcuts } = data
  const { permissionMenuNavigation } = refs
  const { onPermissionOpenChange, onPermissionMenuKeyDown, onSelectPermissionMode } = handlers
  const selectedPermissionOption = permissionModeOptions.find(option => option.value === permissionMode)
  const isCompactControl = isCompactLayout || isTouchInteraction

  const handleTriggerClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (!isCompactControl && canOpenReferenceActions) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    onPermissionOpenChange(true)
  }

  const focusSelectedPermission = () => {
    permissionMenuNavigation.setActiveKey(permissionMode)
    window.requestAnimationFrame(() => {
      permissionMenuNavigation.focusKey(permissionMenuNavigation.activeKey ?? permissionMode)
    })
  }

  const permissionMenu = (
    <PermissionModeMenu
      ariaLabel={t('chat.referencePermission')}
      compact={isCompactControl}
      handlers={{ onPermissionMenuKeyDown, onSelectPermissionMode }}
      permissionMode={permissionMode}
      permissionModeOptions={permissionModeOptions}
      refs={{ permissionMenuNavigation }}
    />
  )

  return (
    <>
      <Dropdown
        popupRender={() => permissionMenu}
        open={isCompactControl ? false : showPermissionActions}
        onOpenChange={(nextOpen) => {
          onPermissionOpenChange(nextOpen)
          if (nextOpen) {
            focusSelectedPermission()
          }
        }}
        placement='bottomRight'
        trigger={['click']}
        overlayClassName='sender-permission-dropdown'
        destroyOnHidden
      >
        <ShortcutTooltip
          shortcut={composerControlShortcuts.switchPermissionMode}
          isMac={isMac}
          title={t('chat.referencePermission')}
          enabled={!isCompactControl && !showPermissionActions}
        >
          <button
            type='button'
            className={[
              'sender-permission-trigger',
              `sender-permission-trigger--${permissionMode}`,
              showPermissionActions ? 'is-open' : ''
            ].filter(Boolean).join(' ')}
            aria-label={t('chat.referencePermission')}
            aria-haspopup='menu'
            aria-expanded={showPermissionActions}
            onClick={handleTriggerClick}
            onKeyDown={(event) => {
              const isActivationKey = event.key === 'Enter' || event.key === ' '
              const isOpenKey = event.key === 'ArrowDown' || event.key === 'ArrowUp'

              if (isActivationKey || isOpenKey) {
                event.preventDefault()
                event.stopPropagation()
                if (!showPermissionActions) {
                  onPermissionOpenChange(true)
                }
                focusSelectedPermission()
                return
              }

              if (event.key === 'Escape' && showPermissionActions) {
                event.preventDefault()
                event.stopPropagation()
                onPermissionOpenChange(false)
              }
            }}
          >
            <span
              className={[
                'material-symbols-rounded',
                'sender-permission-trigger__icon',
                `sender-permission-trigger__icon--${permissionMode}`
              ].join(' ')}
            >
              {permissionModeIconMap[permissionMode]}
            </span>
            <span className='sender-permission-trigger__copy'>
              <span
                className={[
                  'sender-permission-trigger__value',
                  `sender-permission-trigger__value--${permissionMode}`
                ].join(' ')}
              >
                {selectedPermissionOption?.label ?? t('chat.referencePermission')}
              </span>
            </span>
            <span className='material-symbols-rounded sender-permission-trigger__chevron'>expand_more</span>
          </button>
        </ShortcutTooltip>
      </Dropdown>
      {isCompactControl && (
        <SenderMobileSelectDrawer
          open={showPermissionActions}
          title={t('chat.referencePermission')}
          className='sender-permission-mobile-drawer'
          onClose={() => onPermissionOpenChange(false)}
        >
          {permissionMenu}
        </SenderMobileSelectDrawer>
      )}
    </>
  )
}
