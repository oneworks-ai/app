import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

const EDGE_SWIPE_START_WIDTH = 22
const GESTURE_INTENT_DISTANCE = 8
const GESTURE_MIN_DISTANCE = 64
const GESTURE_MIN_VELOCITY = .45
const CLICK_SUPPRESSION_MS = 360
const FORM_CONTROL_SELECTOR = 'input,textarea,select,[contenteditable="true"],[role="textbox"]'

interface GestureState {
  dragging: boolean
  lastX: number
  pointerId: number
  startTime: number
  startX: number
  startY: number
}

const isMobilePointer = (event: PointerEvent) => event.pointerType === 'touch' || event.pointerType === 'pen'

const isFormControlTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && target.closest(FORM_CONTROL_SELECTOR) != null

const clearDragStyle = (sheet: HTMLElement) => {
  sheet.style.removeProperty('--oneworks-mobile-sidebar-drag-x')
  sheet.removeAttribute('data-mobile-sidebar-dragging')
}

export function useMobileSideSheetGestures({
  canSwipeOpen = true,
  isCompactLayout,
  isOpen,
  setIsOpen,
  sheetRef
}: {
  canSwipeOpen?: boolean
  isCompactLayout: boolean
  isOpen: boolean
  setIsOpen: (nextOpen: boolean) => void
  sheetRef: RefObject<HTMLDivElement | null>
}) {
  const suppressClickUntilRef = useRef(0)

  useEffect(() => {
    if (!isCompactLayout || !canSwipeOpen) return
    const sheet = sheetRef.current
    if (sheet == null) return

    const handleClickCapture = (event: MouseEvent) => {
      if (Date.now() > suppressClickUntilRef.current) return
      event.preventDefault()
      event.stopPropagation()
    }

    sheet.addEventListener('click', handleClickCapture, true)
    return () => sheet.removeEventListener('click', handleClickCapture, true)
  }, [canSwipeOpen, isCompactLayout, sheetRef])

  useEffect(() => {
    if (!isCompactLayout) return
    let gestureState: GestureState | null = null

    const resetGesture = () => {
      gestureState = null
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', resetGesture)
    }

    const handlePointerUp = () => resetGesture()

    const handlePointerMove = (event: PointerEvent) => {
      if (gestureState == null || event.pointerId !== gestureState.pointerId) return
      const deltaX = event.clientX - gestureState.startX
      const deltaY = Math.abs(event.clientY - gestureState.startY)
      const absDeltaX = Math.abs(deltaX)
      const absDeltaY = Math.abs(deltaY)
      if (absDeltaX < GESTURE_INTENT_DISTANCE || absDeltaX <= absDeltaY * 1.2) return

      gestureState.dragging = true
      if (event.cancelable) event.preventDefault()

      const elapsed = Math.max(1, event.timeStamp - gestureState.startTime)
      const velocity = deltaX / elapsed
      if (deltaX > GESTURE_MIN_DISTANCE || velocity > GESTURE_MIN_VELOCITY) {
        suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESSION_MS
        setIsOpen(true)
        resetGesture()
      }
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!isMobilePointer(event) || isOpen || event.clientX > EDGE_SWIPE_START_WIDTH) return
      if (isFormControlTarget(event.target)) return

      gestureState = {
        dragging: false,
        lastX: event.clientX,
        pointerId: event.pointerId,
        startTime: event.timeStamp,
        startX: event.clientX,
        startY: event.clientY
      }
      window.addEventListener('pointermove', handlePointerMove, { passive: false })
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', resetGesture)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      resetGesture()
    }
  }, [canSwipeOpen, isCompactLayout, isOpen, setIsOpen])

  useEffect(() => {
    if (!isCompactLayout || !isOpen) return
    const sheet = sheetRef.current
    if (sheet == null) return
    let gestureState: GestureState | null = null

    const resetGesture = () => {
      gestureState = null
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
    }

    const handlePointerCancel = () => {
      if (gestureState?.dragging === true && gestureState.lastX - gestureState.startX < -GESTURE_MIN_DISTANCE) {
        setIsOpen(false)
        window.setTimeout(() => clearDragStyle(sheet), 260)
        resetGesture()
        return
      }
      clearDragStyle(sheet)
      resetGesture()
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (gestureState == null || event.pointerId !== gestureState.pointerId) return
      const deltaX = event.clientX - gestureState.startX
      const elapsed = Math.max(1, event.timeStamp - gestureState.startTime)
      const velocity = deltaX / elapsed
      const shouldClose = deltaX < -GESTURE_MIN_DISTANCE || velocity < -GESTURE_MIN_VELOCITY
      const wasDragging = gestureState.dragging

      resetGesture()
      sheet.removeAttribute('data-mobile-sidebar-dragging')
      if (wasDragging) suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESSION_MS
      if (shouldClose) {
        setIsOpen(false)
        window.setTimeout(() => clearDragStyle(sheet), 260)
        return
      }
      clearDragStyle(sheet)
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (gestureState == null || event.pointerId !== gestureState.pointerId) return
      const deltaX = event.clientX - gestureState.startX
      const deltaY = event.clientY - gestureState.startY
      const absDeltaX = Math.abs(deltaX)
      const absDeltaY = Math.abs(deltaY)
      gestureState.lastX = event.clientX

      if (!gestureState.dragging) {
        if (absDeltaX < GESTURE_INTENT_DISTANCE || absDeltaX <= absDeltaY * 1.2) return
        gestureState.dragging = true
        sheet.setAttribute('data-mobile-sidebar-dragging', 'true')
      }

      if (event.cancelable) event.preventDefault()
      sheet.style.setProperty('--oneworks-mobile-sidebar-drag-x', `${Math.round(Math.min(0, deltaX))}px`)
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!isMobilePointer(event) || isFormControlTarget(event.target)) return
      gestureState = {
        dragging: false,
        lastX: event.clientX,
        pointerId: event.pointerId,
        startTime: event.timeStamp,
        startX: event.clientX,
        startY: event.clientY
      }
      window.addEventListener('pointermove', handlePointerMove, { passive: false })
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerCancel)
    }

    sheet.addEventListener('pointerdown', handlePointerDown)
    return () => {
      sheet.removeEventListener('pointerdown', handlePointerDown)
      clearDragStyle(sheet)
      resetGesture()
    }
  }, [isCompactLayout, isOpen, setIsOpen, sheetRef])
}
