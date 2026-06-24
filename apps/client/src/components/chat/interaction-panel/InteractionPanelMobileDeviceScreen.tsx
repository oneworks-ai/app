import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { InteractionPanelMobileDeviceControls } from './InteractionPanelMobileDeviceControls'
import { InteractionPanelMobileDeviceVideoCanvas } from './InteractionPanelMobileDeviceVideoCanvas'
import type {
  MobileDeviceVideoPreviewSize,
  MobileDeviceVideoPreviewStatus
} from './InteractionPanelMobileDeviceVideoCanvas'
import { getOverlayStyle } from './mobile-device-preview-utils'
import type { MobileDeviceScreenDimensions, PointerDevicePoint } from './mobile-device-preview-utils'
import { useMobileDeviceScreenPointer } from './use-mobile-device-screen-pointer'

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
  screenRatio,
  showDeviceTitlebar = true
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
  showDeviceTitlebar?: boolean
}) {
  const { t } = useTranslation()
  const isVideoEnabled = videoDeviceId != null && videoStatus !== 'unavailable'
  const screen: MobileDeviceScreenDimensions | null = videoSize ?? screenshot
  const overlayScreen: MobileDeviceScreenDimensions | null = elementScreen ?? screen
  const {
    handlePointerCancel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
    isTouching
  } = useMobileDeviceScreenPointer({
    canStreamTouch: isVideoEnabled && videoStatus === 'active',
    isInspecting,
    onHoverPoint,
    onInspectPoint,
    onSendInput,
    screen
  })

  return (
    <div
      className='chat-interaction-panel-mobile-debug__screen-column'
      style={screenRatio == null
        ? undefined
        : { '--mobile-debug-screen-ratio': String(screenRatio) } as CSSProperties}
    >
      <div className='chat-interaction-panel-mobile-debug__device-window' aria-label={deviceTitle}>
        <div className='chat-interaction-panel-mobile-debug__device-shell'>
          {showDeviceTitlebar && (
            <div className='chat-interaction-panel-mobile-debug__device-titlebar' title={deviceTitle}>
              {deviceTitle}
            </div>
          )}
          <div
            className={[
              'chat-interaction-panel-mobile-debug__screen',
              isInspecting ? 'is-inspecting' : '',
              isTouching ? 'is-touching' : ''
            ].filter(Boolean).join(' ')}
            style={screen?.width != null && screen.height != null
              ? { aspectRatio: `${screen.width} / ${screen.height}` }
              : undefined}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerLeave={onPointerLeave}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
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
              <img
                draggable={false}
                src={screenshot.imageDataUrl}
                alt={t('chat.interactionPanel.mobileDebugPreviewAlt')}
              />
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
        <InteractionPanelMobileDeviceControls onSendInput={onSendInput} />
      </div>
    </div>
  )
}
