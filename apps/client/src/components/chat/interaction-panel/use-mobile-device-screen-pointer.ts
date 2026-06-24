import type { PointerEvent, WheelEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { toPointerDevicePoint } from './mobile-device-preview-utils'
import type { MobileDeviceScreenDimensions, PointerDevicePoint } from './mobile-device-preview-utils'

const liveTouchMoveIntervalMs = 32
const swipeThresholdPx = 10

export const useMobileDeviceScreenPointer = ({
  canStreamTouch,
  isInspecting,
  onHoverPoint,
  onInspectPoint,
  onSendInput,
  screen
}: {
  canStreamTouch: boolean
  isInspecting: boolean
  onHoverPoint: (point: PointerDevicePoint) => void
  onInspectPoint: (point: PointerDevicePoint) => void
  onSendInput: (input: DesktopMobileDeviceInputEvent) => void
  screen: MobileDeviceScreenDimensions | null
}) => {
  const pointerStartRef = useRef<PointerDevicePoint | null>(null)
  const pointerIdRef = useRef<number | null>(null)
  const liveTouchActiveRef = useRef(false)
  const lastLiveTouchMoveAtRef = useRef(0)
  const pendingLiveTouchMoveRef = useRef<PointerDevicePoint | null>(null)
  const liveTouchMoveTimerRef = useRef<number>()
  const [isTouching, setIsTouching] = useState(false)

  const flushLiveTouchMove = useCallback(() => {
    liveTouchMoveTimerRef.current = undefined
    const point = pendingLiveTouchMoveRef.current
    pendingLiveTouchMoveRef.current = null
    if (point == null || !liveTouchActiveRef.current) return
    lastLiveTouchMoveAtRef.current = Date.now()
    onSendInput({ kind: 'touch', touchPhase: 'move', x: point.x, y: point.y })
  }, [onSendInput])

  const scheduleLiveTouchMove = useCallback((point: PointerDevicePoint) => {
    pendingLiveTouchMoveRef.current = point
    if (liveTouchMoveTimerRef.current != null) return
    const elapsedMs = Date.now() - lastLiveTouchMoveAtRef.current
    liveTouchMoveTimerRef.current = window.setTimeout(
      flushLiveTouchMove,
      Math.max(0, liveTouchMoveIntervalMs - elapsedMs)
    )
  }, [flushLiveTouchMove])

  const cancelPendingLiveTouchMove = useCallback(() => {
    if (liveTouchMoveTimerRef.current != null) {
      window.clearTimeout(liveTouchMoveTimerRef.current)
      liveTouchMoveTimerRef.current = undefined
    }
    pendingLiveTouchMoveRef.current = null
  }, [])

  const clearPointerState = useCallback(() => {
    pointerStartRef.current = null
    pointerIdRef.current = null
    liveTouchActiveRef.current = false
    setIsTouching(false)
    cancelPendingLiveTouchMove()
  }, [cancelPendingLiveTouchMove])

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (screen == null) return
    event.preventDefault()
    const point = toPointerDevicePoint(event, screen)
    pointerStartRef.current = point
    pointerIdRef.current = event.pointerId
    setIsTouching(true)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is best effort for embedded webviews.
    }
  }, [screen])

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (screen == null) return
    const point = toPointerDevicePoint(event, screen)
    const startPoint = pointerStartRef.current
    if (startPoint != null && pointerIdRef.current === event.pointerId && canStreamTouch) {
      if (!liveTouchActiveRef.current) {
        const deltaX = point.x - startPoint.x
        const deltaY = point.y - startPoint.y
        if (Math.hypot(deltaX, deltaY) > swipeThresholdPx) {
          liveTouchActiveRef.current = true
          lastLiveTouchMoveAtRef.current = Date.now()
          onSendInput({ kind: 'touch', touchPhase: 'down', x: startPoint.x, y: startPoint.y })
        }
      }
      if (liveTouchActiveRef.current) scheduleLiveTouchMove(point)
    }
    if (isInspecting) onHoverPoint(point)
  }, [canStreamTouch, isInspecting, onHoverPoint, onSendInput, scheduleLiveTouchMove, screen])

  const handlePointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (screen == null) return
    if (pointerIdRef.current != null && pointerIdRef.current !== event.pointerId) return
    event.preventDefault()
    const startPoint = pointerStartRef.current
    const wasLiveTouchActive = liveTouchActiveRef.current
    clearPointerState()
    if (startPoint == null) return

    const endPoint = toPointerDevicePoint(event, screen)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Pointer capture is best effort for embedded webviews.
    }
    if (wasLiveTouchActive) {
      onSendInput({ kind: 'touch', touchPhase: 'up', x: endPoint.x, y: endPoint.y })
      return
    }
    if (isInspecting) {
      onInspectPoint(endPoint)
      return
    }

    const deltaX = endPoint.x - startPoint.x
    const deltaY = endPoint.y - startPoint.y
    if (Math.hypot(deltaX, deltaY) > swipeThresholdPx) {
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
  }, [clearPointerState, isInspecting, onInspectPoint, onSendInput, screen])

  const handlePointerCancel = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (screen == null) return
    if (pointerIdRef.current != null && pointerIdRef.current !== event.pointerId) return
    const endPoint = toPointerDevicePoint(event, screen)
    const wasLiveTouchActive = liveTouchActiveRef.current
    clearPointerState()
    if (wasLiveTouchActive) {
      onSendInput({ kind: 'touch', touchPhase: 'up', x: endPoint.x, y: endPoint.y })
    }
  }, [clearPointerState, onSendInput, screen])

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

  useEffect(() => clearPointerState, [clearPointerState])

  return {
    handlePointerCancel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
    isTouching
  }
}
