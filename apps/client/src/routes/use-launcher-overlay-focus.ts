import { useCallback, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'

import {
  focusFirstModalElement,
  focusModalElement,
  getModalFocusableElements,
  isModalFocusableElement
} from '@oneworks/route-layout'

interface LauncherOverlayFocusSession {
  background: Array<{ element: HTMLElement; wasInert: boolean }>
  container: HTMLElement
  opener?: HTMLElement
}

const setBackgroundInert = (container: HTMLElement) => (
  Array.from(document.body.children).flatMap((element) => {
    if (!(element instanceof HTMLElement) || element === container || element.contains(container)) return []
    const wasInert = element.hasAttribute('inert')
    element.setAttribute('inert', '')
    return [{ element, wasInert }]
  })
)

const restoreBackground = (session: LauncherOverlayFocusSession) => {
  session.background.forEach(({ element, wasInert }) => {
    if (!element.isConnected || wasInert) return
    element.removeAttribute('inert')
  })
}

const findSafeFallback = (container: HTMLElement) => (
  getModalFocusableElements(document.body).find(element => !container.contains(element))
)

const getActiveFocusBoundary = (container: HTMLElement) => (
  Array.from(container.querySelectorAll<HTMLElement>('[role="dialog"]'))
    .filter(element => element !== container && getModalFocusableElements(element).length > 0)
    .at(-1) ?? container
)

const tryRestoreFocus = (target: HTMLElement | undefined, container: HTMLElement) => {
  if (target == null || container.contains(target) || !isModalFocusableElement(target)) return false
  focusModalElement(target)
  return document.activeElement === target
}

export const useLauncherOverlayFocus = ({
  onBeforeReleaseFocus,
  open,
  overlayRef
}: {
  onBeforeReleaseFocus?: () => void
  open: boolean
  overlayRef: RefObject<HTMLDivElement | null>
}) => {
  const sessionRef = useRef<LauncherOverlayFocusSession | undefined>(undefined)

  const releaseFocus = useCallback(() => {
    onBeforeReleaseFocus?.()
    const session = sessionRef.current
    if (session == null) return
    sessionRef.current = undefined
    restoreBackground(session)

    if (tryRestoreFocus(session.opener, session.container)) return
    if (tryRestoreFocus(findSafeFallback(session.container), session.container)) return

    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && session.container.contains(activeElement)) {
      activeElement.blur()
    }
  }, [onBeforeReleaseFocus])

  useLayoutEffect(() => {
    if (!open) {
      releaseFocus()
      return
    }

    const container = overlayRef.current
    if (container == null) return
    const activeElement = document.activeElement
    const session: LauncherOverlayFocusSession = {
      background: setBackgroundInert(container),
      container,
      ...(activeElement instanceof HTMLElement &&
          activeElement !== document.body &&
          activeElement !== document.documentElement &&
          activeElement.isConnected &&
          !container.contains(activeElement)
        ? { opener: activeElement }
        : {})
    }
    sessionRef.current = session

    const focusFrame = window.requestAnimationFrame(() => {
      if (sessionRef.current === session) focusFirstModalElement(container)
    })
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || sessionRef.current !== session) return
      const focusBoundary = getActiveFocusBoundary(container)
      const focusableElements = getModalFocusableElements(focusBoundary)
      if (focusableElements.length === 0) {
        event.preventDefault()
        focusModalElement(focusBoundary)
        return
      }

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]
      const activeTarget = document.activeElement
      if (
        event.shiftKey &&
        (
          activeTarget === firstElement ||
          activeTarget === focusBoundary ||
          !focusBoundary.contains(activeTarget)
        )
      ) {
        event.preventDefault()
        focusModalElement(lastElement)
      } else if (!event.shiftKey && (activeTarget === lastElement || !focusBoundary.contains(activeTarget))) {
        event.preventDefault()
        focusModalElement(firstElement)
      }
    }
    const handleFocusIn = (event: FocusEvent) => {
      const focusTarget = event.target
      const focusBoundary = getActiveFocusBoundary(container)
      if (
        sessionRef.current !== session ||
        !(focusTarget instanceof HTMLElement) ||
        focusBoundary.contains(focusTarget)
      ) return
      focusFirstModalElement(focusBoundary)
    }

    window.addEventListener('keydown', handleKeyDown)
    document.addEventListener('focusin', handleFocusIn)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('focusin', handleFocusIn)
    }
  }, [open, overlayRef, releaseFocus])

  useLayoutEffect(() => () => releaseFocus(), [releaseFocus])

  return releaseFocus
}
