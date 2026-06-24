import { Button, InputNumber } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  MobileEnvironmentActions,
  MobileEnvironmentField,
  MobileEnvironmentSection
} from './InteractionPanelMobileDeviceEnvironmentLayout'
import type { MobileEnvironmentActionRunner } from './mobile-device-environment-options'

export function InteractionPanelMobileDeviceEnvironmentFingerprintPanel({
  isEmulatorControlDisabled,
  pendingActionKey,
  runEnvironmentAction
}: {
  isEmulatorControlDisabled: boolean
  pendingActionKey: string | null
  runEnvironmentAction: MobileEnvironmentActionRunner
}) {
  const { t } = useTranslation()
  const [fingerId, setFingerId] = useState(1)

  return (
    <MobileEnvironmentSection>
      <MobileEnvironmentField label={t('chat.interactionPanel.mobileDebugEnvironmentFingerId')}>
        <InputNumber
          min={1}
          max={10}
          value={fingerId}
          onChange={value => setFingerId(typeof value === 'number' ? value : 1)}
        />
      </MobileEnvironmentField>
      <MobileEnvironmentActions>
        <Button
          type='primary'
          loading={pendingActionKey === 'fingerprint'}
          disabled={isEmulatorControlDisabled}
          onClick={() =>
            void runEnvironmentAction('fingerprint', {
              fingerId,
              kind: 'fingerprint'
            })}
        >
          {t('chat.interactionPanel.mobileDebugEnvironmentTouchFingerprint')}
        </Button>
      </MobileEnvironmentActions>
    </MobileEnvironmentSection>
  )
}
