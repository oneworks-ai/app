import { useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'

const OVERLAY_VIEWPORT_PADDING = 12
const OVERLAY_MENU_COLUMN_SELECTOR = '.oneworks-overlay-menu-column.is-submenu'

function areBoundaryOffsetsEqual(currentOffsets: Record<number, number>, nextOffsets: Record<number, number>) {
  const currentKeys = Object.keys(currentOffsets)
  const nextKeys = Object.keys(nextOffsets)
  return (
    currentKeys.length === nextKeys.length &&
    nextKeys.every(key => currentOffsets[Number(key)] === nextOffsets[Number(key)])
  )
}

export function useOverlayMenuBoundaryOffsets(
  compositeRef: RefObject<HTMLDivElement | null>,
  columnSignature: string
) {
  const [boundaryOffsets, setBoundaryOffsets] = useState<Record<number, number>>({})

  useLayoutEffect(() => {
    const composite = compositeRef.current
    if (composite == null) return

    const measureBoundaryOffsets = () => {
      const nextOffsets: Record<number, number> = {}
      const viewportBottom = window.innerHeight - OVERLAY_VIEWPORT_PADDING
      const viewportTop = OVERLAY_VIEWPORT_PADDING

      for (const column of composite.querySelectorAll<HTMLElement>(OVERLAY_MENU_COLUMN_SELECTOR)) {
        const level = Number(column.dataset.oneworksOverlayMenuLevel)
        if (!Number.isFinite(level)) continue

        const currentOffset = Number.parseFloat(
          column.style.getPropertyValue('--oneworks-overlay-menu-boundary-offset-y') || '0'
        )
        const rect = column.getBoundingClientRect()
        const baseTop = rect.top - currentOffset
        const baseBottom = rect.bottom - currentOffset
        let nextOffset = 0
        const bottomOverflow = baseBottom - viewportBottom

        if (bottomOverflow > 0) {
          nextOffset = -bottomOverflow
        }

        const topOverflow = viewportTop - (baseTop + nextOffset)

        if (topOverflow > 0) {
          nextOffset += topOverflow
        }

        if (nextOffset !== 0) {
          nextOffsets[level] = Math.round(nextOffset)
        }
      }

      setBoundaryOffsets((currentOffsets) => {
        if (areBoundaryOffsetsEqual(currentOffsets, nextOffsets)) {
          return currentOffsets
        }

        return nextOffsets
      })
    }

    measureBoundaryOffsets()
    window.addEventListener('resize', measureBoundaryOffsets)

    return () => {
      window.removeEventListener('resize', measureBoundaryOffsets)
    }
  }, [columnSignature, compositeRef])

  return boundaryOffsets
}
