import type { CSSProperties, PointerEvent, WheelEvent } from 'react'
import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { InteractionPanelMobileDeviceControls } from './InteractionPanelMobileDeviceControls'
import { InteractionPanelMobileDeviceVideoCanvas } from './InteractionPanelMobileDeviceVideoCanvas'
import type {
  MobileDeviceVideoPreviewSize,
  MobileDeviceVideoPreviewStatus
} from './InteractionPanelMobileDeviceVideoCanvas'
import { getOverlayStyle, toPointerDevicePoint } from './mobile-device-preview-utils'
import type { MobileDeviceScreenDimensions, PointerDevicePoint } from './mobile-device-preview-utils'

export function InteractionPanelMobileDeviceScreen({
  deviceTitle,
  elementScreen,
  hoverNode,
  isInspecting,
  screenshot,
  selectedNode,
  videoDeviceId,
  videoStreamKey,
  videoSize,
  videoStatus,
  onHoverPoint,
  onInspectPoint,
  onPointerLeave,
  onSendInput,
  onVideoError,
  onVideoSizeChange,
  onVideoStatusChange,
  screenRatio
}: {
  deviceTitle: string
  elementScreen: DesktopMobileElementBounds | undefined
  hoverNode: DesktopMobileElementNode | undefined
  isInspecting: boolean
  screenshot: DesktopMobileDeviceScreenshotResponse | null
  selectedNode: DesktopMobileElementNode | undefined
  videoDeviceId: string | undefined
  videoStreamKey: number
  videoSize: MobileDeviceVideoPreviewSize | undefined
  videoStatus: MobileDeviceVideoPreviewStatus
  onHoverPoint: (point: PointerDevicePoint) => void
  onInspectPoint: (point: PointerDevicePoint) => void
  onPointerLeave: () => void
  onSendInput: (input: DesktopMobileDeviceInputEvent) => void
  onVideoError: (message: string) => void
  onVideoSizeChange: (size: MobileDeviceVideoPreviewSize) => void
  onVideoStatusChange: (status: MobileDeviceVideoPreviewStatus) => void
  screenRatio: number | undefined
}) {
  const { t } = useTranslation()
  const pointerStartRef = useRef<PointerDevicePoint | null>(null)
  const isVideoEnabled = videoDeviceId != null && videoStatus !== 'unavailable'
  const screen: MobileDeviceScreenDimensions | null = videoSize ?? screenshot
  const overlayScreen: MobileDeviceScreenDimensions | null = elementScreen ?? screen

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (screen == null) return
    pointerStartRef.current = toPointerDevicePoint(event, screen)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is best effort for embedded webviews.
    }
  }, [screen])

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (screen == null || !isInspecting) return
    onHoverPoint(toPointerDevicePoint(event, screen))
  }, [isInspecting, onHoverPoint, screen])

  const handlePointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (screen == null) return
    const startPoint = pointerStartRef.current
    pointerStartRef.current = null
    if (startPoint == null) return

    const endPoint = toPointerDevicePoint(event, screen)
    if (isInspecting) {
      onInspectPoint(endPoint)
      return
    }

    const deltaX = endPoint.x - startPoint.x
    const deltaY = endPoint.y - startPoint.y
    if (Math.hypot(deltaX, deltaY) > 10) {
      onSendInput({
        durationMs: 240,
        endX: endPoint.x,
        endY: endPoint.y,
        kind: 'swipe',
        x: startPoint.x,
        y: startPoint.y
      })
      return
    }
    onSendInput({ kind: 'tap', x: endPoint.x, y: endPoint.y })
  }, [isInspecting, onInspectPoint, onSendInput, screen])

  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (screen == null || isInspecting) return
    event.preventDefault()
    const point = toPointerDevicePoint(event, screen)
    onSendInput({
      kind: 'scroll',
      scrollX: -Math.max(-1, Math.min(1, event.deltaX / 500)),
      scrollY: -Math.max(-1, Math.min(1, event.deltaY / 500)),
      x: point.x,
      y: point.y
    })
  }, [isInspecting, onSendInput, screen])

  return (
    <div
      className='chat-interaction-panel-mobile-debug__screen-column'
      style={screenRatio == null
        ? undefined
        : { '--mobile-debug-screen-ratio': String(screenRatio) } as CSSProperties}
    >
      <div className='chat-interaction-panel-mobile-debug__device-window'>
        <div className='chat-interaction-panel-mobile-debug__device-shell'>
          <div className='chat-interaction-panel-mobile-debug__device-titlebar' title={deviceTitle}>
            {deviceTitle}
          </div>
          <div
            className={`chat-interaction-panel-mobile-debug__screen ${isInspecting ? 'is-inspecting' : ''}`}
            style={screen?.width != null && screen.height != null
              ? { aspectRatio: `${screen.width} / ${screen.height}` }
              : undefined}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerLeave={onPointerLeave}
            onPointerUp={handlePointerUp}
            onWheel={handleWheel}
          >
            {isVideoEnabled && (
              <InteractionPanelMobileDeviceVideoCanvas
                key={`${videoDeviceId}:${videoStreamKey}`}
                deviceId={videoDeviceId}
                onError={onVideoError}
                onSizeChange={onVideoSizeChange}
                onStatusChange={onVideoStatusChange}
              />
            )}
            {!isVideoEnabled && screenshot != null && (
              <>
                <img
                  draggable={false}
                  src={screenshot.imageDataUrl}
                  alt={t('chat.interactionPanel.mobileDebugPreviewAlt')}
                />
              </>
            )}
            {(screen == null || (isVideoEnabled && videoStatus !== 'active')) && (
              <div className='chat-interaction-panel-mobile-debug__screen-placeholder'>
                {t('chat.interactionPanel.mobileDebugPreviewLoading')}
              </div>
            )}
            {overlayScreen != null && hoverNode?.bounds != null && (
              <span
                className='chat-interaction-panel-mobile-debug__element-overlay is-hover'
                style={getOverlayStyle(hoverNode.bounds, overlayScreen)}
              />
            )}
            {overlayScreen != null && selectedNode?.bounds != null && (
              <span
                className='chat-interaction-panel-mobile-debug__element-overlay is-selected'
                style={getOverlayStyle(selectedNode.bounds, overlayScreen)}
              />
            )}
          </div>
        </div>
        <InteractionPanelMobileDeviceControls
          onSendInput={onSendInput}
        />
      </div>
    </div>
  )
}
