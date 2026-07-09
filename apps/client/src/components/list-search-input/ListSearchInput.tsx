import './ListSearchInput.scss'

import type { ReactNode } from 'react'

import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'

export interface ListSearchInputProps {
  allowClear?: boolean
  ariaLabel?: string
  autoFocus?: boolean
  className?: string
  clearLabel?: string
  disabled?: boolean
  placeholder?: string
  suffix?: ReactNode
  value: string
  onChange?: (value: string) => void
  onCommit?: (value: string) => void
}

export function ListSearchInput({
  allowClear = true,
  ariaLabel,
  autoFocus,
  className,
  clearLabel = 'Clear search',
  disabled,
  placeholder,
  suffix,
  value,
  onChange,
  onCommit
}: ListSearchInputProps) {
  const handleCommit = () => {
    onCommit?.(value)
  }

  const handleClear = () => {
    onChange?.('')
    onCommit?.('')
  }

  return (
    <div className={['oneworks-list-search', className].filter(Boolean).join(' ')}>
      <MaterialSymbol aria-hidden='true' className='oneworks-list-search__icon' name='search' />
      <input
        aria-label={ariaLabel ?? placeholder ?? 'Search'}
        autoFocus={autoFocus}
        className='oneworks-list-search__input'
        disabled={disabled}
        placeholder={placeholder}
        type='search'
        value={value}
        onBlur={handleCommit}
        onChange={event => onChange?.(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            handleCommit()
          }
        }}
      />
      {allowClear && value.length > 0 && (
        <button
          aria-label={clearLabel}
          className='oneworks-list-search__clear'
          disabled={disabled}
          type='button'
          onClick={handleClear}
          onMouseDown={event => event.preventDefault()}
        >
          <MaterialSymbol aria-hidden='true' className='oneworks-list-search__clear-icon' name='close' />
        </button>
      )}
      {suffix != null && <span className='oneworks-list-search__suffix'>{suffix}</span>}
    </div>
  )
}
