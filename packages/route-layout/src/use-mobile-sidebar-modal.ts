import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

import { focusFirstModalElement, focusModalElement, getModalFocusableElements } from './modal-focus.js'
import { useMobileSideSheetGestures } from './use-mobile-side-sheet-gestures.js'

export function useMobileSidebarModal({
  backgroundRefs,
  canSwipeOpen,
  isCompactLayout,
  isMobileSidebarOpen,
  setIsMobileSidebarOpen,
  sheetRef
}: {
  backgroundRefs: Array<RefObject<HTMLElement | null>>
  canSwipeOpen?: boolean
  isCompactLayout: boolean
  isMobileSidebarOpen: boolean
  setIsMobileSidebarOpen: (nextOpen: boolean) => void
  sheetRef: RefObject<HTMLDivElement | null>
}) {
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  useMobileSideSheetGestures({
    canSwipeOpen,
    isCompactLayout,
    isOpen: isMobileSidebarOpen,
    setIsOpen: setIsMobileSidebarOpen,
    sheetRef
  })

  useEffect(() => {
    if (!isCompactLayout) {
      backgroundRefs.forEach((ref) => {
        ref.current?.removeAttribute('inert')
      })
      return
    }

    backgroundRefs.forEach((ref) => {
      const element = ref.current
      if (element == null) return

      if (isMobileSidebarOpen) {
        element.setAttribute('inert', '')
      } else {
        element.removeAttribute('inert')
      }
    })

    return () => {
      backgroundRefs.forEach((ref) => {
        ref.current?.removeAttribute('inert')
      })
    }
  }, [backgroundRefs, isCompactLayout, isMobileSidebarOpen])

  useEffect(() => {
    if (!isCompactLayout || !isMobileSidebarOpen) return

    const activeElement = document.activeElement
    restoreFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null

    const focusFrame = window.requestAnimationFrame(() => {
      const sheet = sheetRef.current
      if (sheet != null) focusFirstModalElement(sheet)
    })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobileSidebarOpen(false)
        return
      }

      if (event.key !== 'Tab') return

      const sheet = sheetRef.current
      if (sheet == null) return

      const focusableElements = getModalFocusableElements(sheet)
      if (focusableElements.length === 0) {
        event.preventDefault()
        focusModalElement(sheet)
        return
      }

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]
      const activeTarget = document.activeElement

      if (event.shiftKey) {
        if (activeTarget === firstElement || activeTarget === sheet) {
          event.preventDefault()
          focusModalElement(lastElement)
        }
        return
      }

      if (activeTarget === lastElement) {
        event.preventDefault()
        focusModalElement(firstElement)
      }
    }

    const handleFocusIn = (event: FocusEvent) => {
      const sheet = sheetRef.current
      const focusTarget = event.target
      if (sheet == null || !(focusTarget instanceof HTMLElement)) return
      if (sheet.contains(focusTarget)) return

      focusFirstModalElement(sheet)
    }

    window.addEventListener('keydown', handleKeyDown)
    document.addEventListener('focusin', handleFocusIn)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('focusin', handleFocusIn)

      const restoreFocusTarget = restoreFocusRef.current
      if (restoreFocusTarget != null && document.contains(restoreFocusTarget)) {
        window.requestAnimationFrame(() => {
          if (document.contains(restoreFocusTarget)) {
            focusModalElement(restoreFocusTarget)
          }
        })
      }
      restoreFocusRef.current = null
    }
  }, [isCompactLayout, isMobileSidebarOpen, setIsMobileSidebarOpen, sheetRef])

  useEffect(() => {
    if (!isCompactLayout || !isMobileSidebarOpen) return

    const { body, documentElement } = document
    const previousBodyOverflow = body.style.overflow
    const previousDocumentOverflow = documentElement.style.overflow

    body.style.overflow = 'hidden'
    documentElement.style.overflow = 'hidden'

    return () => {
      body.style.overflow = previousBodyOverflow
      documentElement.style.overflow = previousDocumentOverflow
    }
  }, [isCompactLayout, isMobileSidebarOpen])
}
