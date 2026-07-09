import { useEffect, useRef, useState } from 'react'
import type { PointerEventHandler } from 'react'

const DETENT_HOLD_DISTANCE = .018
const DETENT_PULL_DISTANCE = .065

const getPointerProgress = (clientX: number, marksElement: HTMLSpanElement | null) => {
  const marksRect = marksElement?.getBoundingClientRect()
  const firstMarkRect = marksElement?.firstElementChild?.getBoundingClientRect()
  if (marksRect == null || firstMarkRect == null) {
    return null
  }

  const start = marksRect.left + firstMarkRect.width / 2
  const end = marksRect.right - firstMarkRect.width / 2
  if (end <= start) {
    return null
  }

  return Math.min(1, Math.max(0, (clientX - start) / (end - start)))
}

const getDragPreview = (pointerProgress: number, maxIndex: number) => {
  if (maxIndex <= 0) {
    return { detentIndex: 0, progress: 0 }
  }

  const nearestIndex = Math.round(pointerProgress * maxIndex)
  const detentProgress = nearestIndex / maxIndex
  const offset = pointerProgress - detentProgress
  const distance = Math.abs(offset)

  if (distance <= DETENT_HOLD_DISTANCE) {
    return { detentIndex: nearestIndex, progress: detentProgress }
  }
  if (distance >= DETENT_PULL_DISTANCE) {
    return { detentIndex: null, progress: pointerProgress }
  }

  const pullRatio = (distance - DETENT_HOLD_DISTANCE) /
    (DETENT_PULL_DISTANCE - DETENT_HOLD_DISTANCE)
  const easedPull = pullRatio * pullRatio * (3 - 2 * pullRatio)
  return {
    detentIndex: null,
    progress: detentProgress + offset * easedPull
  }
}

export function useStageSliderDrag({
  disabled,
  maxIndex,
  onCommit,
  selectedIndex
}: {
  disabled: boolean
  maxIndex: number
  onCommit: (index: number) => void
  selectedIndex: number
}) {
  const marksRef = useRef<HTMLSpanElement>(null)
  const draggingPointerIdRef = useRef<number | null>(null)
  const latestRef = useRef({ maxIndex, onCommit, selectedIndex })
  const [detentIndex, setDetentIndex] = useState<number | null>(null)
  const [dragProgress, setDragProgress] = useState<number | null>(null)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  latestRef.current = { maxIndex, onCommit, selectedIndex }

  const handlePointerDown: PointerEventHandler<HTMLDivElement> = event => {
    if (disabled || maxIndex === 0 || (event.pointerType === 'mouse' && event.button !== 0)) {
      return
    }

    const nextProgress = getPointerProgress(event.clientX, marksRef.current)
    if (nextProgress == null) {
      return
    }

    const preview = getDragPreview(nextProgress, maxIndex)
    draggingPointerIdRef.current = event.pointerId
    setDetentIndex(preview.detentIndex)
    setDragProgress(preview.progress)
    setHoveredIndex(Math.round(nextProgress * maxIndex))
  }
  const handlePointerMove: PointerEventHandler<HTMLDivElement> = event => {
    if (draggingPointerIdRef.current != null) {
      return
    }

    const nextProgress = getPointerProgress(event.clientX, marksRef.current)
    const nextHoveredIndex = nextProgress == null ? null : Math.round(nextProgress * maxIndex)
    setHoveredIndex(current => current === nextHoveredIndex ? current : nextHoveredIndex)
  }

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== draggingPointerIdRef.current) {
        return
      }

      const nextProgress = getPointerProgress(event.clientX, marksRef.current)
      if (nextProgress == null) {
        return
      }

      const { maxIndex } = latestRef.current
      const preview = getDragPreview(nextProgress, maxIndex)
      setDetentIndex(preview.detentIndex)
      setDragProgress(preview.progress)
      setHoveredIndex(Math.round(nextProgress * maxIndex))
    }
    const finishPointerDrag = (event: PointerEvent) => {
      if (event.pointerId !== draggingPointerIdRef.current) {
        return
      }

      const { maxIndex, onCommit, selectedIndex } = latestRef.current
      const nextProgress = getPointerProgress(event.clientX, marksRef.current)
      const nextIndex = nextProgress == null ? selectedIndex : Math.round(nextProgress * maxIndex)
      draggingPointerIdRef.current = null
      setDetentIndex(null)
      setDragProgress(null)
      setHoveredIndex(nextIndex)
      onCommit(nextIndex)
    }
    const cancelPointerDrag = (event: PointerEvent) => {
      if (event.pointerId !== draggingPointerIdRef.current) {
        return
      }

      draggingPointerIdRef.current = null
      setDetentIndex(null)
      setDragProgress(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', finishPointerDrag)
    window.addEventListener('pointercancel', cancelPointerDrag)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finishPointerDrag)
      window.removeEventListener('pointercancel', cancelPointerDrag)
    }
  }, [])

  return {
    detentIndex,
    dragProgress,
    handlePointerDown,
    handlePointerMove,
    hoveredIndex,
    isPointerDragging: () => draggingPointerIdRef.current != null,
    marksRef,
    stopHovering: () => setHoveredIndex(null)
  }
}
