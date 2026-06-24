import { InputNumber } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  MobileEnvironmentField,
  MobileEnvironmentFieldGrid,
  MobileEnvironmentSection
} from './InteractionPanelMobileDeviceEnvironmentLayout'
import { InteractionPanelMobileDeviceLocationMap } from './InteractionPanelMobileDeviceLocationMap'
import type { MobileEnvironmentActionRunner } from './mobile-device-environment-options'
import type { MobileLocationCoordinate } from './mobile-device-location-map'
import { useMobileEnvironmentAutoApply } from './use-mobile-environment-auto-apply'

export function InteractionPanelMobileDeviceEnvironmentLocationPanel({
  isEmulatorControlDisabled,
  runEnvironmentAction
}: {
  isEmulatorControlDisabled: boolean
  runEnvironmentAction: MobileEnvironmentActionRunner
}) {
  const { t } = useTranslation()
  const [latitude, setLatitude] = useState(37.422)
  const [longitude, setLongitude] = useState(-122.084)
  const [altitude, setAltitude] = useState(0)
  const locationAction = useMemo<DesktopMobileDeviceEnvironmentAction>(() => ({
    altitude,
    kind: 'location',
    latitude,
    longitude
  }), [altitude, latitude, longitude])
  const locationSignature = `${latitude}:${longitude}:${altitude}`
  const handleCoordinateChange = ({ latitude, longitude }: MobileLocationCoordinate) => {
    setLatitude(latitude)
    setLongitude(longitude)
  }

  useMobileEnvironmentAutoApply({
    action: locationAction,
    actionKey: 'location',
    disabled: isEmulatorControlDisabled,
    runEnvironmentAction,
    signature: locationSignature
  })

  return (
    <MobileEnvironmentSection>
      <InteractionPanelMobileDeviceLocationMap
        disabled={isEmulatorControlDisabled}
        latitude={latitude}
        longitude={longitude}
        mapTitle={t('chat.interactionPanel.mobileDebugEnvironmentGoogleMap')}
        pickerLabel={t('chat.interactionPanel.mobileDebugEnvironmentMapPicker')}
        onCoordinateChange={handleCoordinateChange}
      />
      <MobileEnvironmentFieldGrid>
        <MobileEnvironmentField label={t('chat.interactionPanel.mobileDebugEnvironmentLatitude')}>
          <InputNumber
            value={latitude}
            min={-90}
            max={90}
            step={0.000001}
            disabled={isEmulatorControlDisabled}
            onChange={value => setLatitude(typeof value === 'number' ? value : 37.422)}
          />
        </MobileEnvironmentField>
        <MobileEnvironmentField label={t('chat.interactionPanel.mobileDebugEnvironmentLongitude')}>
          <InputNumber
            value={longitude}
            min={-180}
            max={180}
            step={0.000001}
            disabled={isEmulatorControlDisabled}
            onChange={value => setLongitude(typeof value === 'number' ? value : -122.084)}
          />
        </MobileEnvironmentField>
      </MobileEnvironmentFieldGrid>
      <MobileEnvironmentField label={t('chat.interactionPanel.mobileDebugEnvironmentAltitude')}>
        <InputNumber
          value={altitude}
          min={-1000}
          max={100000}
          disabled={isEmulatorControlDisabled}
          onChange={value => setAltitude(typeof value === 'number' ? value : 0)}
        />
      </MobileEnvironmentField>
    </MobileEnvironmentSection>
  )
}
