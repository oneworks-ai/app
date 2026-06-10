import './Overlay.scss'

import type { HTMLAttributes, InputHTMLAttributes, KeyboardEvent, ReactNode, Ref } from 'react'

import { OverlayIcon } from './OverlayPrimitives'
import { mergeClassNames } from './overlay-utils'

export function OverlaySearchRow({
  accessory,
  autoFocus,
  className,
  clearLabel,
  inputClassName,
  inputRef,
  onChange,
  onClear,
  onKeyDown,
  placeholder,
  value,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'onKeyDown'> & {
  accessory?: ReactNode
  autoFocus?: boolean
  className?: string
  clearLabel?: string
  inputClassName?: string
  inputRef?: Ref<HTMLInputElement>
  onChange: (value: string) => void
  onClear?: () => void
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
  placeholder?: string
  value: string
}) {
  const inputProps: InputHTMLAttributes<HTMLInputElement> = {
    autoFocus,
    className: mergeClassNames('oneworks-overlay-search-input', inputClassName),
    onChange: event => onChange(event.target.value),
    onKeyDown,
    placeholder,
    value
  }

  return (
    <div className={mergeClassNames('oneworks-overlay-search-row', className)} {...props}>
      <label className='oneworks-overlay-search-field'>
        <OverlayIcon className='oneworks-overlay-search-field__icon' icon='search' />
        <input ref={inputRef} {...inputProps} />
        {onClear != null && value.trim() !== '' && (
          <button
            type='button'
            className='oneworks-overlay-search-clear'
            aria-label={clearLabel}
            onClick={onClear}
          >
            <OverlayIcon icon='close' />
          </button>
        )}
      </label>
      {accessory != null && <div className='oneworks-overlay-search-accessory'>{accessory}</div>}
    </div>
  )
}
