import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

import type { PinnedPopoverController } from './usePinnedPopover'

export function PinnedPopoverPortal({
  children,
  className,
  controller,
  role = 'tooltip'
}: {
  children: ReactNode
  className: string
  controller: PinnedPopoverController
  role?: string
}) {
  if (!controller.isOpen) return null

  return createPortal(
    <div
      ref={controller.popoverRef}
      className={className}
      role={role}
      style={controller.popoverStyle}
      onPointerEnter={controller.onPopoverPointerEnter}
      onPointerLeave={controller.onPopoverPointerLeave}
    >
      {children}
    </div>,
    document.body
  )
}
