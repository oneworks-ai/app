import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { PluginProvider } from '#~/plugins/PluginProvider'

import { LauncherRoute } from './LauncherRoute'
import type { LauncherRouteProps } from './LauncherRoute'
import {
  consumeLauncherOverlayBackdropPointerStart,
  createLauncherOverlayBackdropActivationHandler
} from './launcher-interaction-events'
import {
  LauncherWorkspaceOpenControllerOwnerContext,
  createLauncherWorkspaceOpenControllerOwner
} from './launcher-workspace-open-lifecycle'
import { useLauncherOverlayFocus } from './use-launcher-overlay-focus'

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
  const [workspaceOpenControllerOwner] = useState(createLauncherWorkspaceOpenControllerOwner)
  const invalidateLauncherActivation = useCallback(() => {
    workspaceOpenControllerOwner.invalidate()
  }, [workspaceOpenControllerOwner])
  const releaseFocus = useLauncherOverlayFocus({
    onBeforeReleaseFocus: invalidateLauncherActivation,
    open,
    overlayRef
  })
  const requestClose = useCallback(() => {
    releaseFocus()
    onClose?.()
  }, [onClose, releaseFocus])

  useLayoutEffect(() => {
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
      tabIndex={-1}
      onClick={createLauncherOverlayBackdropActivationHandler({ isOpen: open, onRequestClose: requestClose })}
      onMouseDown={consumeLauncherOverlayBackdropPointerStart}
      onMouseUp={consumeLauncherOverlayBackdropPointerStart}
      onPointerDown={consumeLauncherOverlayBackdropPointerStart}
      onPointerUp={consumeLauncherOverlayBackdropPointerStart}
      onTouchEnd={consumeLauncherOverlayBackdropPointerStart}
      onTouchStart={consumeLauncherOverlayBackdropPointerStart}
    >
      <LauncherWorkspaceOpenControllerOwnerContext.Provider value={workspaceOpenControllerOwner}>
        <PluginProvider runtimeSource='manager' surface='launcher'>
          <LauncherRoute
            active={open}
            routingMode='embedded'
            workspaceContext={workspaceContext}
            onClose={requestClose}
            onOpenWorkspaceResource={onOpenWorkspaceResource}
            searchWorkspaceResources={searchWorkspaceResources}
          />
        </PluginProvider>
      </LauncherWorkspaceOpenControllerOwnerContext.Provider>
    </div>
  )

  return createPortal(overlay, document.body)
}
