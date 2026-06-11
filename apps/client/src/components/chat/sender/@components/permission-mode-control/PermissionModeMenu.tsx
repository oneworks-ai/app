import { OverlayAction, OverlayPanel } from '#~/components/overlay'

import type {
  SenderToolbarData,
  SenderToolbarHandlers,
  SenderToolbarRefs,
  SenderToolbarState
} from '../../@types/sender-toolbar-types'
import { permissionModeIconMap } from '../../@utils/sender-constants'

interface PermissionModeMenuItemsProps {
  handlers: Pick<SenderToolbarHandlers, 'onPermissionMenuKeyDown' | 'onSelectPermissionMode'>
  permissionMode: SenderToolbarState['permissionMode']
  permissionModeOptions: SenderToolbarData['permissionModeOptions']
  refs: Pick<SenderToolbarRefs, 'permissionMenuNavigation'>
}

export function PermissionModeMenuItems({
  handlers,
  permissionMode,
  permissionModeOptions,
  refs
}: PermissionModeMenuItemsProps) {
  const { permissionMenuNavigation } = refs
  const { onPermissionMenuKeyDown, onSelectPermissionMode } = handlers
  return (
    <>
      {permissionModeOptions.map(option => (
        <OverlayAction
          key={option.value}
          ref={permissionMenuNavigation.registerItem(option.value)}
          role='menuitemradio'
          aria-checked={permissionMode === option.value}
          className={[
            'sender-permission-menu__item',
            `sender-permission-menu__item--${option.value}`,
            permissionMode === option.value ? 'is-selected' : ''
          ].filter(Boolean).join(' ')}
          onMouseEnter={() => permissionMenuNavigation.setActiveKey(option.value)}
          onFocus={() => permissionMenuNavigation.setActiveKey(option.value)}
          onKeyDown={(event) => onPermissionMenuKeyDown(event, option.value)}
          onClick={() => onSelectPermissionMode(option.value)}
        >
          <span className='sender-permission-menu__option'>
            <span
              className={[
                'material-symbols-rounded',
                'sender-permission-menu__icon',
                `sender-permission-menu__icon--${option.value}`
              ].join(' ')}
            >
              {permissionModeIconMap[option.value]}
            </span>
            <span className='sender-permission-menu__text'>{option.label}</span>
            {permissionMode === option.value && (
              <span className='material-symbols-rounded sender-permission-menu__check'>check</span>
            )}
          </span>
        </OverlayAction>
      ))}
    </>
  )
}

export function PermissionModeMenu({
  ariaLabel,
  compact,
  handlers,
  permissionMode,
  permissionModeOptions,
  refs
}: PermissionModeMenuItemsProps & {
  ariaLabel: string
  compact: boolean
}) {
  const items = (
    <PermissionModeMenuItems
      handlers={handlers}
      permissionMode={permissionMode}
      permissionModeOptions={permissionModeOptions}
      refs={refs}
    />
  )
  return compact
    ? <div className='sender-permission-menu' role='menu' aria-label={ariaLabel}>{items}</div>
    : <OverlayPanel className='sender-permission-menu' role='menu' aria-label={ariaLabel}>{items}</OverlayPanel>
}
