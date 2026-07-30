import { ShortcutTooltip } from '@oneworks/components/route-layout'
import { useTranslation } from 'react-i18next'

import type { PermissionMode } from '#~/hooks/chat/use-chat-permission-mode'

export function PermissionModeResetButton({
  isMac,
  permissionMode,
  riskLevel,
  transitionPending,
  onRestoreDefault
}: {
  isMac: boolean
  permissionMode: PermissionMode
  riskLevel: 'critical' | 'high' | null
  transitionPending: boolean
  onRestoreDefault: () => void
}) {
  const { t } = useTranslation()
  const isHidden = riskLevel == null

  return (
    <ShortcutTooltip
      isMac={isMac}
      title={t('chat.permissionModes.restoreDefault')}
      enabled={!isHidden}
    >
      <button
        type='button'
        className={[
          'sender-permission-reset',
          `sender-permission-reset--${permissionMode}`,
          isHidden ? 'is-placeholder' : ''
        ].join(' ')}
        aria-label={isHidden ? undefined : t('chat.permissionModes.restoreDefault')}
        aria-hidden={isHidden}
        disabled={isHidden || transitionPending}
        tabIndex={isHidden || transitionPending ? -1 : 0}
        onClick={onRestoreDefault}
      >
        <span className='material-symbols-rounded'>shield</span>
      </button>
    </ShortcutTooltip>
  )
}
