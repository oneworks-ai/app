import { useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'

export const timelineRailMarkerTargetSpacing = 36

export const getTimelineRailCollapseThresholdForHeight = ({
  bodyHeight,
  minimumThreshold,
  paddingBottom,
  paddingTop
}: {
  bodyHeight: number
  minimumThreshold: number
  paddingBottom: number
  paddingTop: number
}) => {
  const contentHeight = Math.max(0, bodyHeight - paddingTop - paddingBottom)
  const heightBasedThreshold = Math.max(
    minimumThreshold,
    Math.floor(contentHeight / timelineRailMarkerTargetSpacing)
  )

  return heightBasedThreshold
}

export function useTimelineRailCollapseThreshold({
  bodyElementRef,
  minimumThreshold
}: {
  bodyElementRef: RefObject<HTMLDivElement | null>
  minimumThreshold: number
}) {
  const [collapseThreshold, setCollapseThreshold] = useState(minimumThreshold)

  useLayoutEffect(() => {
    const measureThreshold = () => {
      const bodyElement = bodyElementRef.current
      if (bodyElement == null) {
        setCollapseThreshold(minimumThreshold)
        return
      }

      const style = window.getComputedStyle(bodyElement)
      const nextThreshold = getTimelineRailCollapseThresholdForHeight({
        bodyHeight: bodyElement.clientHeight,
        minimumThreshold,
        paddingBottom: Number.parseFloat(style.paddingBottom) || 0,
        paddingTop: Number.parseFloat(style.paddingTop) || 0
      })

      setCollapseThreshold(currentThreshold => currentThreshold === nextThreshold ? currentThreshold : nextThreshold)
    }

    measureThreshold()

    const bodyElement = bodyElementRef.current
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(measureThreshold)
    if (bodyElement != null) {
      resizeObserver?.observe(bodyElement)
    }

    window.addEventListener('resize', measureThreshold)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', measureThreshold)
    }
  }, [bodyElementRef, minimumThreshold])

  return collapseThreshold
}
