import { Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'

import type { PermissionMode, PermissionModeOption } from '#~/hooks/chat/use-chat-permission-mode'
import { getPermissionModeRiskLevel } from '#~/hooks/chat/use-chat-permission-mode'

import { permissionModeIconMap } from '../../@utils/sender-constants'

export function CollapsedPermissionModeStatus({
  permissionMode,
  selectedOption,
  transitionPending,
  onRestoreDefault
}: {
  permissionMode: PermissionMode
  selectedOption?: PermissionModeOption
  transitionPending: boolean
  onRestoreDefault: () => void
}) {
  const { t } = useTranslation()
  const riskLevel = getPermissionModeRiskLevel(permissionMode)
  const isHighRisk = riskLevel != null
  const modeLabel = t(`chat.permissionModes.${permissionMode}.label`)
  const title = isHighRisk
    ? (
      <span>
        {selectedOption?.label}
        {' · '}
        {t('chat.permissionModes.restoreDefault')}
      </span>
    )
    : selectedOption?.label ?? t('chat.referencePermission')
  const icon = (
    <span
      className={`material-symbols-rounded chat-input-header-toggle-mode-icon sender-permission-trigger__icon--${permissionMode}`}
    >
      {permissionModeIconMap[permissionMode]}
    </span>
  )

  return (
    <Tooltip title={title} placement='top' destroyOnHidden>
      {isHighRisk
        ? (
          <button
            type='button'
            className={[
              'chat-input-header-toggle-mode-indicator',
              `chat-input-header-toggle-mode-indicator--${permissionMode}`,
              'is-high-risk'
            ].join(' ')}
            aria-label={t('chat.permissionModes.highRiskStatusAndRestore', {
              mode: modeLabel,
              risk: t(`chat.permissionModes.risk.${riskLevel}`)
            })}
            aria-busy={transitionPending}
            disabled={transitionPending}
            onClick={onRestoreDefault}
          >
            {icon}
          </button>
        )
        : (
          <div
            className={`chat-input-header-toggle-mode-indicator chat-input-header-toggle-mode-indicator--${permissionMode}`}
            aria-label={modeLabel}
            aria-busy={transitionPending}
            role='status'
          >
            {icon}
          </div>
        )}
    </Tooltip>
  )
}
