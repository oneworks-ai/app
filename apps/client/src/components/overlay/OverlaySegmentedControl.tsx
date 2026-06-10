import './Overlay.scss'

import type { CSSProperties, ReactNode } from 'react'

import { OverlayIcon } from './OverlayPrimitives'
import { mergeClassNames } from './overlay-utils'

export function OverlaySegmentedControl<T extends string>({
  ariaLabel,
  className,
  onChange,
  options,
  value
}: {
  ariaLabel: string
  className?: string
  onChange: (value: T) => void
  options: Array<{ icon: ReactNode; label: string; value: T }>
  value: T
}) {
  const activeIndex = Math.max(0, options.findIndex(option => option.value === value))

  return (
    <div
      className={mergeClassNames('oneworks-overlay-segmented', className)}
      role='radiogroup'
      aria-label={ariaLabel}
      style={{ '--oneworks-overlay-segmented-index': activeIndex } as CSSProperties}
    >
      {options.map(option => (
        <button
          key={option.value}
          type='button'
          className={mergeClassNames('oneworks-overlay-segmented__button', option.value === value && 'is-active')}
          role='radio'
          aria-label={option.label}
          aria-checked={option.value === value}
          title={option.label}
          onClick={() => onChange(option.value)}
        >
          <OverlayIcon className='oneworks-overlay-segmented__icon' icon={option.icon} />
        </button>
      ))}
    </div>
  )
}
