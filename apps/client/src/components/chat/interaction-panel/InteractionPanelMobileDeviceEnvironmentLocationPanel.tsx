import { InputNumber } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  MobileEnvironmentField,
  MobileEnvironmentFieldGrid,
  MobileEnvironmentSection
} from './InteractionPanelMobileDeviceEnvironmentLayout'
import type { MobileEnvironmentActionRunner } from './mobile-device-environment-options'
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
  const mapsUrl = useMemo(() => {
    const query = `${latitude.toFixed(6)},${longitude.toFixed(6)}`
    return `https://www.google.com/maps?q=${encodeURIComponent(query)}&z=15&output=embed`
  }, [latitude, longitude])

  useMobileEnvironmentAutoApply({
    action: locationAction,
    actionKey: 'location',
    disabled: isEmulatorControlDisabled,
    runEnvironmentAction,
    signature: locationSignature
  })

  return (
    <MobileEnvironmentSection>
      <div className='chat-interaction-panel-mobile-debug__environment-map'>
        <iframe
          title={t('chat.interactionPanel.mobileDebugEnvironmentGoogleMap')}
          src={mapsUrl}
          loading='lazy'
          referrerPolicy='no-referrer-when-downgrade'
        />
      </div>
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
