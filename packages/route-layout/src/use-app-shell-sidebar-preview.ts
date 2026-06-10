import type { PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

const SIDEBAR_EDGE_SWIPE_MAX_VERTICAL_RATIO = .75
const SIDEBAR_EDGE_SWIPE_THRESHOLD = 34
const SIDEBAR_PREVIEW_CLOSE_DELAY_MS = 140

interface SidebarEdgeGesture {
  opened: boolean
  pointerId: number
  startX: number
  startY: number
}

interface UseAppShellSidebarPreviewOptions {
  canShowSidebarPreview: boolean
}

export function useAppShellSidebarPreview({
  canShowSidebarPreview
}: UseAppShellSidebarPreviewOptions) {
  const sidebarEdgeGestureRef = useRef<SidebarEdgeGesture | null>(null)
  const sidebarPreviewCloseTimerRef = useRef<number | null>(null)
  const [isSidebarPreviewOpen, setIsSidebarPreviewOpen] = useState(false)

  const clearSidebarPreviewCloseTimer = useCallback(() => {
    if (sidebarPreviewCloseTimerRef.current == null) return

    window.clearTimeout(sidebarPreviewCloseTimerRef.current)
    sidebarPreviewCloseTimerRef.current = null
  }, [])

  const closeSidebarPreview = useCallback(() => {
    clearSidebarPreviewCloseTimer()
    setIsSidebarPreviewOpen(false)
  }, [clearSidebarPreviewCloseTimer])

  const openSidebarPreview = useCallback(() => {
    if (!canShowSidebarPreview) return

    clearSidebarPreviewCloseTimer()
    setIsSidebarPreviewOpen(true)
  }, [canShowSidebarPreview, clearSidebarPreviewCloseTimer])

  const scheduleSidebarPreviewClose = useCallback(() => {
    clearSidebarPreviewCloseTimer()
    sidebarPreviewCloseTimerRef.current = window.setTimeout(() => {
      sidebarPreviewCloseTimerRef.current = null
      setIsSidebarPreviewOpen(false)
    }, SIDEBAR_PREVIEW_CLOSE_DELAY_MS)
  }, [clearSidebarPreviewCloseTimer])

  useEffect(() => () => {
    clearSidebarPreviewCloseTimer()
  }, [clearSidebarPreviewCloseTimer])

  useEffect(() => {
    if (!canShowSidebarPreview) closeSidebarPreview()
  }, [canShowSidebarPreview, closeSidebarPreview])

  useEffect(() => {
    if (!isSidebarPreviewOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSidebarPreview()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeSidebarPreview, isSidebarPreviewOpen])

  const handleSidebarEdgePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canShowSidebarPreview) return
    if (event.pointerType === 'mouse' && event.button !== 0) return

    sidebarEdgeGestureRef.current = {
      opened: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [canShowSidebarPreview])

  const handleSidebarEdgePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = sidebarEdgeGestureRef.current
    if (gesture == null || gesture.pointerId !== event.pointerId || gesture.opened) return

    const deltaX = event.clientX - gesture.startX
    const deltaY = Math.abs(event.clientY - gesture.startY)
    if (
      deltaX >= SIDEBAR_EDGE_SWIPE_THRESHOLD &&
      deltaY <= deltaX * SIDEBAR_EDGE_SWIPE_MAX_VERTICAL_RATIO
    ) {
      gesture.opened = true
      openSidebarPreview()
    }
  }, [openSidebarPreview])

  const clearSidebarEdgeGesture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = sidebarEdgeGestureRef.current
    if (gesture != null && gesture.pointerId === event.pointerId) {
      sidebarEdgeGestureRef.current = null
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  return {
    closeSidebarPreview,
    isSidebarPreviewOpen,
    openSidebarPreview,
    scheduleSidebarPreviewClose,
    sidebarEdgeSwipeZoneHandlers: {
      onPointerCancel: clearSidebarEdgeGesture,
      onPointerDown: handleSidebarEdgePointerDown,
      onPointerMove: handleSidebarEdgePointerMove,
      onPointerUp: clearSidebarEdgeGesture
    }
  }
}
