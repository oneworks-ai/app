import { Button, Input } from 'antd'
import type { PointerEvent } from 'react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InteractionPanelMobileDeviceControls } from './InteractionPanelMobileDeviceControls'
import { getOverlayStyle, toPointerDevicePoint } from './mobile-device-preview-utils'
import type { PointerDevicePoint } from './mobile-device-preview-utils'

export function InteractionPanelMobileDeviceScreen({
  deviceTitle,
  error,
  hoverNode,
  isInspecting,
  screenshot,
  selectedNode,
  onHoverPoint,
  onInspectPoint,
  onPointerLeave,
  onRefresh,
  onSendInput,
  onToggleInspect
}: {
  deviceTitle: string
  error: string | null
  hoverNode: DesktopMobileElementNode | undefined
  isInspecting: boolean
  screenshot: DesktopMobileDeviceScreenshotResponse | null
  selectedNode: DesktopMobileElementNode | undefined
  onHoverPoint: (point: PointerDevicePoint) => void
  onInspectPoint: (point: PointerDevicePoint) => void
  onPointerLeave: () => void
  onRefresh: () => void
  onSendInput: (input: DesktopMobileDeviceInputEvent) => void
  onToggleInspect: () => void
}) {
  const { t } = useTranslation()
  const [textInput, setTextInput] = useState('')
  const pointerStartRef = useRef<PointerDevicePoint | null>(null)

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (screenshot == null) return
    pointerStartRef.current = toPointerDevicePoint(event, screenshot)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is best effort for embedded webviews.
    }
  }, [screenshot])

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (screenshot == null || !isInspecting) return
    onHoverPoint(toPointerDevicePoint(event, screenshot))
  }, [isInspecting, onHoverPoint, screenshot])

  const handlePointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (screenshot == null) return
    const startPoint = pointerStartRef.current
    pointerStartRef.current = null
    if (startPoint == null) return

    const endPoint = toPointerDevicePoint(event, screenshot)
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
  }, [isInspecting, onInspectPoint, onSendInput, screenshot])

  const sendText = useCallback(() => {
    const trimmedText = textInput.trim()
    if (trimmedText === '') return
    onSendInput({ kind: 'text', text: trimmedText })
    setTextInput('')
  }, [onSendInput, textInput])

  return (
    <div className='chat-interaction-panel-mobile-debug__screen-column'>
      <div className='chat-interaction-panel-mobile-debug__device-window'>
        <div className='chat-interaction-panel-mobile-debug__device-shell'>
          <div className='chat-interaction-panel-mobile-debug__device-titlebar' title={deviceTitle}>
            {deviceTitle}
          </div>
          <div
            className={`chat-interaction-panel-mobile-debug__screen ${isInspecting ? 'is-inspecting' : ''}`}
            style={screenshot?.width != null && screenshot.height != null
              ? { aspectRatio: `${screenshot.width} / ${screenshot.height}` }
              : undefined}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerLeave={onPointerLeave}
            onPointerUp={handlePointerUp}
          >
            {screenshot == null
              ? <div className='chat-interaction-panel-mobile-debug__screen-placeholder'>
                {t('chat.interactionPanel.mobileDebugPreviewLoading')}
              </div>
              : (
                <>
                  <img
                    draggable={false}
                    src={screenshot.imageDataUrl}
                    alt={t('chat.interactionPanel.mobileDebugPreviewAlt')}
                  />
                  {hoverNode?.bounds != null && (
                    <span
                      className='chat-interaction-panel-mobile-debug__element-overlay is-hover'
                      style={getOverlayStyle(hoverNode.bounds, screenshot)}
                    />
                  )}
                  {selectedNode?.bounds != null && (
                    <span
                      className='chat-interaction-panel-mobile-debug__element-overlay is-selected'
                      style={getOverlayStyle(selectedNode.bounds, screenshot)}
                    />
                  )}
                </>
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
      <div className='chat-interaction-panel-mobile-debug__text-input'>
        <Input
          size='small'
          value={textInput}
          placeholder={t('chat.interactionPanel.mobileDebugTextPlaceholder')}
          prefix={<span className='material-symbols-rounded' aria-hidden='true'>text_fields</span>}
          onChange={event => setTextInput(event.target.value)}
          onPressEnter={sendText}
        />
        <Button
          type='text'
          size='small'
          title={t('chat.interactionPanel.mobileDebugSendText')}
          aria-label={t('chat.interactionPanel.mobileDebugSendText')}
          onClick={sendText}
        >
          <span className='material-symbols-rounded' aria-hidden='true'>keyboard_return</span>
        </Button>
      </div>
      {error != null && <div className='chat-interaction-panel-mobile-debug__preview-error'>{error}</div>}
    </div>
  )
}
