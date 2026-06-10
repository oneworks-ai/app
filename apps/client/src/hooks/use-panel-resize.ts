import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

type ResizeAxis = 'x' | 'y'
type ResizeDirection = 1 | -1

export interface UsePanelResizeOptions {
  axis: ResizeAxis
  cursor: 'col-resize' | 'row-resize'
  max: number
  min: number
  value: number
  direction?: ResizeDirection
  disabled?: boolean
  getMaxValue?: (event?: ReactPointerEvent<HTMLElement>) => number | undefined
  getStartValue?: (event: ReactPointerEvent<HTMLElement>) => number | undefined
  largeStep?: number
  onCommit: (value: number) => void
  onPreview: (value: number) => void
  onResizeEnd?: (value: number) => void
  onResizeStart?: (value: number) => void
  shouldIgnorePointerDown?: (target: HTMLElement | null) => boolean
  step?: number
}

const clampResizeValue = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))

const getPointerCoordinate = (event: PointerEvent | ReactPointerEvent<HTMLElement>, axis: ResizeAxis) =>
  axis === 'x' ? event.clientX : event.clientY

const getKeyboardCoordinateDelta = (
  event: ReactKeyboardEvent<HTMLElement>,
  axis: ResizeAxis,
  step: number
) => {
  if (axis === 'x') {
    if (event.key === 'ArrowLeft') return -step
    if (event.key === 'ArrowRight') return step
    return null
  }

  if (event.key === 'ArrowUp') return -step
  if (event.key === 'ArrowDown') return step
  return null
}

export function usePanelResize({
  axis,
  cursor,
  direction = 1,
  disabled = false,
  getMaxValue,
  getStartValue,
  largeStep = 40,
  max,
  min,
  onCommit,
  onPreview,
  onResizeEnd,
  onResizeStart,
  shouldIgnorePointerDown,
  step = 16,
  value
}: UsePanelResizeOptions) {
  const cleanupRef = useRef<(() => void) | null>(null)
  const [isResizing, setIsResizing] = useState(false)

  const resolveMaxValue = useCallback((event?: ReactPointerEvent<HTMLElement>) => getMaxValue?.(event) ?? max, [
    getMaxValue,
    max
  ])

  const cleanupResize = useCallback(() => {
    cleanupRef.current?.()
  }, [])

  useEffect(() => cleanupResize, [cleanupResize])

  useEffect(() => {
    if (disabled) cleanupResize()
  }, [cleanupResize, disabled])

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (disabled || shouldIgnorePointerDown?.(event.target as HTMLElement | null) === true) return

    event.preventDefault()
    event.stopPropagation()
    cleanupResize()

    const ownerDocument = event.currentTarget.ownerDocument
    const ownerWindow = ownerDocument.defaultView ?? window
    const resolvedMax = resolveMaxValue(event)
    const startValue = clampResizeValue(getStartValue?.(event) ?? value, min, resolvedMax)
    const startCoordinate = getPointerCoordinate(event, axis)
    const previousCursor = ownerDocument.body.style.cursor
    const previousUserSelect = ownerDocument.body.style.userSelect
    let nextValue = startValue
    let handlePointerMove: ((moveEvent: PointerEvent) => void) | null = null
    let handlePointerEnd: (() => void) | null = null

    const cleanup = () => {
      if (handlePointerMove != null) {
        ownerWindow.removeEventListener('pointermove', handlePointerMove)
      }
      if (handlePointerEnd != null) {
        ownerWindow.removeEventListener('pointerup', handlePointerEnd)
        ownerWindow.removeEventListener('pointercancel', handlePointerEnd)
      }
      ownerDocument.body.style.cursor = previousCursor
      ownerDocument.body.style.userSelect = previousUserSelect
      setIsResizing(false)
      cleanupRef.current = null
      onResizeEnd?.(nextValue)
    }

    handlePointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault()
      const coordinateDelta = getPointerCoordinate(moveEvent, axis) - startCoordinate
      nextValue = clampResizeValue(startValue + coordinateDelta * direction, min, resolvedMax)
      onPreview(nextValue)
    }

    handlePointerEnd = () => {
      onCommit(nextValue)
      cleanup()
    }

    ownerDocument.body.style.cursor = cursor
    ownerDocument.body.style.userSelect = 'none'
    setIsResizing(true)
    onResizeStart?.(startValue)
    cleanupRef.current = cleanup
    ownerWindow.addEventListener('pointermove', handlePointerMove)
    ownerWindow.addEventListener('pointerup', handlePointerEnd)
    ownerWindow.addEventListener('pointercancel', handlePointerEnd)
  }, [
    axis,
    cleanupResize,
    cursor,
    direction,
    disabled,
    getStartValue,
    min,
    onCommit,
    onPreview,
    onResizeEnd,
    onResizeStart,
    resolveMaxValue,
    shouldIgnorePointerDown,
    value
  ])

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (disabled) return

    const resolvedMax = resolveMaxValue()
    let nextValue: number | null = null

    if (event.key === 'Home') {
      nextValue = min
    } else if (event.key === 'End') {
      nextValue = resolvedMax
    } else {
      const coordinateDelta = getKeyboardCoordinateDelta(event, axis, event.shiftKey ? largeStep : step)
      if (coordinateDelta != null) {
        nextValue = clampResizeValue(value + coordinateDelta * direction, min, resolvedMax)
      }
    }

    if (nextValue == null) return

    event.preventDefault()
    event.stopPropagation()
    onPreview(nextValue)
    onCommit(nextValue)
  }, [
    axis,
    direction,
    disabled,
    largeStep,
    min,
    onCommit,
    onPreview,
    resolveMaxValue,
    step,
    value
  ])

  return {
    cleanupResize,
    handleKeyDown,
    handlePointerDown,
    isResizing
  }
}
