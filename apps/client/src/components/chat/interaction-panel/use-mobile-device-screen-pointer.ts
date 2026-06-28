/* eslint-disable max-lines -- Pointer hook keeps tap, drag, wheel, and remote-input timing in one interaction state machine. */

import type { PointerEvent, WheelEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { toPointerDevicePoint } from './mobile-device-preview-utils'
import type { MobileDeviceScreenDimensions, PointerDevicePoint } from './mobile-device-preview-utils'

const liveTouchMoveIntervalMs = 32
const tapDispatchDelayMs = 0
const swipeThresholdPx = 10

export const useMobileDeviceScreenPointer = ({
  canSendTouchGesture,
  canStreamTouch,
  isInspecting,
  onHoverPoint,
  onInspectPoint,
  onSendInput,
  screen,
  shouldStartDragGesture,
  wheelInputThrottleMs
}: {
  canSendTouchGesture: boolean
  canStreamTouch: boolean
  isInspecting: boolean
  onHoverPoint: (point: PointerDevicePoint) => void
  onInspectPoint: (point: PointerDevicePoint) => void
  onSendInput: (input: DesktopMobileDeviceInputEvent) => void
  screen: MobileDeviceScreenDimensions | null
  shouldStartDragGesture?: (event: PointerEvent<HTMLDivElement>) => boolean
  wheelInputThrottleMs: number
}) => {
  const pointerStartRef = useRef<PointerDevicePoint | null>(null)
  const pointerLatestRef = useRef<PointerDevicePoint | null>(null)
  const pointerStartedAtRef = useRef(0)
  const pointerIdRef = useRef<number | null>(null)
  const liveTouchActiveRef = useRef(false)
  const lastLiveTouchMoveAtRef = useRef(0)
  const pendingLiveTouchMoveRef = useRef<PointerDevicePoint | null>(null)
  const liveTouchMoveTimerRef = useRef<number>()
  const pendingTapTimerRef = useRef<number>()
  const preferDragGestureRef = useRef(false)
  const lastWheelInputAtRef = useRef(0)
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

  const flushPendingLiveTouchMove = useCallback(() => {
    if (liveTouchMoveTimerRef.current != null) {
      window.clearTimeout(liveTouchMoveTimerRef.current)
      liveTouchMoveTimerRef.current = undefined
    }
    flushLiveTouchMove()
  }, [flushLiveTouchMove])

  const cancelPendingTap = useCallback(() => {
    if (pendingTapTimerRef.current != null) {
      window.clearTimeout(pendingTapTimerRef.current)
      pendingTapTimerRef.current = undefined
    }
  }, [])

  const scheduleTap = useCallback((point: PointerDevicePoint) => {
    cancelPendingTap()
    if (tapDispatchDelayMs <= 0) {
      onSendInput({ kind: 'tap', x: point.x, y: point.y })
      return
    }
    pendingTapTimerRef.current = window.setTimeout(() => {
      pendingTapTimerRef.current = undefined
      onSendInput({ kind: 'tap', x: point.x, y: point.y })
    }, tapDispatchDelayMs)
  }, [cancelPendingTap, onSendInput])

  const clearPointerState = useCallback(() => {
    pointerStartRef.current = null
    pointerLatestRef.current = null
    pointerStartedAtRef.current = 0
    pointerIdRef.current = null
    liveTouchActiveRef.current = false
    preferDragGestureRef.current = false
    setIsTouching(false)
    cancelPendingLiveTouchMove()
  }, [cancelPendingLiveTouchMove])

  const startTouchGesture = useCallback((point: PointerDevicePoint) => {
    liveTouchActiveRef.current = true
    lastLiveTouchMoveAtRef.current = Date.now()
    onSendInput({ kind: 'touch', touchPhase: 'down', x: point.x, y: point.y })
  }, [onSendInput])

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (screen == null) return
    if (event.button !== 0) return
    event.preventDefault()
    cancelPendingTap()
    const point = toPointerDevicePoint(event, screen)
    const pointerId = event.pointerId
    pointerStartRef.current = point
    pointerLatestRef.current = point
    pointerStartedAtRef.current = Date.now()
    pointerIdRef.current = pointerId
    preferDragGestureRef.current = canSendTouchGesture && !canStreamTouch && !isInspecting &&
      shouldStartDragGesture?.(event) === true
    setIsTouching(true)
    if (canStreamTouch && !isInspecting) {
      startTouchGesture(point)
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is best effort for embedded webviews.
    }
  }, [
    canSendTouchGesture,
    canStreamTouch,
    cancelPendingTap,
    isInspecting,
    screen,
    shouldStartDragGesture,
    startTouchGesture
  ])

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (screen == null) return
    const point = toPointerDevicePoint(event, screen)
    const startPoint = pointerStartRef.current
    const isActivePointer = startPoint != null && pointerIdRef.current === event.pointerId
    if (isActivePointer) pointerLatestRef.current = point
    if (isActivePointer && !canStreamTouch && !liveTouchActiveRef.current) {
      const deltaX = point.x - startPoint.x
      const deltaY = point.y - startPoint.y
      if (Math.hypot(deltaX, deltaY) > swipeThresholdPx) {
        cancelPendingTap()
      }
    }
    if (startPoint != null && pointerIdRef.current === event.pointerId && canStreamTouch && !isInspecting) {
      if (!liveTouchActiveRef.current) {
        const deltaX = point.x - startPoint.x
        const deltaY = point.y - startPoint.y
        if (Math.hypot(deltaX, deltaY) > swipeThresholdPx) {
          cancelPendingTap()
          liveTouchActiveRef.current = true
          lastLiveTouchMoveAtRef.current = Date.now()
          onSendInput({ kind: 'touch', touchPhase: 'down', x: startPoint.x, y: startPoint.y })
        }
      }
      if (liveTouchActiveRef.current) scheduleLiveTouchMove(point)
    }
    if (isInspecting) onHoverPoint(point)
  }, [
    canStreamTouch,
    cancelPendingTap,
    isInspecting,
    onHoverPoint,
    onSendInput,
    scheduleLiveTouchMove,
    screen
  ])

  const handlePointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (screen == null) return
    if (pointerIdRef.current != null && pointerIdRef.current !== event.pointerId) return
    event.preventDefault()
    const startPoint = pointerStartRef.current
    const shouldDrag = preferDragGestureRef.current
    const wasLiveTouchActive = liveTouchActiveRef.current
    const durationMs = Math.max(0, Date.now() - pointerStartedAtRef.current)
    if (wasLiveTouchActive) flushPendingLiveTouchMove()
    clearPointerState()
    if (startPoint == null) return

    const endPoint = toPointerDevicePoint(event, screen)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Pointer capture is best effort for embedded webviews.
    }
    if (wasLiveTouchActive) {
      onSendInput({ durationMs, kind: 'touch', touchPhase: 'up', x: endPoint.x, y: endPoint.y })
      return
    }
    if (isInspecting) {
      onInspectPoint(endPoint)
      return
    }

    const deltaX = endPoint.x - startPoint.x
    const deltaY = endPoint.y - startPoint.y
    if (Math.hypot(deltaX, deltaY) > swipeThresholdPx) {
      cancelPendingTap()
      const isHorizontalSwipe = Math.abs(deltaX) > Math.abs(deltaY) * 1.25
      const kind = shouldDrag && !isHorizontalSwipe ? 'drag' : 'swipe'
      onSendInput({
        durationMs: kind === 'drag'
          ? Math.min(300, Math.max(120, durationMs))
          : Math.max(120, durationMs),
        endX: endPoint.x,
        endY: endPoint.y,
        kind,
        x: startPoint.x,
        y: startPoint.y
      })
      return
    }
    scheduleTap(endPoint)
  }, [
    cancelPendingTap,
    clearPointerState,
    flushPendingLiveTouchMove,
    isInspecting,
    onInspectPoint,
    onSendInput,
    scheduleTap,
    screen
  ])

  const handlePointerCancel = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (screen == null) return
    if (pointerIdRef.current != null && pointerIdRef.current !== event.pointerId) return
    const endPoint = toPointerDevicePoint(event, screen)
    const wasLiveTouchActive = liveTouchActiveRef.current
    const durationMs = Math.max(0, Date.now() - pointerStartedAtRef.current)
    if (wasLiveTouchActive) flushPendingLiveTouchMove()
    clearPointerState()
    if (wasLiveTouchActive) {
      onSendInput({ durationMs, kind: 'touch', touchPhase: 'up', x: endPoint.x, y: endPoint.y })
    }
  }, [clearPointerState, flushPendingLiveTouchMove, onSendInput, screen])

  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (screen == null || isInspecting) return
    event.preventDefault()
    const now = Date.now()
    if (now - lastWheelInputAtRef.current < wheelInputThrottleMs) return
    const point = toPointerDevicePoint(event, screen)
    const scrollX = -Math.max(-1, Math.min(1, event.deltaX / 500))
    const scrollY = -Math.max(-1, Math.min(1, event.deltaY / 500))
    if (Math.abs(scrollX) < 0.02 && Math.abs(scrollY) < 0.02) return
    lastWheelInputAtRef.current = now
    onSendInput({
      kind: 'scroll',
      scrollX,
      scrollY,
      x: point.x,
      y: point.y
    })
  }, [isInspecting, onSendInput, screen, wheelInputThrottleMs])

  useEffect(() => () => {
    clearPointerState()
    cancelPendingTap()
  }, [cancelPendingTap, clearPointerState])

  return {
    handlePointerCancel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheel,
    isTouching
  }
}
