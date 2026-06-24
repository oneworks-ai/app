import { Select } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { MobileEnvironmentField, MobileEnvironmentSection } from './InteractionPanelMobileDeviceEnvironmentLayout'
import {
  cellularRegistrations,
  meterStatuses,
  networkDelays,
  networkSpeeds,
  signalProfiles
} from './mobile-device-environment-options'
import type { MobileEnvironmentActionRunner } from './mobile-device-environment-options'
import { useMobileEnvironmentAutoApply } from './use-mobile-environment-auto-apply'

export function InteractionPanelMobileDeviceEnvironmentCellularPanel({
  isEmulatorControlDisabled,
  runEnvironmentAction
}: {
  isEmulatorControlDisabled: boolean
  runEnvironmentAction: MobileEnvironmentActionRunner
}) {
  const { t } = useTranslation()
  const [speed, setSpeed] = useState<DesktopMobileDeviceNetworkSpeed>('lte')
  const [delay, setDelay] = useState<DesktopMobileDeviceNetworkDelay>('none')
  const [signalProfile, setSignalProfile] = useState<DesktopMobileDeviceSignalProfile>('good')
  const [voiceStatus, setVoiceStatus] = useState<DesktopMobileDeviceCellularRegistration>('home')
  const [dataStatus, setDataStatus] = useState<DesktopMobileDeviceCellularRegistration>('home')
  const [meterStatus, setMeterStatus] = useState<DesktopMobileDeviceMeterStatus>('unmetered')
  const optionLabel = (group: string, value: string) =>
    t(`chat.interactionPanel.mobileDebugEnvironmentOptions.${group}.${value}`)
  const buildOptions = <T extends string>(group: string, values: T[]) =>
    values.map(value => ({ label: optionLabel(group, value), value }))
  const cellularAction = useMemo<DesktopMobileDeviceEnvironmentAction>(() => ({
    dataStatus,
    delay,
    kind: 'cellular',
    meterStatus,
    signalProfile,
    speed,
    voiceStatus
  }), [dataStatus, delay, meterStatus, signalProfile, speed, voiceStatus])
  const cellularSignature = `${speed}:${delay}:${signalProfile}:${voiceStatus}:${dataStatus}:${meterStatus}`

  useMobileEnvironmentAutoApply({
    action: cellularAction,
    actionKey: 'cellular',
    disabled: isEmulatorControlDisabled,
    runEnvironmentAction,
    signature: cellularSignature
  })

  return (
    <MobileEnvironmentSection>
      <MobileEnvironmentField label={t('chat.interactionPanel.mobileDebugEnvironmentNetworkSpeed')}>
        <Select<DesktopMobileDeviceNetworkSpeed>
          options={buildOptions('networkSpeed', networkSpeeds)}
          value={speed}
          disabled={isEmulatorControlDisabled}
          onChange={setSpeed}
        />
      </MobileEnvironmentField>
      <MobileEnvironmentField label={t('chat.interactionPanel.mobileDebugEnvironmentNetworkDelay')}>
        <Select<DesktopMobileDeviceNetworkDelay>
          options={buildOptions('networkDelay', networkDelays)}
          value={delay}
          disabled={isEmulatorControlDisabled}
          onChange={setDelay}
        />
      </MobileEnvironmentField>
      <MobileEnvironmentField label={t('chat.interactionPanel.mobileDebugEnvironmentSignalProfile')}>
        <Select<DesktopMobileDeviceSignalProfile>
          options={buildOptions('signal', signalProfiles)}
          value={signalProfile}
          disabled={isEmulatorControlDisabled}
          onChange={setSignalProfile}
        />
      </MobileEnvironmentField>
      <MobileEnvironmentField label={t('chat.interactionPanel.mobileDebugEnvironmentVoiceStatus')}>
        <Select<DesktopMobileDeviceCellularRegistration>
          options={buildOptions('registration', cellularRegistrations)}
          value={voiceStatus}
          disabled={isEmulatorControlDisabled}
          onChange={setVoiceStatus}
        />
      </MobileEnvironmentField>
      <MobileEnvironmentField label={t('chat.interactionPanel.mobileDebugEnvironmentDataStatus')}>
        <Select<DesktopMobileDeviceCellularRegistration>
          options={buildOptions('registration', cellularRegistrations)}
          value={dataStatus}
          disabled={isEmulatorControlDisabled}
          onChange={setDataStatus}
        />
      </MobileEnvironmentField>
      <MobileEnvironmentField label={t('chat.interactionPanel.mobileDebugEnvironmentMeterStatus')}>
        <Select<DesktopMobileDeviceMeterStatus>
          options={buildOptions('meter', meterStatuses)}
          value={meterStatus}
          disabled={isEmulatorControlDisabled}
          onChange={setMeterStatus}
        />
      </MobileEnvironmentField>
    </MobileEnvironmentSection>
  )
}
