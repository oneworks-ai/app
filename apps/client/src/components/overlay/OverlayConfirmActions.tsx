import type { ReactNode } from 'react'

import { OverlayIcon } from './OverlayPrimitives'

export function OverlayConfirmActions({
  label,
  onCancel,
  onConfirm
}: {
  label: ReactNode
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <span className='oneworks-overlay-confirm-actions'>
      <button
        type='button'
        className='oneworks-overlay-confirm-btn is-accept'
        aria-label={`Confirm ${String(label)}`}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onConfirm()
        }}
      >
        <OverlayIcon className='oneworks-overlay-confirm-icon' icon='check' />
      </button>
      <button
        type='button'
        className='oneworks-overlay-confirm-btn is-cancel'
        aria-label={`Cancel ${String(label)}`}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        }}
      >
        <OverlayIcon className='oneworks-overlay-confirm-icon' icon='close' />
      </button>
    </span>
  )
}
