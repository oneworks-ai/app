import { useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'

function areColumnOffsetsEqual(current: Record<number, number>, next: Record<number, number>) {
  const currentKeys = Object.keys(current)
  const nextKeys = Object.keys(next)
  return currentKeys.length === nextKeys.length &&
    nextKeys.every(key => current[Number(key)] === next[Number(key)])
}

export function useOverlayMenuColumnOffsets(
  compositeRef: RefObject<HTMLDivElement | null>,
  columnSignature: string
) {
  const [columnOffsets, setColumnOffsets] = useState<Record<number, number>>({})

  useLayoutEffect(() => {
    const composite = compositeRef.current
    if (composite == null) return

    const compositeTop = composite.getBoundingClientRect().top
    const nextOffsets: Record<number, number> = {}

    for (const column of composite.querySelectorAll<HTMLElement>('.oneworks-overlay-menu-column.is-submenu')) {
      const level = Number(column.dataset.oneworksOverlayMenuLevel)
      if (!Number.isFinite(level) || level <= 0) continue

      const previousColumn = composite.querySelector<HTMLElement>(
        `[data-oneworks-overlay-menu-level="${level - 1}"]`
      )
      const activeItem = previousColumn?.querySelector<HTMLElement>('.oneworks-overlay-action.is-active')
      if (activeItem == null) continue

      nextOffsets[level] = Math.round(activeItem.getBoundingClientRect().top - compositeTop)
    }

    setColumnOffsets(currentOffsets =>
      areColumnOffsetsEqual(currentOffsets, nextOffsets)
        ? currentOffsets
        : nextOffsets
    )
  }, [columnSignature, compositeRef])

  return columnOffsets
}
