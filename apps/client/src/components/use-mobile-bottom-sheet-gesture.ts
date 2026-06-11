import { useEffect, useRef } from 'react'
import type { MouseEvent, PointerEvent, RefObject } from 'react'

const INTENT_DISTANCE = 8
const MIN_DISTANCE = 56
const MIN_VELOCITY = .45
const CLICK_SUPPRESSION_MS = 360
const FORM_CONTROL_SELECTOR = 'input,textarea,select,[contenteditable="true"],[role="textbox"]'

interface GestureState {
  dragging: boolean
  lastY: number
  pointerId: number
  startTime: number
  startX: number
  startY: number
}

const isMobilePointer = (pointerType: string) => pointerType === 'touch' || pointerType === 'pen'

const isFormControlTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && target.closest(FORM_CONTROL_SELECTOR) != null

export function useMobileBottomSheetGesture({
  isOpen,
  onClose,
  sheetRef
}: {
  isOpen: boolean
  onClose: () => void
  sheetRef: RefObject<HTMLDivElement | null>
}) {
  const gestureRef = useRef<GestureState | null>(null)
  const suppressClickUntilRef = useRef(0)

  const clearDragStyle = () => {
    const sheet = sheetRef.current
    if (sheet == null) return
    sheet.style.removeProperty('--oneworks-mobile-bottom-sheet-drag-y')
    sheet.removeAttribute('data-mobile-bottom-sheet-dragging')
  }

  useEffect(() => {
    if (!isOpen) clearDragStyle()
  }, [isOpen])

  const finishGesture = (clientY: number, timeStamp: number) => {
    const gesture = gestureRef.current
    if (gesture == null) return

    const deltaY = clientY - gesture.startY
    const elapsed = Math.max(1, timeStamp - gesture.startTime)
    const velocity = deltaY / elapsed
    const shouldClose = deltaY > MIN_DISTANCE || velocity > MIN_VELOCITY
    const wasDragging = gesture.dragging

    gestureRef.current = null
    sheetRef.current?.removeAttribute('data-mobile-bottom-sheet-dragging')
    if (wasDragging) suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESSION_MS
    if (shouldClose) {
      onClose()
      window.setTimeout(clearDragStyle, 260)
      return
    }
    clearDragStyle()
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!isOpen || !isMobilePointer(event.pointerType) || isFormControlTarget(event.target)) return
    gestureRef.current = {
      dragging: false,
      lastY: event.clientY,
      pointerId: event.pointerId,
      startTime: event.timeStamp,
      startX: event.clientX,
      startY: event.clientY
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (gesture == null || gesture.pointerId !== event.pointerId) return

    const deltaX = event.clientX - gesture.startX
    const deltaY = event.clientY - gesture.startY
    const absDeltaX = Math.abs(deltaX)
    const absDeltaY = Math.abs(deltaY)
    gesture.lastY = event.clientY

    if (!gesture.dragging) {
      if (absDeltaY < INTENT_DISTANCE || absDeltaY <= absDeltaX * 1.2) return
      gesture.dragging = true
      event.currentTarget.setAttribute('data-mobile-bottom-sheet-dragging', 'true')
    }

    if (event.cancelable) event.preventDefault()
    event.currentTarget.style.setProperty(
      '--oneworks-mobile-bottom-sheet-drag-y',
      `${Math.round(Math.max(0, deltaY))}px`
    )
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    finishGesture(event.clientY, event.timeStamp)
  }

  const onPointerCancel = () => {
    const gesture = gestureRef.current
    if (gesture?.dragging === true && gesture.lastY - gesture.startY > MIN_DISTANCE) {
      onClose()
      window.setTimeout(clearDragStyle, 260)
      gestureRef.current = null
      return
    }
    gestureRef.current = null
    clearDragStyle()
  }

  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (Date.now() > suppressClickUntilRef.current) return
    event.preventDefault()
    event.stopPropagation()
  }

  return {
    onClickCapture,
    onPointerCancel,
    onPointerDown,
    onPointerMove,
    onPointerUp
  }
}
