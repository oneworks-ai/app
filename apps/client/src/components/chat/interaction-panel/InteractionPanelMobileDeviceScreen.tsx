/* eslint-disable max-lines -- Device screen owns input forwarding, comment targets, overlays, and keyboard fallback. */

import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent
} from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InteractionPanelMobileDeviceControls } from './InteractionPanelMobileDeviceControls'
import { InteractionPanelMobileDeviceLunaHighlighter } from './InteractionPanelMobileDeviceLunaHighlighter'
import { InteractionPanelMobileDeviceVideoCanvas } from './InteractionPanelMobileDeviceVideoCanvas'
import type {
  MobileDeviceVideoPreviewSize,
  MobileDeviceVideoPreviewStatus
} from './InteractionPanelMobileDeviceVideoCanvas'
import { getElementCommentTargets } from './mobile-device-preview-utils'
import type { MobileDeviceScreenDimensions, PointerDevicePoint } from './mobile-device-preview-utils'
import { useMobileDeviceScreenPointer } from './use-mobile-device-screen-pointer'

const buildMobileDeviceMjpegStreamUrl = (deviceId: string, streamKey: number) => {
  const url = new URL('/api/mobile-debug/video.mjpeg', window.location.origin)
  url.searchParams.set('deviceId', deviceId)
  url.searchParams.set('streamKey', String(streamKey))
  return url.toString()
}

const codexBrowserCommentsRootId = 'codex-browser-sidebar-comments-root'
const elementCommentTargetSelector = '.chat-interaction-panel-mobile-debug__element-comment-target'
const iosWdaWheelInputThrottleMs = 450
const defaultWheelInputThrottleMs = 80
const draggableFloatingElementLabels = ['debug icon', 'ppe_card_mvp', 'doctor']

const isCodexBrowserCommentCaptureActive = () => {
  const commentsRoot = document.getElementById(codexBrowserCommentsRootId)
  return commentsRoot != null && getComputedStyle(commentsRoot).pointerEvents !== 'none'
}

const isFromElementCommentTarget = (target: EventTarget | null) =>
  target instanceof Element && target.closest(elementCommentTargetSelector) != null

const getElementCommentTarget = (target: EventTarget | null) =>
  target instanceof Element ? target.closest<HTMLElement>(elementCommentTargetSelector) : null

const shouldReserveElementCommentPointerEvent = (event: ReactPointerEvent<HTMLDivElement>) =>
  isFromElementCommentTarget(event.target) &&
  (isCodexBrowserCommentCaptureActive() || event.button === 2 || (event.buttons & 2) !== 0)

const shouldReserveElementCommentWheelEvent = (event: ReactWheelEvent<HTMLDivElement>) =>
  isFromElementCommentTarget(event.target) && isCodexBrowserCommentCaptureActive()

const shouldStartFloatingElementDragGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
  const target = getElementCommentTarget(event.target)
  if (target == null) return false
  const label = [
    target.dataset.nodeLabel,
    target.getAttribute('aria-label'),
    target.getAttribute('title')
  ].filter(Boolean).join(' ').toLowerCase()
  return draggableFloatingElementLabels.some(item => label.includes(item))
}

function MobileDeviceMjpegImage({
  alt,
  deviceId,
  streamKey,
  onSizeChange,
  onStatusChange,
  paused
}: {
  alt: string
  deviceId: string
  paused: boolean
  streamKey: number
  onSizeChange: (size: MobileDeviceVideoPreviewSize) => void
  onStatusChange: (status: MobileDeviceVideoPreviewStatus) => void
}) {
  const didFailRef = useRef(false)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const [frozenFrameDataUrl, setFrozenFrameDataUrl] = useState<string>()
  const [isStreamSuspended, setIsStreamSuspended] = useState(false)
  const src = buildMobileDeviceMjpegStreamUrl(deviceId, streamKey)
  const syncImageSize = useCallback(() => {
    const image = imageRef.current
    if (image == null || image.naturalWidth <= 0 || image.naturalHeight <= 0) return
    onSizeChange({ height: image.naturalHeight, width: image.naturalWidth })
  }, [onSizeChange])
  const captureFrozenFrame = useCallback(() => {
    const image = imageRef.current
    if (image == null || image.naturalWidth <= 0 || image.naturalHeight <= 0) return undefined
    try {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/jpeg', 0.72)
    } catch {
      return undefined
    }
  }, [])

  useEffect(() => {
    didFailRef.current = false
    onStatusChange('starting')
    const timer = window.setTimeout(() => {
      if (didFailRef.current) return
      syncImageSize()
      onStatusChange('active')
    }, 280)
    return () => window.clearTimeout(timer)
  }, [onStatusChange, src, syncImageSize])
  useEffect(() => {
    if (!paused) {
      setIsStreamSuspended(false)
      return
    }

    const frozenFrame = captureFrozenFrame()
    if (frozenFrame == null) return
    setFrozenFrameDataUrl(frozenFrame)
    setIsStreamSuspended(true)
  }, [captureFrozenFrame, paused])

  return (
    <>
      {paused && isStreamSuspended && frozenFrameDataUrl != null && (
        <img
          className='chat-interaction-panel-mobile-debug__video-canvas'
          draggable={false}
          src={frozenFrameDataUrl}
          alt={alt}
        />
      )}
      {!isStreamSuspended && (
        <img
          ref={imageRef}
          className='chat-interaction-panel-mobile-debug__video-canvas'
          draggable={false}
          src={src}
          alt={alt}
          onLoad={() => {
            syncImageSize()
            onStatusChange('active')
          }}
          onError={() => {
            didFailRef.current = true
            onStatusChange('unavailable')
          }}
        />
      )}
    </>
  )
}

