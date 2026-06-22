import type { CSSProperties, RefObject } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { hiddenPinnedPopoverStyle, resolvePinnedPopoverStyle } from './pinned-popover-position'

export interface PinnedPopoverController<TElement extends HTMLElement = HTMLElement> {
  isOpen: boolean
  isPinned: boolean
  onPopoverPointerEnter: () => void
  onPopoverPointerLeave: () => void
  onRootPointerEnter: () => void
  onRootPointerLeave: () => void
  popoverRef: RefObject<HTMLDivElement>
  popoverStyle: CSSProperties
  rootRef: RefObject<TElement>
  togglePinned: () => void
}

export interface UsePinnedPopoverOptions {
  align?: 'center' | 'start'
  matchWidthSelector?: string
}

export const usePinnedPopover = <TElement extends HTMLElement>({
  align,
  matchWidthSelector
}: UsePinnedPopoverOptions = {}): PinnedPopoverController<TElement> => {
  const rootRef = useRef<TElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [isPinned, setIsPinned] = useState(false)
  const [isHoverOpen, setIsHoverOpen] = useState(false)
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>(hiddenPinnedPopoverStyle)
  const closeTimerRef = useRef<number | null>(null)
  const isOpen = isPinned || isHoverOpen

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current == null) return
    window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [])

  const updatePopoverPosition = useCallback(() => {
    const rootElement = rootRef.current
    const popoverElement = popoverRef.current
    if (rootElement == null || popoverElement == null) return

    setPopoverStyle(resolvePinnedPopoverStyle({ align, matchWidthSelector, popoverElement, rootElement }))
  }, [align, matchWidthSelector])

  const blurActiveElement = useCallback(() => {
    const activeElement = document.activeElement
    if (
      activeElement instanceof HTMLElement &&
      (rootRef.current?.contains(activeElement) === true || popoverRef.current?.contains(activeElement) === true)
    ) {
      activeElement.blur()
    }
  }, [])

  const togglePinned = useCallback(() => {
    setIsPinned((current) => {
      if (current) {
        blurActiveElement()
      }
      setIsHoverOpen(!current)
      return !current
    })
  }, [blurActiveElement])

  const onRootPointerEnter = useCallback(() => {
    clearCloseTimer()
    setIsHoverOpen(true)
  }, [clearCloseTimer])

  const scheduleHoverClose = useCallback(() => {
    if (isPinned) return
    clearCloseTimer()
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      setIsHoverOpen(false)
    }, 120)
  }, [clearCloseTimer, isPinned])

  const onRootPointerLeave = useCallback(() => {
    scheduleHoverClose()
  }, [scheduleHoverClose])

  const onPopoverPointerEnter = useCallback(() => {
    clearCloseTimer()
    setIsHoverOpen(true)
  }, [clearCloseTimer])

  const onPopoverPointerLeave = useCallback(() => {
    scheduleHoverClose()
  }, [scheduleHoverClose])

  useLayoutEffect(() => {
    if (!isOpen) {
      setPopoverStyle(current => ({
        ...current,
        visibility: 'hidden'
      }))
      return
    }

    updatePopoverPosition()
    const frame = window.requestAnimationFrame(updatePopoverPosition)

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [isOpen, updatePopoverPosition])

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (
        target instanceof Node &&
        (rootRef.current?.contains(target) === true || popoverRef.current?.contains(target) === true)
      ) {
        return
      }
      blurActiveElement()
      setIsHoverOpen(false)
      setIsPinned(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        blurActiveElement()
        setIsHoverOpen(false)
        setIsPinned(false)
      }
    }

    window.addEventListener('resize', updatePopoverPosition)
    window.addEventListener('scroll', updatePopoverPosition, true)
    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown, true)

    return () => {
      window.removeEventListener('resize', updatePopoverPosition)
      window.removeEventListener('scroll', updatePopoverPosition, true)
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [blurActiveElement, isOpen, updatePopoverPosition])

  useEffect(() => () => {
    clearCloseTimer()
  }, [clearCloseTimer])

  return {
    isOpen,
    isPinned,
    onPopoverPointerEnter,
    onPopoverPointerLeave,
    onRootPointerEnter,
    onRootPointerLeave,
    popoverRef,
    popoverStyle,
    rootRef,
    togglePinned
  }
}
