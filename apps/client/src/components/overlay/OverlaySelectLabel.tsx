import './Overlay.scss'

import type { ReactNode } from 'react'

import { OverlayIcon } from './OverlayPrimitives'

export function OverlaySelectLabel({
  icon,
  label,
  meta
}: {
  icon: ReactNode
  label: ReactNode
  meta?: ReactNode
}) {
  return (
    <span className='oneworks-overlay-select-label'>
      <OverlayIcon className='oneworks-overlay-select-label__icon' icon={icon} />
      <span className='oneworks-overlay-select-label__text'>
        <span className='oneworks-overlay-select-label__title'>{label}</span>
        {meta != null && <span className='oneworks-overlay-select-label__meta'>{meta}</span>}
      </span>
    </span>
  )
}
