import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

import { LauncherRoute } from './LauncherRoute'
import type { LauncherRouteProps } from './LauncherRoute'

export interface LauncherOverlayProps extends LauncherRouteProps {
  open: boolean
}

export function LauncherOverlay({
  open,
  onClose,
  onOpenWorkspaceResource,
  searchWorkspaceResources,
  workspaceContext
}: LauncherOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const overlayElement = overlayRef.current
    if (overlayElement == null) return

    if (open) {
      overlayElement.removeAttribute('inert')
      return
    }

    overlayElement.setAttribute('inert', '')
  }, [open])

  const overlay = (
    <div
      ref={overlayRef}
      className={`launcher-web-overlay ${open ? 'is-open' : 'is-closed'}`}
      role='dialog'
      aria-label='One Works launcher'
      aria-hidden={!open}
      aria-modal={open ? 'true' : undefined}
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
