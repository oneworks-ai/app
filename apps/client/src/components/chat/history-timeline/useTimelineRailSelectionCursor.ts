import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'

interface TimelineRailCursor {
  color: string
  top: number
}

interface TimelineRailScrollAffordance {
  canScrollDown: boolean
  canScrollUp: boolean
}

const hiddenScrollAffordance: TimelineRailScrollAffordance = {
  canScrollDown: false,
  canScrollUp: false
}
const selectedMarkerVisibilityInset = 32

export function useTimelineRailSelectionCursor({
  bodyElementRef,
  keepSelectedMarkerVisible = false,
  layoutKey,
  selectedMarkerNodeId
}: {
  bodyElementRef: RefObject<HTMLDivElement | null>
  keepSelectedMarkerVisible?: boolean
  layoutKey: string
  selectedMarkerNodeId?: string
}) {
  const markerElementByIdRef = useRef(new Map<string, HTMLButtonElement>())
  const [selectionCursor, setSelectionCursor] = useState<TimelineRailCursor | null>(null)
  const [scrollAffordance, setScrollAffordance] = useState(hiddenScrollAffordance)

  const registerMarkerElement = useCallback((nodeId: string) =>
  (
    element: HTMLButtonElement | null
  ) => {
    if (element == null) {
      markerElementByIdRef.current.delete(nodeId)
      return
    }

    markerElementByIdRef.current.set(nodeId, element)
  }, [])

  useLayoutEffect(() => {
    const updateScrollAffordance = () => {
      const bodyElement = bodyElementRef.current
      const canScroll = keepSelectedMarkerVisible &&
        bodyElement != null &&
        bodyElement.scrollHeight > bodyElement.clientHeight + 1
      const nextAffordance = canScroll
        ? {
          canScrollDown: bodyElement.scrollTop + bodyElement.clientHeight < bodyElement.scrollHeight - 1,
          canScrollUp: bodyElement.scrollTop > 1
        }
        : hiddenScrollAffordance

      setScrollAffordance(current =>
        current.canScrollDown === nextAffordance.canScrollDown &&
          current.canScrollUp === nextAffordance.canScrollUp
          ? current
          : nextAffordance
      )
    }

    const updateSelectionCursor = () => {
      const bodyElement = bodyElementRef.current
      const markerElement = selectedMarkerNodeId == null
        ? null
        : markerElementByIdRef.current.get(selectedMarkerNodeId)

      if (bodyElement == null || markerElement == null) {
        setSelectionCursor(null)
        return
      }

      const bodyRect = bodyElement.getBoundingClientRect()
      let markerRect = markerElement.getBoundingClientRect()
      if (keepSelectedMarkerVisible && bodyElement.scrollHeight > bodyElement.clientHeight) {
        const visibilityInset = Math.min(selectedMarkerVisibilityInset, bodyRect.height / 2)
        const visibleTop = bodyRect.top + visibilityInset
        const visibleBottom = bodyRect.bottom - visibilityInset

        if (markerRect.top < visibleTop) {
          bodyElement.scrollTop += markerRect.top - visibleTop
          markerRect = markerElement.getBoundingClientRect()
        } else if (markerRect.bottom > visibleBottom) {
          bodyElement.scrollTop += markerRect.bottom - visibleBottom
          markerRect = markerElement.getBoundingClientRect()
        }
      }
      const markerStyle = window.getComputedStyle(markerElement)
      const color = markerStyle.getPropertyValue('--chat-history-timeline-marker-active-color')
        .trim() || markerStyle.color
      const top = markerRect.top + markerRect.height / 2 - bodyRect.top

      setSelectionCursor((current) => {
        if (
          current != null &&
          Math.abs(current.top - top) < 0.5 &&
          current.color === color
        ) {
          return current
        }

        return { color, top }
      })
    }

    updateSelectionCursor()
    updateScrollAffordance()

    const bodyElement = bodyElementRef.current
    const markerElement = selectedMarkerNodeId == null
      ? null
      : markerElementByIdRef.current.get(selectedMarkerNodeId)
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
        updateSelectionCursor()
        updateScrollAffordance()
      })
    if (bodyElement != null) {
      resizeObserver?.observe(bodyElement)
      bodyElement.addEventListener('scroll', updateScrollAffordance, { passive: true })
    }
    if (markerElement != null) {
      resizeObserver?.observe(markerElement)
    }

    return () => {
      resizeObserver?.disconnect()
      bodyElement?.removeEventListener('scroll', updateScrollAffordance)
    }
  }, [keepSelectedMarkerVisible, layoutKey, selectedMarkerNodeId])

  const selectionCursorStyle = selectionCursor == null
    ? undefined
    : {
      '--chat-history-timeline-rail-cursor-color': selectionCursor.color,
      top: `${selectionCursor.top}px`
    } as CSSProperties

  return {
    ...scrollAffordance,
    registerMarkerElement,
    selectionCursorStyle,
    selectionCursorVisible: selectionCursor != null
  }
}
