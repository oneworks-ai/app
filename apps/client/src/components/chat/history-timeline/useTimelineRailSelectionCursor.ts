import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'

interface TimelineRailCursor {
  color: string
  top: number
}

export function useTimelineRailSelectionCursor({
  bodyElementRef,
  layoutKey,
  selectedMarkerNodeId
}: {
  bodyElementRef: RefObject<HTMLDivElement | null>
  layoutKey: string
  selectedMarkerNodeId?: string
}) {
  const markerElementByIdRef = useRef(new Map<string, HTMLButtonElement>())
  const [selectionCursor, setSelectionCursor] = useState<TimelineRailCursor | null>(null)

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
      const markerRect = markerElement.getBoundingClientRect()
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

    const bodyElement = bodyElementRef.current
    const markerElement = selectedMarkerNodeId == null
      ? null
      : markerElementByIdRef.current.get(selectedMarkerNodeId)
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateSelectionCursor)
    if (bodyElement != null) {
      resizeObserver?.observe(bodyElement)
    }
    if (markerElement != null) {
      resizeObserver?.observe(markerElement)
    }

    return () => {
      resizeObserver?.disconnect()
    }
  }, [layoutKey, selectedMarkerNodeId])

  const selectionCursorStyle = selectionCursor == null
    ? undefined
    : {
      '--chat-history-timeline-rail-cursor-color': selectionCursor.color,
      top: `${selectionCursor.top}px`
    } as CSSProperties

  return {
    registerMarkerElement,
    selectionCursorStyle,
    selectionCursorVisible: selectionCursor != null
  }
}
