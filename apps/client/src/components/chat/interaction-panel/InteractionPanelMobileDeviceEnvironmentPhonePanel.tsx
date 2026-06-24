import { Button, Input, Segmented } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  MobileEnvironmentActions,
  MobileEnvironmentField,
  MobileEnvironmentSection
} from './InteractionPanelMobileDeviceEnvironmentLayout'
import { phoneActions } from './mobile-device-environment-options'
import type { MobileEnvironmentActionRunner, MobileEnvironmentPhoneAction } from './mobile-device-environment-options'

export function InteractionPanelMobileDeviceEnvironmentPhonePanel({
  isEmulatorControlDisabled,
  pendingActionKey,
  runEnvironmentAction
}: {
  isEmulatorControlDisabled: boolean
  pendingActionKey: string | null
  runEnvironmentAction: MobileEnvironmentActionRunner
}) {
  const { t } = useTranslation()
  const [phoneNumber, setPhoneNumber] = useState('5551234')
  const [phoneAction, setPhoneAction] = useState<MobileEnvironmentPhoneAction>('call')
  const [smsMessage, setSmsMessage] = useState(t('chat.interactionPanel.mobileDebugEnvironmentSmsDefaultMessage'))
  const optionLabel = (group: string, value: string) =>
    t(`chat.interactionPanel.mobileDebugEnvironmentOptions.${group}.${value}`)
  const buildOptions = <T extends string>(group: string, values: T[]) =>
    values.map(value => ({ label: optionLabel(group, value), value }))
  const isPhoneNumberEmpty = phoneNumber.trim() === ''

  return (
    <MobileEnvironmentSection>
      <MobileEnvironmentField label={t('chat.interactionPanel.mobileDebugEnvironmentPhoneNumber')}>
        <Input value={phoneNumber} onChange={event => setPhoneNumber(event.target.value)} />
      </MobileEnvironmentField>
      <MobileEnvironmentField label={t('chat.interactionPanel.mobileDebugEnvironmentPhoneAction')}>
        <Segmented
          block
          options={buildOptions('phoneAction', phoneActions)}
          value={phoneAction}
          onChange={value => setPhoneAction(value as MobileEnvironmentPhoneAction)}
        />
      </MobileEnvironmentField>
      <MobileEnvironmentActions>
        <Button
          type='primary'
          loading={pendingActionKey === 'phone'}
          disabled={isEmulatorControlDisabled || isPhoneNumberEmpty}
          onClick={() =>
            void runEnvironmentAction('phone', {
              action: phoneAction,
              kind: 'phone',
              phoneNumber
            })}
        >
          {t('chat.interactionPanel.mobileDebugEnvironmentApplyPhone')}
        </Button>
      </MobileEnvironmentActions>
      <MobileEnvironmentField label={t('chat.interactionPanel.mobileDebugEnvironmentSmsMessage')}>
        <Input.TextArea
          value={smsMessage}
          rows={3}
          maxLength={512}
          onChange={event => setSmsMessage(event.target.value)}
        />
      </MobileEnvironmentField>
      <MobileEnvironmentActions>
        <Button
          loading={pendingActionKey === 'sms'}
          disabled={isEmulatorControlDisabled || isPhoneNumberEmpty || smsMessage.trim() === ''}
          onClick={() =>
            void runEnvironmentAction('sms', {
              kind: 'sms',
              message: smsMessage,
              phoneNumber
            })}
        >
          {t('chat.interactionPanel.mobileDebugEnvironmentSendSms')}
        </Button>
      </MobileEnvironmentActions>
    </MobileEnvironmentSection>
  )
}
