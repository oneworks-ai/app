import type { CSSProperties } from 'react'

const floatingPopoverViewportMargin = 12
const floatingPopoverGap = 8
const floatingPopoverZIndex = 2147483647

export const hiddenPinnedPopoverStyle: CSSProperties = {
  position: 'fixed',
  visibility: 'hidden'
}

export const resolvePinnedPopoverStyle = ({
  align = 'start',
  matchWidthSelector,
  popoverElement,
  rootElement
}: {
  align?: 'center' | 'start'
  matchWidthSelector?: string
  popoverElement: HTMLDivElement
  rootElement: HTMLElement
}): CSSProperties => {
  const matchedWidthElement = matchWidthSelector == null
    ? null
    : rootElement.closest(matchWidthSelector)
  const anchorRect = matchedWidthElement instanceof HTMLElement
    ? matchedWidthElement.getBoundingClientRect()
    : rootElement.getBoundingClientRect()
  const popoverRect = popoverElement.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const maxWidth = Math.max(0, viewportWidth - floatingPopoverViewportMargin * 2)
  const matchedWidth = matchedWidthElement instanceof HTMLElement
    ? Math.min(Math.max(anchorRect.width, 0), maxWidth)
    : null
  const popoverWidth = matchedWidth ?? Math.min(popoverRect.width || maxWidth, maxWidth)
  const popoverHeight = popoverRect.height || 0
  const maxLeft = Math.max(
    floatingPopoverViewportMargin,
    viewportWidth - popoverWidth - floatingPopoverViewportMargin
  )
  const preferredLeft = align === 'center' && matchedWidthElement == null
    ? anchorRect.left + anchorRect.width / 2 - popoverWidth / 2
    : anchorRect.left
  const left = Math.min(Math.max(preferredLeft, floatingPopoverViewportMargin), maxLeft)
  const aboveTop = anchorRect.top - popoverHeight - floatingPopoverGap
  const belowTop = anchorRect.bottom + floatingPopoverGap
  const top = aboveTop >= floatingPopoverViewportMargin
    ? aboveTop
    : Math.min(
      Math.max(belowTop, floatingPopoverViewportMargin),
      Math.max(floatingPopoverViewportMargin, viewportHeight - popoverHeight - floatingPopoverViewportMargin)
    )

  return {
    position: 'fixed',
    zIndex: floatingPopoverZIndex,
    top,
    right: 'auto',
    bottom: 'auto',
    left,
    width: matchedWidth ?? undefined,
    maxWidth: matchedWidth == null ? undefined : maxWidth,
    opacity: 1,
    pointerEvents: 'auto',
    transform: 'none',
    visibility: 'visible'
  }
}
