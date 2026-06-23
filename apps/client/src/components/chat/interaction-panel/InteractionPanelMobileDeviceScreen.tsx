import type { CSSProperties, PointerEvent } from 'react'
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
  onRefresh,
  onSendInput,
  onToggleInspect,
  onVideoError,
  onVideoSizeChange,
  onVideoStatusChange,
  screenRatio
}: {
  deviceTitle: string
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
  onRefresh: () => void
  onSendInput: (input: DesktopMobileDeviceInputEvent) => void
  onToggleInspect: () => void
  onVideoError: (message: string) => void
  onVideoSizeChange: (size: MobileDeviceVideoPreviewSize) => void
  onVideoStatusChange: (status: MobileDeviceVideoPreviewStatus) => void
  screenRatio: number | undefined
}) {
  const { t } = useTranslation()
  const pointerStartRef = useRef<PointerDevicePoint | null>(null)
  const isVideoEnabled = videoDeviceId != null && videoStatus !== 'unavailable'
  const screen: MobileDeviceScreenDimensions | null = videoSize ?? screenshot

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
            {screen != null && hoverNode?.bounds != null && (
              <span
                className='chat-interaction-panel-mobile-debug__element-overlay is-hover'
                style={getOverlayStyle(hoverNode.bounds, screen)}
              />
            )}
            {screen != null && selectedNode?.bounds != null && (
              <span
                className='chat-interaction-panel-mobile-debug__element-overlay is-selected'
                style={getOverlayStyle(selectedNode.bounds, screen)}
              />
            )}
          </div>
        </div>
        <InteractionPanelMobileDeviceControls
          isInspecting={isInspecting}
          onRefresh={onRefresh}
          onSendInput={onSendInput}
          onToggleInspect={onToggleInspect}
        />
      </div>
    </div>
  )
}