export function InteractionPanelMobileDeviceScreen({
  deviceTitle,
  devicePlatform,
  elementScreen,
  elementTreeRoot,
  hoverNode,
  inputScreen,
  isInspecting,
  screenshot,
  selectedNode,
  videoDeviceId,
  videoStreamKey,
  videoSource,
  videoSize,
  videoStatus,
  onCancelInspect,
  onClearSelectedElement,
  onHoverElementId,
  onHoverPoint,
  onInspectElementId,
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
  devicePlatform: DesktopMobileDebugDevice['platform']
  elementScreen: DesktopMobileElementBounds | undefined
  elementTreeRoot: DesktopMobileElementNode | undefined
  hoverNode: DesktopMobileElementNode | undefined
  inputScreen: MobileDeviceScreenDimensions | undefined
  isInspecting: boolean
  screenshot: DesktopMobileDeviceScreenshotResponse | null
  selectedNode: DesktopMobileElementNode | undefined
  videoDeviceId: string | undefined
  videoStreamKey: number
  videoSource: DesktopMobileDebugDevice['videoSource']
  videoSize: MobileDeviceVideoPreviewSize | undefined
  videoStatus: MobileDeviceVideoPreviewStatus
  onCancelInspect: () => void
  onClearSelectedElement: () => void
  onHoverElementId: (nodeId: string) => void
  onHoverPoint: (point: PointerDevicePoint) => void
  onInspectElementId: (nodeId: string) => void
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
  const isMjpegVideoEnabled = videoDeviceId != null && videoSource === 'mjpeg' && videoStatus !== 'unavailable'
  const isScrcpyVideoEnabled = videoDeviceId != null &&
    (videoSource == null || videoSource === 'scrcpy') &&
    videoStatus !== 'unavailable'
  const isVideoEnabled = isMjpegVideoEnabled || isScrcpyVideoEnabled
  const screen: MobileDeviceScreenDimensions | null = videoSize ?? screenshot
  const pointerScreen: MobileDeviceScreenDimensions | null = inputScreen ?? screen
  const overlayScreen: MobileDeviceScreenDimensions | null = elementScreen ?? screen
  const [isMjpegPausedForInput, setIsMjpegPausedForInput] = useState(false)
  const screenElementRef = useRef<HTMLDivElement | null>(null)
  const mjpegInputPauseTimerRef = useRef<number>()
  const elementCommentTargets = useMemo(
    () => getElementCommentTargets(elementTreeRoot, overlayScreen),
    [elementTreeRoot, overlayScreen]
  )
  const pauseMjpegForInput = useCallback((durationMs: number) => {
    if (!isMjpegVideoEnabled) return
    if (mjpegInputPauseTimerRef.current != null) window.clearTimeout(mjpegInputPauseTimerRef.current)
    setIsMjpegPausedForInput(true)
    mjpegInputPauseTimerRef.current = window.setTimeout(() => {
      mjpegInputPauseTimerRef.current = undefined
      setIsMjpegPausedForInput(false)
    }, durationMs)
  }, [isMjpegVideoEnabled])
  useEffect(() => () => {
    if (mjpegInputPauseTimerRef.current != null) window.clearTimeout(mjpegInputPauseTimerRef.current)
  }, [])
  useEffect(() => {
    if (!isInspecting) return
    screenElementRef.current?.focus({ preventScroll: true })
  }, [isInspecting])
  const inspectElementCommentTarget = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isInspecting) return false
    const nodeId = getElementCommentTarget(event.target)?.dataset.nodeId
    if (nodeId == null || nodeId === '') return false
    event.preventDefault()
    event.stopPropagation()
    onInspectElementId(nodeId)
    return true
  }, [isInspecting, onInspectElementId])
  const hoverElementCommentTarget = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isInspecting) return false
    const nodeId = getElementCommentTarget(event.target)?.dataset.nodeId
    if (nodeId == null || nodeId === '') return false
    event.stopPropagation()
    onHoverElementId(nodeId)
    return true
  }, [isInspecting, onHoverElementId])
  const {
    handlePointerCancel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
    isTouching
  } = useMobileDeviceScreenPointer({
    canSendTouchGesture: (isScrcpyVideoEnabled || isMjpegVideoEnabled) && videoStatus === 'active',
    canStreamTouch: isScrcpyVideoEnabled && videoStatus === 'active',
    isInspecting,
    onHoverPoint,
    onInspectPoint,
    onSendInput,
    screen: pointerScreen,
    shouldStartDragGesture: shouldStartFloatingElementDragGesture,
    wheelInputThrottleMs: isMjpegVideoEnabled ? iosWdaWheelInputThrottleMs : defaultWheelInputThrottleMs
  })
  const handleScreenPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (shouldReserveElementCommentPointerEvent(event)) return
    event.currentTarget.focus({ preventScroll: true })
    if (inspectElementCommentTarget(event)) return
    pauseMjpegForInput(8000)
    if (isFromElementCommentTarget(event.target)) event.stopPropagation()
    handlePointerDown(event)
  }, [handlePointerDown, inspectElementCommentTarget, pauseMjpegForInput])
  const handleScreenPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (shouldReserveElementCommentPointerEvent(event)) return
    if (hoverElementCommentTarget(event)) return
    if (isFromElementCommentTarget(event.target)) event.stopPropagation()
    handlePointerMove(event)
  }, [handlePointerMove, hoverElementCommentTarget])
  const handleScreenPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (shouldReserveElementCommentPointerEvent(event)) return
    pauseMjpegForInput(5000)
    if (isFromElementCommentTarget(event.target)) event.stopPropagation()
    handlePointerUp(event)
  }, [handlePointerUp, pauseMjpegForInput])
  const handleScreenPointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (shouldReserveElementCommentPointerEvent(event)) return
    pauseMjpegForInput(1200)
    if (isFromElementCommentTarget(event.target)) event.stopPropagation()
    handlePointerCancel(event)
  }, [handlePointerCancel, pauseMjpegForInput])
  const handleScreenWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (shouldReserveElementCommentWheelEvent(event)) return
    pauseMjpegForInput(3000)
    if (isFromElementCommentTarget(event.target)) event.stopPropagation()
    handleWheel(event)
  }, [handleWheel, pauseMjpegForInput])
  const handleScreenKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return

    event.preventDefault()
    event.stopPropagation()
    if (isInspecting) {
      onCancelInspect()
      return
    }
    if (selectedNode != null) {
      onClearSelectedElement()
      return
    }
    if (devicePlatform === 'android') onSendInput({ key: 'back', kind: 'key' })
  }, [devicePlatform, isInspecting, onCancelInspect, onClearSelectedElement, onSendInput, selectedNode])

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
            ref={screenElementRef}
            className={[
              'chat-interaction-panel-mobile-debug__screen',
              isInspecting ? 'is-inspecting' : '',
              isTouching ? 'is-touching' : ''
            ].filter(Boolean).join(' ')}
            style={screen?.width != null && screen.height != null
              ? { aspectRatio: `${screen.width} / ${screen.height}` }
              : undefined}
            tabIndex={0}
            onKeyDown={handleScreenKeyDown}
            onPointerDownCapture={handleScreenPointerDown}
            onPointerMoveCapture={handleScreenPointerMove}
            onPointerLeave={onPointerLeave}
            onPointerUpCapture={handleScreenPointerUp}
            onPointerCancelCapture={handleScreenPointerCancel}
            onLostPointerCapture={handleScreenPointerCancel}
            onWheelCapture={handleScreenWheel}
          >
            {isScrcpyVideoEnabled && (
              <InteractionPanelMobileDeviceVideoCanvas
                key={`${videoDeviceId}:${videoStreamKey}`}
                deviceId={videoDeviceId}
                onError={onVideoError}
                onSizeChange={onVideoSizeChange}
                onStatusChange={onVideoStatusChange}
              />
            )}
            {isMjpegVideoEnabled && (
              <MobileDeviceMjpegImage
                key={`${videoDeviceId}:${videoStreamKey}`}
                alt={t('chat.interactionPanel.mobileDebugPreviewAlt')}
                deviceId={videoDeviceId}
                paused={isMjpegPausedForInput}
                streamKey={videoStreamKey}
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
            {elementCommentTargets.map((target, index) => (
              <span
                key={`${target.node.id}:${index}`}
                aria-label={target.ariaLabel}
                className='element-overlay chat-interaction-panel-mobile-debug__element-comment-target is-comment-target'
                data-node-id={target.node.id}
                data-node-label={target.node.label ?? ''}
                data-node-source={target.node.source}
                data-node-type={target.node.type}
                role='button'
                style={target.style}
                title={target.title}
              />
            ))}
            <InteractionPanelMobileDeviceLunaHighlighter
              hoverNode={hoverNode}
              screen={overlayScreen}
              selectedNode={selectedNode}
            />
          </div>
        </div>
        <InteractionPanelMobileDeviceControls onSendInput={onSendInput} />
      </div>
    </div>
  )
}
