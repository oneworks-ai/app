import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

import { LauncherRoute } from './LauncherRoute'
import type { LauncherRouteProps } from './LauncherRoute'

export interface LauncherOverlayProps extends LauncherRouteProps {
  open: boolean
}

const focusableElementSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

const getFocusableOverlayElements = (overlayElement: HTMLElement) => (
  Array.from(overlayElement.querySelectorAll<HTMLElement>(focusableElementSelector))
    .filter(element => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true')
)

export function LauncherOverlay({
  open,
  onClose,
  onOpenWorkspaceResource,
  searchWorkspaceResources,
  workspaceContext
}: LauncherOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedElementRef = useRef<HTMLElement>()

  useLayoutEffect(() => {
    const overlayElement = overlayRef.current
    if (overlayElement == null) return

    if (!open) {
      overlayElement.setAttribute('inert', '')
      return
    }

    const appRootElement = document.getElementById('root')
    const appRootWasInert = appRootElement?.hasAttribute('inert') ?? false
    const activeElement = document.activeElement
    previouslyFocusedElementRef.current = activeElement instanceof HTMLElement
      ? activeElement
      : undefined

    overlayElement.removeAttribute('inert')
    if (!appRootWasInert) {
      appRootElement?.setAttribute('inert', '')
    }

    const keepFocusInsideOverlay = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return

      const focusableElements = getFocusableOverlayElements(overlayElement)
      const firstElement = focusableElements[0]
      const lastElement = focusableElements.at(-1)
      if (firstElement == null || lastElement == null) {
        event.preventDefault()
        overlayElement.focus()
        return
      }

      const currentElement = document.activeElement
      const focusIsOutsideOverlay = !(currentElement instanceof Node) ||
        !overlayElement.contains(currentElement)
      if (event.shiftKey && (focusIsOutsideOverlay || currentElement === firstElement)) {
        event.preventDefault()
        lastElement.focus()
        return
      }
      if (!event.shiftKey && (focusIsOutsideOverlay || currentElement === lastElement)) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    document.addEventListener('keydown', keepFocusInsideOverlay, true)
    return () => {
      document.removeEventListener('keydown', keepFocusInsideOverlay, true)
      overlayElement.setAttribute('inert', '')
      if (!appRootWasInert) {
        appRootElement?.removeAttribute('inert')
      }

      const previouslyFocusedElement = previouslyFocusedElementRef.current
      previouslyFocusedElementRef.current = undefined
      if (previouslyFocusedElement?.isConnected === true) {
        previouslyFocusedElement.focus()
      }
    }
  }, [open])

  const overlay = (
    <div
      ref={overlayRef}
      className={`launcher-web-overlay ${open ? 'is-open' : 'is-closed'}`}
      role='dialog'
      aria-label='One Works launcher'
      aria-hidden={!open}
      aria-modal={open ? 'true' : undefined}
      tabIndex={-1}
      onMouseDown={(event) => {
        if (open && event.target === event.currentTarget) {
          onClose?.()
        }
      }}
    >
      <LauncherRoute
        active={open}
        workspaceContext={workspaceContext}
        onClose={onClose}
        onOpenWorkspaceResource={onOpenWorkspaceResource}
        searchWorkspaceResources={searchWorkspaceResources}
      />
    </div>
  )

  return createPortal(overlay, document.body)
}
