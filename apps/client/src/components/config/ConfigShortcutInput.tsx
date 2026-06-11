import './ConfigShortcutInput.scss'

import { Button, Tooltip } from 'antd'
import { useRef } from 'react'
import type { KeyboardEvent } from 'react'

import { isImeCompositionKeyEvent } from '#~/utils/keyboard-events'
import {
  formatShortcutLabel,
  getShortcutDisplayTokens,
  getShortcutFromEvent as getDefaultShortcutFromEvent
} from '#~/utils/shortcutUtils'

export const ShortcutInput = ({
  value,
  displayValue,
  onChange,
  placeholder,
  getShortcutFromEvent = getDefaultShortcutFromEvent,
  normalizeShortcut,
  isMac,
  t
}: {
  value: string
  displayValue?: string
  onChange: (nextValue: string) => void
  placeholder: string
  getShortcutFromEvent?: (event: KeyboardEvent<HTMLInputElement>) => string | null
  normalizeShortcut?: (nextValue: string) => string | null
  isMac: boolean
  t: (key: string) => string
}) => {
  const inputRef = useRef<HTMLInputElement>(null)
  const effectiveValue = (displayValue ?? value).trim()
  const hasValue = effectiveValue !== ''
  const label = effectiveValue === '' ? '' : formatShortcutLabel(effectiveValue, isMac)
  const displayTokens = hasValue ? getShortcutDisplayTokens(effectiveValue, isMac) : []
  const clearShortcutLabel = t('config.editor.clearShortcut')

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isImeCompositionKeyEvent(event)) return

    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      onChange('')
      return
    }
    const nextShortcut = getShortcutFromEvent(event)
    if (nextShortcut == null) return
    const normalizedShortcut = normalizeShortcut?.(nextShortcut) ?? nextShortcut
    if (normalizedShortcut == null) return
    event.preventDefault()
    onChange(normalizedShortcut)
  }

  return (
    <div
      className={`config-shortcut-input ${hasValue ? 'has-value' : 'is-empty'}`}
      onMouseDown={(event) => {
        if (event.target instanceof HTMLElement && event.target.closest('button') != null) return
        inputRef.current?.focus()
      }}
    >
      <span className='material-symbols-rounded config-shortcut-input__icon' aria-hidden='true'>
        keyboard
      </span>
      <span className='config-shortcut-input__display' aria-hidden='true'>
        {hasValue
          ? displayTokens.map((token, index) => (
            <kbd
              className={`config-shortcut-input__key ${token.compact ? 'is-compact' : ''}`}
              key={`${index}:${token.value}:${token.compact ? 'compact' : 'wide'}`}
            >
              {token.value}
            </kbd>
          ))
          : <span className='config-shortcut-input__placeholder'>{placeholder}</span>}
      </span>
      <input
        ref={inputRef}
        className='config-shortcut-input__native'
        value={label}
        aria-label={hasValue ? `${placeholder}: ${label}` : placeholder}
        placeholder={placeholder}
        readOnly
        onKeyDown={handleKeyDown}
      />
      {hasValue && (
        <Tooltip title={clearShortcutLabel}>
          <Button
            size='small'
            type='text'
            className='config-shortcut-input__clear config-view__icon-button config-view__icon-button--compact'
            aria-label={clearShortcutLabel}
            icon={<span className='material-symbols-rounded'>close</span>}
            onClick={() => onChange('')}
          />
        </Tooltip>
      )}
    </div>
  )
}
