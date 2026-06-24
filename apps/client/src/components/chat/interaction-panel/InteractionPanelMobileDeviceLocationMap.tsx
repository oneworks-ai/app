import type { MouseEvent } from 'react'
import { useCallback, useMemo } from 'react'

import { buildMobileLocationMapUrl, resolveMobileLocationMapClick } from './mobile-device-location-map'
import type { MobileLocationCoordinate } from './mobile-device-location-map'

export function InteractionPanelMobileDeviceLocationMap({
  disabled,
  latitude,
  longitude,
  mapTitle,
  onCoordinateChange,
  pickerLabel
}: {
  disabled: boolean
  latitude: number
  longitude: number
  mapTitle: string
  onCoordinateChange: (coordinate: MobileLocationCoordinate) => void
  pickerLabel: string
}) {
  const mapsUrl = useMemo(() => buildMobileLocationMapUrl({ latitude, longitude }), [latitude, longitude])
  const handleMapClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (event.detail === 0) return

    onCoordinateChange(resolveMobileLocationMapClick({
      clientX: event.clientX,
      clientY: event.clientY,
      latitude,
      longitude,
      rect: event.currentTarget.getBoundingClientRect()
    }))
  }, [disabled, latitude, longitude, onCoordinateChange])

  return (
    <div className='chat-interaction-panel-mobile-debug__environment-map'>
      <iframe
        title={mapTitle}
        src={mapsUrl}
        loading='lazy'
        referrerPolicy='no-referrer-when-downgrade'
      />
      <button
        type='button'
        className='chat-interaction-panel-mobile-debug__environment-map-picker'
        aria-label={pickerLabel}
        disabled={disabled}
        onClick={handleMapClick}
      >
        <span className='chat-interaction-panel-mobile-debug__environment-map-marker' aria-hidden='true'>
          <span className='material-symbols-rounded'>location_on</span>
        </span>
      </button>
    </div>
  )
}
