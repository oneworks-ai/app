import { Button, Segmented, Select, Slider } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  MobileEnvironmentActions,
  MobileEnvironmentField,
  MobileEnvironmentSection
} from './InteractionPanelMobileDeviceEnvironmentLayout'
import {
  batteryHealthValues,
  batteryStatuses,
  chargerConnections
} from './mobile-device-environment-options'
import type { MobileEnvironmentActionRunner } from './mobile-device-environment-options'
import { useMobileEnvironmentAutoApply } from './use-mobile-environment-auto-apply'

export function InteractionPanelMobileDeviceEnvironmentBatteryPanel({
  isBusy,
  pendingActionKey,
  runEnvironmentAction
}: {
  isBusy: boolean
  pendingActionKey: string | null
  runEnvironmentAction: MobileEnvironmentActionRunner
}) {
  const { t } = useTranslation()
  const [level, setLevel] = useState(80)
  const [charger, setCharger] = useState<DesktopMobileDeviceChargerConnection>('ac')
  const [status, setStatus] = useState<DesktopMobileDeviceBatteryStatus>('charging')
  const [health, setHealth] = useState<DesktopMobileDeviceBatteryHealth>('good')
  const optionLabel = (group: string, value: string) =>
    t(`chat.interactionPanel.mobileDebugEnvironmentOptions.${group}.${value}`)
  const buildOptions = <T extends string>(group: string, values: T[]) =>
    values.map(value => ({ label: optionLabel(group, value), value }))
  const batteryAction = useMemo<DesktopMobileDeviceEnvironmentAction>(() => ({
    charger,
    health,
    kind: 'battery',
    level,
    status
  }), [charger, health, level, status])
  const batterySignature = `${level}:${charger}:${status}:${health}`

  useMobileEnvironmentAutoApply({
    action: batteryAction,
    actionKey: 'battery',
    disabled: isBusy,
    runEnvironmentAction,
    signature: batterySignature
  })

  return (
    <MobileEnvironmentSection>
      <MobileEnvironmentField
        label={(
          <span className='chat-interaction-panel-mobile-debug__environment-field-label-row'>
            <span>{t('chat.interactionPanel.mobileDebugEnvironmentBatteryLevel')}</span>
            <span>{level}%</span>
          </span>
        )}
      >
        <Slider
          min={0}
          max={100}
          tooltip={{ formatter: value => `${value ?? 0}%` }}
          value={level}
          disabled={isBusy}
          onChange={value => setLevel(typeof value === 'number' ? value : 80)}
        />
      </MobileEnvironmentField>
      <MobileEnvironmentField label={t('chat.interactionPanel.mobileDebugEnvironmentCharger')}>
        <Segmented
          block
          disabled={isBusy}
          options={buildOptions('charger', chargerConnections)}
          value={charger}
          onChange={value => setCharger(value as DesktopMobileDeviceChargerConnection)}
        />
      </MobileEnvironmentField>
      <MobileEnvironmentField label={t('chat.interactionPanel.mobileDebugEnvironmentBatteryStatus')}>
        <Select<DesktopMobileDeviceBatteryStatus>
          options={buildOptions('batteryStatus', batteryStatuses)}
          value={status}
          disabled={isBusy}
          onChange={setStatus}
        />
      </MobileEnvironmentField>
      <MobileEnvironmentField label={t('chat.interactionPanel.mobileDebugEnvironmentBatteryHealth')}>
        <Select<DesktopMobileDeviceBatteryHealth>
          options={buildOptions('batteryHealth', batteryHealthValues)}
          value={health}
          disabled={isBusy}
          onChange={setHealth}
        />
      </MobileEnvironmentField>
      <MobileEnvironmentActions>
        <Button
          loading={pendingActionKey === 'battery-reset'}
          disabled={isBusy && pendingActionKey !== 'battery-reset'}
          onClick={() => void runEnvironmentAction('battery-reset', { kind: 'battery', reset: true })}
        >
          {t('chat.interactionPanel.mobileDebugEnvironmentResetBattery')}
        </Button>
      </MobileEnvironmentActions>
    </MobileEnvironmentSection>
  )
}
