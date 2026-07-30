import { useTranslation } from 'react-i18next'

import { OverlayAction, OverlayPanel } from '#~/components/overlay'
import { getPermissionModeRiskLevel } from '#~/hooks/chat/use-chat-permission-mode'

import type {
  SenderToolbarData,
  SenderToolbarHandlers,
  SenderToolbarRefs,
  SenderToolbarState
} from '../../@types/sender-toolbar-types'
import { permissionModeIconMap } from '../../@utils/sender-constants'

interface PermissionModeMenuItemsProps {
  disabled?: boolean
  handlers: Pick<SenderToolbarHandlers, 'onPermissionMenuKeyDown' | 'onSelectPermissionMode'>
  permissionMode: SenderToolbarState['permissionMode']
  permissionModeOptions: SenderToolbarData['permissionModeOptions']
  refs: Pick<SenderToolbarRefs, 'permissionMenuNavigation'>
}

export function PermissionModeMenuItems({
  disabled = false,
  handlers,
  permissionMode,
  permissionModeOptions,
  refs
}: PermissionModeMenuItemsProps) {
  const { t } = useTranslation()
  const { permissionMenuNavigation } = refs
  const { onPermissionMenuKeyDown, onSelectPermissionMode } = handlers
  return (
    <>
      {permissionModeOptions.map((option) => {
        const riskLevel = getPermissionModeRiskLevel(option.value)
        return (
          <OverlayAction
            key={option.value}
            ref={permissionMenuNavigation.registerItem(option.value)}
            role='menuitemradio'
            aria-checked={permissionMode === option.value}
            disabled={disabled}
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
              <span className='sender-permission-menu__text'>
                <span className='sender-permission-menu__title'>
                  <span>{option.label}</span>
                  {riskLevel != null && (
                    <span
                      className={[
                        'sender-permission-risk-badge',
                        `sender-permission-risk-badge--${riskLevel}`
                      ].join(' ')}
                    >
                      {t(`chat.permissionModes.risk.${riskLevel}`)}
                    </span>
                  )}
                </span>
                {option.description != null && (
                  <span className='sender-permission-menu__description'>{option.description}</span>
                )}
              </span>
              {permissionMode === option.value && (
                <span className='material-symbols-rounded sender-permission-menu__check'>check</span>
              )}
            </span>
          </OverlayAction>
        )
      })}
    </>
  )
}

export function PermissionModeMenu({
  ariaLabel,
  compact,
  disabled,
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
      disabled={disabled}
      permissionMode={permissionMode}
      permissionModeOptions={permissionModeOptions}
      refs={refs}
    />
  )
  return compact
    ? <div className='sender-permission-menu' role='menu' aria-label={ariaLabel}>{items}</div>
    : <OverlayPanel className='sender-permission-menu' role='menu' aria-label={ariaLabel}>{items}</OverlayPanel>
}
